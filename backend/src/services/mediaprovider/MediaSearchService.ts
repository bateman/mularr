import { container } from '../container/ServiceContainer';
import { MainDB, blacklistEntryMatches } from '../db/MainDB';
import { AppEvents } from '../AppEvents';
import { MediaProviderService } from './MediaProviderService';
import type { IMediaProvider, MediaSearchResult, MediaSearchResponse, MediaSearchStatusResponse, SearchCriteria } from './types';
import { LoggerFactory } from '../logging/Logger';

/**
 * Polling parameters of searchAndCollect. Gather until the result set stops growing, not just until EC
 * progress hits 100%: progress reaches 1 as soon as the first responses land, but a global eD2k search
 * keeps trickling results for many seconds; returning early yields a small, non-deterministic snapshot
 * (observed ~17 vs ~126) that drops long-tail releases. So the set is polled and the wait ends only once
 * its size is stable across STABLE_POLLS polls AND the search reports done, or MAX_WAIT_MS elapses —
 * favouring completeness over speed, within the *arr request timeout.
 */
const SEARCH_POLL_MS = 1500;
const SEARCH_MAX_WAIT_MS = 12000;
const SEARCH_STABLE_POLLS = 3;

/**
 * Coordinates searches across the media providers. There is one search at a time (aMule keeps a single
 * active search whose results are replaced by the next one), so everything that starts a search goes
 * through here: the web UI, which polls the results itself, and the callers that need the settled result
 * set (the Torznab indexer, the *arr wanted sync), which are serialized.
 */
export class MediaSearchService {
	private readonly logger = LoggerFactory.create(this);
	private readonly db = container.get(MainDB);
	private readonly events = container.get(AppEvents);
	private readonly providers = container.get(MediaProviderService).providers;
	public readonly searchHistory = new SearchHistory();
	/** Tail of the searchAndCollect queue; every collected search chains on it so two never overlap. */
	private searchQueue: Promise<unknown> = Promise.resolve();
	private _lastInteractiveSearchAt = 0;

	constructor() {
		// A download is added by hash or link; the result it came from is only known here, so it is attached
		// to the record right away, before another search displaces it from the history.
		this.events.on('download.added', ({ hash }) => this.recordSearchResult(hash));
	}

	/**
	 * Keeps on the download record a snapshot of the search result it was added from, so Transfers can show
	 * where the release came from (label, website page) without the frontend carrying that along. Looked up
	 * in the recent searches first, then in the indexer feed, which still has it for releases the *arr grabs
	 * from the RSS feed long after the search left the history.
	 */
	private recordSearchResult(hash: string): void {
		const result = this.searchHistory.findByHash(hash);
		const json = result ? JSON.stringify(result) : (this.db.getIndexerFeedItem(hash)?.search_result ?? null);
		if (json) {
			this.db.setDownloadSearchResult(hash, json);
		}
	}

	/**
	 * Fire-and-forget search on the providers the criteria select (see SearchCriteria.providers). `interactive`
	 * marks one driven by a client that polls getSearchResults itself (the web UI): background searches (see
	 * searchAndCollect) hold off while such a search is recent, because starting another one would replace
	 * the results the client is watching.
	 */
	async startSearch(criteria: SearchCriteria, interactive = false): Promise<void> {
		const providers = this.selectProviders(criteria);
		if (interactive) this._lastInteractiveSearchAt = Date.now();
		await Promise.allSettled(providers.map((p) => p.startSearch({ ...criteria, interactive })));
		this.searchHistory.addEntry(criteria.query, criteria.query);
		this.events.emit('search.started', { query: criteria.query });
	}

	/** Providers taking part in a search: those named by criteria.providers, or all of them. Throws when none of the named ones exists. */
	private selectProviders(criteria: SearchCriteria): IMediaProvider[] {
		const wanted = criteria.providers;
		if (!wanted) return this.providers;
		const selected = this.providers.filter((p) => wanted.includes(p.providerId));
		if (selected.length === 0) throw new Error(`None of the selected search providers is available: ${wanted.join(', ')}`);
		return selected;
	}

	/** Epoch ms of the last interactive startSearch; 0 when none happened yet. */
	get lastInteractiveSearchAt(): number {
		return this._lastInteractiveSearchAt;
	}

	/** Results of the current search across every provider, as the web UI polls them. */
	getSearchResults(): Promise<MediaSearchResponse> {
		return this.collectResults(this.providers);
	}

	private async collectResults(providers: IMediaProvider[]): Promise<MediaSearchResponse> {
		const perProvider = await Promise.allSettled(providers.map((p) => p.getSearchResults()));
		const combined: MediaSearchResult[] = [];
		for (const r of perProvider) {
			if (r.status === 'fulfilled') {
				combined.push(...r.value);
				this.searchHistory.pushResults(r.value);
			}
		}
		const { visible, blacklistedCount } = this.filterBlacklisted(combined);
		return { raw: `Found ${visible.length} results`, list: visible, blacklistedCount };
	}

