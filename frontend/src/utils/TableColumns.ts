import { LocalPrefsService } from '../services/LocalPrefsService';

export interface TableColumnsOptions {
	/** Prefix of the LocalPrefs keys: `<prefsKey>.columns.hidden` and `<prefsKey>.columns.widthPct`. */
	prefsKey: string;
	prefs: LocalPrefsService;
}

export interface TableColumn {
	key: string;
	label: string;
	visible: boolean;
	/** The primary column (`is-mobile-primary`, else the first one): it cannot be hidden. */
	locked: boolean;
}

/** The mobile layout (≤768px) picks its own columns, so everything here only applies above it. */
const DESKTOP_MEDIA = '(min-width: 769px)';
/** Narrowest a column can be dragged to, in px (converted to % of the container at drag time). */
const MIN_WIDTH_PX = 30;
/** Share of the container given to a column that was never measured (added after the widths were saved). */
const DEFAULT_PCT = 10;

/**
 * Per-table column preferences, kept out of chispa on purpose: it works on the DOM of a plain
 * `<table class="ui-list">` and persists through LocalPrefsService.
 *
 * - Visibility is applied with a `<style>` of `nth-child` rules placed next to the table.
 * - Resizing adds a drag handle to every `th`. Nothing changes until the first drag: then the
 *   current widths are frozen as percentages of the container and the table switches to
 *   `table-layout: fixed`, so resizing the window scales every column proportionally. While the
 *   percentages add up to 100 or less the table fills its container and the last visible column
 *   takes whatever is left; past 100 the table grows (still proportionally) and the container
 *   scrolls horizontally instead of squeezing the columns. Dragging a border moves that border and
 *   shifts everything right of it. Double-clicking a handle gives that column its default width back.
 *
 * Columns are identified by their header text, so renaming a header only drops its saved preference.
 *
 *   const columns = new TableColumns({ prefs, prefsKey: 'transfers' });
 *   // in the template: downloadsTable: { _ref: (el) => columns.attach(el) }
 */
export class TableColumns {
	private table: HTMLTableElement | null = null;
	private styleEl: HTMLStyleElement | null = null;
	private headers: HTMLTableCellElement[] = [];
	private keys: string[] = [];
	private lockedIndex = 0;
	private hidden: Set<string>;
	/** Column key → width as % of the scroll container. */
	private widths: Record<string, number>;
	private readonly handles: HTMLElement[] = [];
	private readonly listeners = new Set<() => void>();
	private renderQueued = false;

	constructor(private readonly opts: TableColumnsOptions) {
		this.hidden = new Set(opts.prefs.get<string[]>(`${opts.prefsKey}.columns.hidden`, []));
		this.widths = opts.prefs.get<Record<string, number>>(`${opts.prefsKey}.columns.widthPct`, {});
	}

