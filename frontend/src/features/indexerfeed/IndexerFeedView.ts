import { inject, component, signal, refBindInput, refBindSelect, computed, effect } from 'chispa';
import {
	IndexerFeedApiService,
	type ArrSyncExtensionStatus,
	type ArrSyncStatusResponse,
	type IndexerFeedItem,
	type IndexerFeedMediaType,
	type WantedItem,
	type WantedListResponse,
} from '../../services/IndexerFeedApiService';
import { BlacklistService } from '../../services/BlacklistService';
import { DialogService } from '../../services/DialogService';
import { ApiError } from '../../services/BaseApiService';
import { LocalPrefsService } from '../../services/LocalPrefsService';
import { ColumnsMenuService } from '../../services/ColumnsMenuService';
import { getProviderName } from '../../services/ProvidersApiService';
import { TableColumns } from '../../utils/TableColumns';
import { smartLoad, smartPoll } from '../../utils/scheduling';
import { fbytes } from '../../utils/formats';
import tpl from './IndexerFeedView.html';
import './IndexerFeedView.css';

const PAGE_SIZE = 100;
const STATUS_POLL_MS = 5000;
const SEARCH_DEBOUNCE_MS = 300;

type Tab = 'wanted' | 'feed';

const MEDIA_TYPE_LABELS: Record<IndexerFeedMediaType, string> = { tv: 'TV', movie: 'Movie' };