	/** Removes blacklisted results (see blacklistEntryMatches for the hash+size rule). */
	private filterBlacklisted(results: MediaSearchResult[]): { visible: MediaSearchResult[]; blacklistedCount: number } {
		const entries = this.db.getBlacklist();
		if (entries.length === 0) return { visible: results, blacklistedCount: 0 };
		const byHash = new Map(entries.map((e) => [e.hash.toLowerCase(), e]));
		const visible = results.filter((r) => {
			const entry = r.hash ? byHash.get(r.hash.toLowerCase()) : undefined;
			return !entry || !blacklistEntryMatches(entry, r.size);
		});
		return { visible, blacklistedCount: results.length - visible.length };
	}

	getSearchStatus(): Promise<MediaSearchStatusResponse> {
		return this.collectStatus(this.providers);
	}

	private async collectStatus(providers: IMediaProvider[]): Promise<MediaSearchStatusResponse> {
		// Overall progress = minimum across providers (all must finish before we report 1.0)
		const statuses = await Promise.allSettled(providers.map((p) => p.getSearchStatus()));
		let min = 1;
		for (const s of statuses) {
			if (s.status === 'fulfilled') min = Math.min(min, s.value);
		}
		return { raw: `Search progress: ${(min * 100).toFixed(0)}%`, progress: min };
	}

	/**
	 * Runs a search and resolves with its (blacklist-filtered) results once they settle, see the SEARCH_*
	 * constants. Concurrent callers are serialized: a second search would replace the first one's results.
	 */
	searchAndCollect(criteria: SearchCriteria): Promise<MediaSearchResult[]> {
		const run = this.searchQueue.then(() => this.doSearchAndCollect(criteria));
		this.searchQueue = run.catch(() => {});
		return run;
	}

	private async doSearchAndCollect(criteria: SearchCriteria): Promise<MediaSearchResult[]> {
		// Only the providers searched are polled: a provider left out would report the results of its previous search
		const providers = this.selectProviders(criteria);
		await this.startSearch(criteria);
		const startedAt = Date.now();
		let lastCount = -1;
		let stable = 0;
		while (Date.now() - startedAt < SEARCH_MAX_WAIT_MS) {
			await new Promise((r) => setTimeout(r, SEARCH_POLL_MS));
			const status = await this.collectStatus(providers);
			const current = (await this.collectResults(providers)).list.length;
			if (current === lastCount) {
				stable++;
				if (status.progress >= 1 && stable >= SEARCH_STABLE_POLLS) break;
			} else {
				stable = 0;
			}
			lastCount = current;
			this.logger.debug(`Search progress: ${Math.floor(status.progress * 100)}%, results so far: ${current}`);
		}
		return (await this.collectResults(providers)).list;
	}
}

type MediaSearchResultsByHash = Record<string, MediaSearchResult>;

interface SearchHistoryEntry {
	id: string;
	query: string;
	timestamp: number;
	results: MediaSearchResultsByHash;
}

/**
 * A simple in-memory cache for search results, keyed by query string.
 * Bad things will happend if and external service triggers a search on amule which is not handled by mularr
 */
class SearchHistory {
	private readonly searchesById: Record<string, SearchHistoryEntry> = {};
	private current: SearchHistoryEntry | null = null;

	addEntry(id: string, query: string, results: MediaSearchResultsByHash = {}) {
		if (this.current) {
			this.controlHistorySize();
			this.searchesById[this.current.id] = this.current;
		}
		this.current = { id, query, timestamp: Date.now(), results };
	}

	private controlHistorySize() {
		const MAX_HISTORY_SIZE = 10;
		const entries = Object.values(this.searchesById);
		if (entries.length > MAX_HISTORY_SIZE) {
			// Sort by timestamp and remove the oldest entries
			entries.sort((a, b) => a.timestamp - b.timestamp);
			const excessCount = entries.length - MAX_HISTORY_SIZE;
			for (let i = 0; i < excessCount; i++) {
				delete this.searchesById[entries[i].id];
			}
		}
	}

	/** A result of the current or a kept search, most recent first, by hash (case-insensitive); undefined when none matches. */
	findByHash(hash: string): MediaSearchResult | undefined {
		const wanted = hash.toLowerCase();
		const kept = Object.values(this.searchesById).sort((a, b) => b.timestamp - a.timestamp);
		for (const entry of this.current ? [this.current, ...kept] : kept) {
			const found = entry.results[hash] ?? Object.values(entry.results).find((r) => r.hash.toLowerCase() === wanted);
			if (found) return found;
		}
		return undefined;
	}

	pushResults(results: MediaSearchResult[]) {
		if (!this.current) return;
		for (const r of results) {
			this.current.results[r.hash] = r;
		}
	}

	/**
	 * Returns a read-only view of the search history, keyed by search ID.
	 * The current search (if any) is not included in the returned object.
	 */
	getFullHistory() {
		return this.searchesById as Readonly<typeof this.searchesById>;
	}

	deleteEntry(id: string) {
		if (this.current?.id === id) {
			this.current = null;
		} else {
			delete this.searchesById[id];
		}
	}
}