	/** Bind to a `<table>` through chispa's `_ref`. Reads the columns from the first `thead` row. */
	attach(table: HTMLTableElement): void {
		this.detach();
		this.table = table;
		if (!table.id) table.id = `tbl-${this.opts.prefsKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

		const headerRow = table.tHead?.rows[0];
		this.headers = headerRow ? Array.from(headerRow.cells) : [];
		this.keys = [];
		this.headers.forEach((th, i) => {
			let key = (th.textContent || '').trim() || `col${i + 1}`;
			while (this.keys.includes(key)) key += '_';
			this.keys.push(key);
		});
		const primary = this.headers.findIndex((th) => th.classList.contains('is-mobile-primary'));
		this.lockedIndex = primary === -1 ? 0 : primary;

		this.headers.forEach((th, i) => this.addResizeHandle(th, i));

		this.styleEl = document.createElement('style');
		this.render();
		// `_ref` fires before the table hangs from its parent: insert the <style> once it does, so it
		// leaves the DOM together with the view and needs no explicit cleanup.
		queueMicrotask(() => {
			if (!this.styleEl || this.table !== table) return;
			(table.parentNode ?? document.head).insertBefore(this.styleEl, table.parentNode ? table : null);
		});
	}

	/** Undo `attach`: removes the style element and the drag handles. Not needed when the table itself leaves the DOM. */
	detach(): void {
		this.styleEl?.remove();
		this.styleEl = null;
		this.handles.forEach((h) => h.remove());
		this.handles.length = 0;
		this.table = null;
		this.headers = [];
		this.keys = [];
	}

	columns(): TableColumn[] {
		return this.keys.map((key, i) => ({
			key,
			label: key,
			visible: !this.isHidden(i),
			locked: i === this.lockedIndex,
		}));
	}

	isVisible(key: string): boolean {
		const i = this.keys.indexOf(key);
		return i !== -1 && !this.isHidden(i);
	}

	setVisible(key: string, visible: boolean): void {
		const i = this.keys.indexOf(key);
		if (i === -1 || i === this.lockedIndex) return;
		if (visible) this.hidden.delete(key);
		else this.hidden.add(key);
		this.persist();
		this.render();
		this.notify();
	}

	/** Shows every column and drops the saved widths, back to the automatic layout. */
	reset(): void {
		this.hidden.clear();
		this.widths = {};
		this.persist();
		this.render();
		this.notify();
	}

	/** Called after every change made through this class (visibility, widths, reset). Returns the unsubscribe function. */
	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	// ---- internals ----

	private isHidden(i: number): boolean {
		return i !== this.lockedIndex && this.hidden.has(this.keys[i]);
	}

	private get hasFixedWidths(): boolean {
		return Object.keys(this.widths).length > 0;
	}

	/** Width of the scroll container the percentages refer to; 0 when the table is not laid out yet. */
	private baseWidth(): number {
		if (!this.table) return 0;
		return this.table.parentElement?.clientWidth || this.table.getBoundingClientRect().width;
	}

	private toPct(px: number, base: number): number {
		return Math.round((px / base) * 10000) / 100;
	}

	/** Width (% of the container) once the table is in fixed layout: the saved one, else the header's inline px width, else a fallback. */
	private widthOf(i: number): number {
		const saved = this.widths[this.keys[i]];
		if (saved !== undefined) return saved;
		const base = this.baseWidth();
		const inline = /^(\d+(?:\.\d+)?)px$/.exec(this.headers[i].style.width);
		return base > 0 && inline ? this.toPct(Number(inline[1]), base) : DEFAULT_PCT;
	}

	/** First drag: capture what the browser laid out so the switch to fixed layout is invisible. */
	private freezeWidths(): void {
		if (this.hasFixedWidths) return;
		const base = this.baseWidth();
		if (base <= 0) return;
		this.headers.forEach((th, i) => {
			this.widths[this.keys[i]] = this.isHidden(i) ? this.widthOf(i) : this.toPct(Math.max(MIN_WIDTH_PX, th.getBoundingClientRect().width), base);
		});
	}

	private render(): void {
		if (!this.styleEl || !this.table) return;
		const sel = `#${this.table.id}`;
		const rules: string[] = [];

		this.keys.forEach((_, i) => {
			if (!this.isHidden(i)) return;
			const n = i + 1;
			rules.push(`${sel} > thead > tr > th:nth-child(${n}), ${sel} > tbody > tr > td:nth-child(${n}):not([colspan]) { display: none; }`);
		});

		if (this.hasFixedWidths) {
			const visible = this.keys.map((_, i) => i).filter((i) => !this.isHidden(i));
			const flexIndex = visible[visible.length - 1];
			// Percentages are relative to the container; when they add up to more than 100 the table itself
			// becomes that wide and the column shares are re-expressed relative to the table.
			const total = visible.reduce((sum, i) => sum + this.widthOf(i), 0);
			const tablePct = Math.max(100, total);
			visible.forEach((i) => {
				const n = i + 1;
				// `!important` beats the default inline widths of the template. The last visible column keeps `auto`
				// so it takes whatever the others leave free (at least its own share, by the table width above).
				// Widths are border-box so they match what the handle measured.
				const width = i === flexIndex ? 'auto' : `${Math.round((this.widthOf(i) / tablePct) * 10000) / 100}%`;
				rules.push(
					`${sel} > thead > tr > th:nth-child(${n}) { box-sizing: border-box; width: ${width} !important; min-width: 0 !important; max-width: none !important; }`
				);
			});
			rules.push(`${sel} { table-layout: fixed; width: ${Math.round(tablePct * 100) / 100}%; }`);
		}

		this.styleEl.textContent = rules.length ? `@media ${DESKTOP_MEDIA} {\n${rules.join('\n')}\n}` : '';
	}

	private scheduleRender(): void {
		if (this.renderQueued) return;
		this.renderQueued = true;
		requestAnimationFrame(() => {
			this.renderQueued = false;
			this.render();
		});
	}

	private addResizeHandle(th: HTMLTableCellElement, i: number): void {
		const handle = document.createElement('span');
		handle.className = 'ui-col-resizer';
		handle.title = 'Drag to resize, double-click to reset';
		let startX = 0;
		let startPct = 0;
		let base = 0;
		let dragging = false;

		handle.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			base = this.baseWidth();
			if (base <= 0) return;
			this.freezeWidths();
			startX = e.clientX;
			startPct = this.widthOf(i);
			dragging = true;
			handle.classList.add('dragging');
			handle.setPointerCapture(e.pointerId);
		});
		handle.addEventListener('pointermove', (e) => {
			if (!dragging) return;
			const pct = startPct + this.toPct(e.clientX - startX, base);
			this.widths[this.keys[i]] = Math.max(this.toPct(MIN_WIDTH_PX, base), Math.round(pct * 100) / 100);
			this.scheduleRender();
		});
		const stop = () => {
			if (!dragging) return;
			dragging = false;
			handle.classList.remove('dragging');
			this.persist();
			this.render();
			this.notify();
		};
		handle.addEventListener('pointerup', stop);
		handle.addEventListener('pointercancel', stop);
		// The header's own click sorts the list; a resize must not.
		handle.addEventListener('click', (e) => e.stopPropagation());
		handle.addEventListener('dblclick', (e) => {
			e.stopPropagation();
			delete this.widths[this.keys[i]];
			this.persist();
			this.render();
			this.notify();
		});

		th.appendChild(handle);
		this.handles.push(handle);
	}

	private persist(): void {
		this.opts.prefs.set(`${this.opts.prefsKey}.columns.hidden`, [...this.hidden]);
		this.opts.prefs.set(`${this.opts.prefsKey}.columns.widthPct`, this.widths);
	}

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}
}