/** "5 min ago" / "in 2 h" style distance from now; whole units, never seconds. */
function relativeTime(iso: string, now: number): string {
	const diffMs = new Date(iso).getTime() - now;
	const abs = Math.abs(diffMs);
	if (abs < 60_000) return diffMs <= 0 ? 'just now' : 'in less than a minute';
	const minutes = Math.round(abs / 60_000);
	const text = minutes < 60 ? `${minutes} min` : minutes < 60 * 48 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / (60 * 24))} d`;
	return diffMs < 0 ? `${text} ago` : `in ${text}`;
}

function badgeOf(s: ArrSyncExtensionStatus): { text: string; color: string } {
	if (!s.enabled) return { text: 'Disabled', color: '#808080' };
	if (!s.configured) return { text: 'No API key', color: '#ff4d4d' };
	if (s.running) return { text: 'Running', color: '#2b7bd6' };
	if (s.queued) return { text: 'Queued', color: '#2b7bd6' };
	if (s.error) return { text: 'Error', color: '#ff4d4d' };
	if (!s.lastRunAt) return { text: 'Pending', color: '#808080' };
	return { text: 'OK', color: '#008000' };
}

/**
 * Two views of the *arr integration: the wanted titles read live from Sonarr/Radarr, with what the sync
 * did about each, and the feed the Torznab endpoint serves them on their RSS sync. Together they answer
 * "why doesn't Sonarr grab X": not wanted, not searched yet, searched with no hits, or in the feed already.
 */
export const IndexerFeedView = component(() => {
	const api = inject(IndexerFeedApiService);
	const blacklistService = inject(BlacklistService);
	const dialogService = inject(DialogService);
	const prefs = inject(LocalPrefsService);
	const columnsMenu = inject(ColumnsMenuService);
	const wantedColumns = new TableColumns({ prefs, prefsKey: 'indexerfeed.wanted' });
	const feedColumns = new TableColumns({ prefs, prefsKey: 'indexerfeed.feed' });

	const tab = signal<Tab>('wanted');

	// Wanted listing
	const wanted = signal<WantedListResponse | null>(null);
	// Feed listing
	const items = signal<IndexerFeedItem[]>([]);
	const total = signal(0);
	const offset = signal(0);
	const typeFilter = signal('');
	const search = signal('');
	/** Feed restricted to the releases found for one wanted title (set from the Wanted tab). */
	const jobFilter = signal<{ key: string; title: string } | null>(null);
	// Sync status
	const status = signal<ArrSyncStatusResponse | null>(null);
	const now = signal(Date.now());

	const loadWanted = smartLoad(async () => {
		wanted.set(await api.getWanted());
		now.set(Date.now());
	}, 'indexer-feed-wanted');

	const loadFeed = smartLoad(async () => {
		const type = typeFilter.get() as IndexerFeedMediaType | '';
		const res = await api.list({
			type: type || undefined,
			search: search.get().trim() || undefined,
			jobKey: jobFilter.get()?.key,
			offset: offset.get(),
			limit: PAGE_SIZE,
		});
		items.set(res.items);
		total.set(res.total);
		// The page vanished under us (items removed, filter narrowed): step back to the last one
		if (res.items.length === 0 && res.total > 0 && res.offset >= res.total) {
			offset.set(Math.max(0, Math.floor((res.total - 1) / PAGE_SIZE) * PAGE_SIZE));
			await loadFeed();
		}
	}, 'indexer-feed');

	const reloadFromStart = () => {
		offset.set(0);
		return loadFeed();
	};

	const loadCurrentTab = () => (tab.get() === 'wanted' ? loadWanted() : loadFeed());

	const switchTab = (next: Tab) => {
		if (tab.get() === next) return;
		tab.set(next);
		loadCurrentTab();
	};

	// Status is polled; when a run ends, the current tab is reloaded so new releases show up without a click
	let wasRunning = false;
	const loadStatus = smartLoad(async () => {
		const res = await api.getSyncStatus();
		status.set(res);
		now.set(Date.now());
		if (wasRunning && !res.running) await loadCurrentTab();
		wasRunning = res.running;
	}, 'indexer-feed-status');

	loadWanted();
	smartPoll(loadStatus, STATUS_POLL_MS);

	// The feed follows its filters: this also performs the initial load. The reload is deferred so the
	// signals loadFeed reads (search, offset) stay out of this effect's dependencies; the text filter is
	// debounced and paging loads on its own.
	effect(() => {
		typeFilter.get();
		jobFilter.get();
		queueMicrotask(() => void reloadFromStart());
	});

	// Filters
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	const onSearchInput = () => {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void reloadFromStart(), SEARCH_DEBOUNCE_MS);
	};

	const showFeedForWanted = (w: WantedItem) => {
		jobFilter.set({ key: w.key, title: w.title });
		tab.set('feed');
	};

	const clearJobFilter = () => jobFilter.set(null);

	// Actions
	const runSync = async (s: ArrSyncExtensionStatus) => {
		try {
			const res = await api.runSync(s.extensionId);
			status.set(res.status);
			wasRunning = res.status.running;
		} catch (e) {
			await dialogService.alert(e instanceof ApiError ? e.message : 'Failed to start the sync', 'Error');
		}
	};

	const removeItem = async (item: IndexerFeedItem) => {
		try {
			await api.removeItem(item.hash);
			await loadFeed();
		} catch (e) {
			await dialogService.alert(e instanceof ApiError ? e.message : 'Failed to remove the item', 'Error');
		}
	};

	const blacklistItem = async (item: IndexerFeedItem) => {
		const ok = await blacklistService.blacklistWithConfirm(
			[{ hash: item.hash, name: item.name, size: item.size }],
			'The release is removed from the feed and will not be offered to Sonarr/Radarr again.'
		);
		if (!ok) return;
		await removeItem(item);
	};

	const clearFeed = async () => {
		const count = total.get();
		if (
			!(await dialogService.confirm(
				`Remove every release from the feed (${count} item${count === 1 ? '' : 's'})?\n\nThe next sync will fill it again.`,
				'Clear Feed'
			))
		) {
			return;
		}
		try {
			await api.clear();
			await reloadFromStart();
		} catch (e) {
			await dialogService.alert(e instanceof ApiError ? e.message : 'Failed to clear the feed', 'Error');
		}
	};

	// Paging
	const pageInfo = computed(() => {
		const t = total.get();
		if (t === 0) return '0 releases';
		const from = offset.get() + 1;
		const to = Math.min(offset.get() + items.get().length, t);
		return `${from}-${to} of ${t} release${t === 1 ? '' : 's'}`;
	});
	const goPrev = () => {
		if (offset.get() === 0) return;
		offset.set(Math.max(0, offset.get() - PAGE_SIZE));
		loadFeed();
	};
	const goNext = () => {
		if (offset.get() + PAGE_SIZE >= total.get()) return;
		offset.set(offset.get() + PAGE_SIZE);
		loadFeed();
	};

	const onFeedTab = () => tab.get() === 'feed';
	const showWhen = (visible: () => boolean) => ({ display: () => (visible() ? '' : 'none') });

	return tpl.fragment({
		tabWanted: { onclick: () => switchTab('wanted'), classes: { active: () => tab.get() === 'wanted' } },
		tabFeed: { onclick: () => switchTab('feed'), classes: { active: onFeedTab } },
		feedFilters: { style: showWhen(onFeedTab) },
		jobFilterChip: { style: showWhen(() => jobFilter.get() !== null) },
		jobFilterLabel: { inner: () => (jobFilter.get() ? `Releases of: ${jobFilter.get()!.title}` : ''), title: () => jobFilter.get()?.title ?? '' },
		jobFilterClear: { onclick: clearJobFilter },
		typeSelect: { _ref: refBindSelect(typeFilter) },
		searchInput: { _ref: refBindInput(search), oninput: onSearchInput },
		btnRefresh: {
			onclick: () => {
				loadCurrentTab();
				loadStatus();
			},
		},
		btnClear: { onclick: clearFeed, disabled: () => total.get() === 0, style: showWhen(onFeedTab) },
		// One button for both tabs: it opens the menu of the table currently shown
		columnsBtn: { onclick: (e) => columnsMenu.show(e.currentTarget as HTMLElement, onFeedTab() ? feedColumns : wantedColumns) },
		wantedTable: { _ref: (el) => wantedColumns.attach(el) },
		feedTable: { _ref: (el) => feedColumns.attach(el) },

		postponedNote: { inner: () => (status.get()?.postponedReason ? `Postponed: ${status.get()!.postponedReason}` : '') },
		syncCards: {
			inner: () => {
				const list = status.get()?.extensions ?? [];
				if (list.length === 0) return tpl.syncEmpty({});
				const nowMs = now.get();
				return list.map((s) => {
					const badge = badgeOf(s);
					const counts = s.wantedCount === null ? '-' : `${s.wantedCount} / ${s.searched ?? '-'} / ${s.found ?? '-'}`;
					return tpl.syncCard({
						nodes: {
							cardName: { inner: s.name, title: s.name },
							cardType: { inner: s.type === 'sonarr' ? 'Sonarr' : 'Radarr' },
							cardBadge: { inner: badge.text, style: { color: badge.color } },
							cardRunBtn: { onclick: () => runSync(s), disabled: !s.enabled || !s.configured || s.running || s.queued },
							cardLastRun: {
								inner: s.lastRunAt
									? `${relativeTime(s.lastRunAt, nowMs)}${s.lastDurationMs !== null ? ` (took ${Math.round(s.lastDurationMs / 1000)} s)` : ''}`
									: 'never',
								title: s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '',
							},
							cardNextRun: {
								inner: s.running ? 'running now' : s.nextRunAt ? relativeTime(s.nextRunAt, nowMs) : '-',
								title: s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '',
							},
							cardCounts: { inner: counts },
							cardProviders: { inner: s.searchProviders ? s.searchProviders.map((p) => getProviderName(p)).join(', ') : 'all' },
							cardError: { inner: s.error ?? '', style: { display: s.error ? '' : 'none' } },
						},
					});
				});
			},
		},

		// ---- Wanted tab ----
		wantedPane: { style: showWhen(() => tab.get() === 'wanted') },
		wantedErrors: {
			style: showWhen(() => (wanted.get()?.errors.length ?? 0) > 0),
			inner: () => (wanted.get()?.errors ?? []).map((e) => tpl.wantedError({ inner: `${e.extensionName}: ${e.message}` })),
		},
		wantedBody: {
			inner: () => {
				const res = wanted.get();
				if (!res) return tpl.wantedNoRows({ nodes: { wantedNoRowsText: { inner: 'Loading...' } } });
				if (res.items.length === 0) {
					const text =
						res.errors.length > 0
							? 'No wanted titles could be read.'
							: 'Nothing is wanted: every monitored item of the configured instances has a file.';
					return tpl.wantedNoRows({ nodes: { wantedNoRowsText: { inner: text } } });
				}
				const nowMs = now.get();
				return res.items.map((w) => {
					const pending = w.pending.join(', ');
					const searched = w.lastSearchedAt ? relativeTime(w.lastSearchedAt, nowMs) : 'not yet';
					const hits = w.feedHits === 0 ? (w.lastSearchedAt ? 'none' : '-') : String(w.feedHits);
					return tpl.wantedRow({
						nodes: {
							wTitleCol: {},
							wTitle: { inner: w.title, title: w.key },
							wMobileInfo: {
								nodes: {
									wMobInstance: { inner: w.extensionName },
									wMobPending: { inner: pending, title: pending },
									wMobSearched: { inner: `Searched: ${searched}` },
									wMobHitsBtn: { inner: `In feed: ${hits}`, onclick: () => showFeedForWanted(w), disabled: w.feedHits === 0 },
								},
							},
							wInstanceCol: { inner: w.extensionName, title: w.extensionName },
							wTypeCol: { inner: MEDIA_TYPE_LABELS[w.mediaType] ?? w.mediaType },
							wPendingCol: { inner: pending || '-', title: pending },
							wQueryCol: { inner: w.query, title: w.query },
							wImdbCol: { inner: w.imdbId ?? '-' },
							wSearchedCol: { inner: searched, title: w.lastSearchedAt ? new Date(w.lastSearchedAt).toLocaleString() : '' },
							wHitsBtn: { inner: hits, onclick: () => showFeedForWanted(w), disabled: w.feedHits === 0 },
						},
					});
				});
			},
		},

		// ---- Feed tab ----
		feedPane: { style: showWhen(onFeedTab) },
		feedFooter: { style: showWhen(onFeedTab) },
		feedBody: {
			inner: () => {
				const list = items.get();
				if (list.length === 0) {
					const filtered = typeFilter.get() !== '' || search.get().trim() !== '' || jobFilter.get() !== null;
					return tpl.noItemsRow({ nodes: { noItemsText: { inner: filtered ? 'No releases match the current filters.' : 'The feed is empty.' } } });
				}
				return list.map((item) => {
					const type = MEDIA_TYPE_LABELS[item.media_type] ?? item.media_type;
					const discovered = new Date(item.discovered_at).toLocaleString();
					return tpl.feedRow({
						nodes: {
							nameCol: {},
							nameText: { inner: item.name, title: item.hash },
							mobileInfo: {
								nodes: {
									mobType: { inner: type },
									mobSize: { inner: fbytes(item.size) },
									mobSources: { inner: `${item.source_count} src` },
									mobDiscovered: { inner: discovered },
									mobQuery: { inner: item.query ?? '', title: item.query ?? '' },
									mobBlacklistBtn: { onclick: () => blacklistItem(item) },
									mobDeleteBtn: { onclick: () => removeItem(item) },
								},
							},
							typeCol: { inner: type },
							sizeCol: { inner: fbytes(item.size) },
							sourcesCol: { inner: String(item.source_count) },
							providerCol: { inner: item.provider },
							queryCol: { inner: item.query ?? '-', title: item.query ?? '' },
							imdbCol: { inner: item.imdb_id ?? '-' },
							discoveredCol: { inner: discovered, title: item.discovered_at },
							blacklistBtn: { onclick: () => blacklistItem(item) },
							deleteBtn: { onclick: () => removeItem(item) },
						},
					});
				});
			},
		},

		pageInfo: { inner: () => pageInfo.get() },
		btnPrev: { onclick: goPrev, disabled: () => offset.get() === 0 },
		btnNext: { onclick: goNext, disabled: () => offset.get() + PAGE_SIZE >= total.get() },
	});
});
