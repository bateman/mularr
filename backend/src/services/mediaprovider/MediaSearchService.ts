import { randomUUID } from 'crypto';
import { container } from '../container/ServiceContainer';
import { MainDB, blacklistEntryMatches } from '../db/MainDB';
import { AppEvents } from '../AppEvents';
import { MediaProviderService } from './MediaProviderService';
import type { IMediaProvider, MediaSearchResult, MediaSearchResponse, MediaSearchStatusResponse, ProviderSearch, SearchCriteria } from './types';
import { LoggerFactory } from '../logging/Logger';
import { sleep } from '../../tools/asyncTools';
import { RecentResults, type RecentResult } from '../../tools/recentResults';

/**
 * Polling parameters of searchAndCollect. Gather until the result set stops growing, not just until EC
 * progress hits 100%: progress reaches 1 as soon as the first responses land, but a global eD2k search
 * keeps trickling results for many seconds; returning early yields a small, non-deterministic snapshot
 * (observed ~17 vs ~126) that drops long-tail releases. So the set is polled and the wait ends only once
 * its size is stable across STABLE_POLLS polls AND the search reports done, or MAX_WAIT_MS elapses —
 * favouring completeness over speed, within the *arr request timeout. That wait only starts once every
 * provider has begun the search (see SEARCH_QUEUE_TIMEOUT_MS).
 */
const SEARCH_POLL_MS = 1500;
const SEARCH_MAX_WAIT_MS = 12000;
const SEARCH_STABLE_POLLS = 3;
/**
 * Longest a collected search waits for its providers to begin before it is collected as is. aMule runs one
 * search at a time and holds a new one in a queue while an earlier search has the daemon (see AmuleMediaProvider).
 */
const SEARCH_QUEUE_TIMEOUT_MS = 60000;
/** Searches kept retrievable by id, most recent first; older ones are dropped with their results. */
const MAX_KEPT_SEARCHES = 20;
/**
 * How long searchAndCollectReused hands out the results of a search again, from the moment they were collected.
 * Long enough for the requests that follow one another (next pages, the next episodes of a season), short enough
 * that a search asked for again later runs again and finds what was shared since.
 */
const SEARCH_REUSE_MS = 3 * 60 * 1000;
/** Searches whose results searchAndCollectReused keeps at once, the oldest dropped first. */
const MAX_REUSED_SEARCHES = 20;

/** The results of a collected search, and whether every provider began it before SEARCH_QUEUE_TIMEOUT_MS. */
interface CollectedSearch {
	list: MediaSearchResult[];
	complete: boolean;
}

/** A search across providers, with the handle each provider gave for it. */
interface Search {
	id: string;
	criteria: SearchCriteria;
	parts: { provider: IMediaProvider; search: ProviderSearch }[];
}

/**
 * Coordinates searches across the media providers. Every search gets an id and its own result buffers
 * (see ProviderSearch), so searches started at the same time by several clients (two web UI sessions, the
 * Torznab indexer, the *arr wanted sync) never read each other's results. Whether two can actually run at
 * once is the provider's business: aMule queues them, the others run them side by side.
 */
export class MediaSearchService {
	private readonly logger = LoggerFactory.create(this);
	private readonly db = container.get(MainDB);
	private readonly events = container.get(AppEvents);
	private readonly providers = container.get(MediaProviderService).providers;
	/** Kept searches by id, in start order (Map keeps insertion order). */
	private readonly searches = new Map<string, Search>();
	/**
	 * Collected searches searchAndCollectReused hands out again. Empty ones are not kept (aMule not connected yet,
	 * or nothing shared: worth asking again), nor those a provider still held in its queue when the wait ran out.
	 */
	private readonly reusable = new RecentResults<CollectedSearch>(SEARCH_REUSE_MS, MAX_REUSED_SEARCHES, (s) => s.complete && s.list.length > 0);

	constructor() {
		// A download is added by hash or link; the result it came from is only known here, so it is attached
		// to the record right away, before the search is dropped from the kept ones.
		this.events.on('download.added', ({ hash }) => void this.recordSearchResult(hash));
	}

	/**
	 * Keeps on the download record a snapshot of the search result it was added from, so Transfers can show
	 * where the release came from (label, website page) without the frontend carrying that along. Looked up
	 * in the kept searches first, then in the indexer feed, which still has it for releases the *arr grabs
	 * from the RSS feed long after the search was dropped.
	 */
	private async recordSearchResult(hash: string): Promise<void> {
		try {
			const result = await this.findResultByHash(hash);
			const json = result ? JSON.stringify(result) : (this.db.getIndexerFeedItem(hash)?.search_result ?? null);
			if (json) this.db.setDownloadSearchResult(hash, json);
		} catch (e: any) {
			this.logger.warn(`Could not record the search result of download ${hash}:`, e?.message ?? e);
		}
	}

	/** A result of a kept search, most recent search first, by hash (case-insensitive); undefined when none matches. */
	private async findResultByHash(hash: string): Promise<MediaSearchResult | undefined> {
		const wanted = hash.toLowerCase();
		for (const search of [...this.searches.values()].reverse()) {
			for (const part of search.parts) {
				const found = (await part.search.getResults()).find((r) => r.hash.toLowerCase() === wanted);
				if (found) return found;
			}
		}
		return undefined;
	}

	/**
	 * Starts a search on the providers the criteria select (see SearchCriteria.providers) and returns its id,
	 * which getSearchResults / getSearchStatus take. `interactive` marks one a user is waiting for (the web
	 * UI); rate-limited providers keep quota for those.
	 */
	async startSearch(criteria: SearchCriteria, interactive = false): Promise<string> {
		const providers = this.selectProviders(criteria);
		const started = await Promise.allSettled(providers.map((p) => p.startSearch({ ...criteria, interactive })));
		const parts: Search['parts'] = [];
		started.forEach((r, i) => {
			if (r.status === 'fulfilled') parts.push({ provider: providers[i], search: r.value });
			else this.logger.warn(`${providers[i].providerId} could not start the search:`, r.reason?.message ?? r.reason);
		});
		const search: Search = { id: randomUUID(), criteria, parts };
		this.keep(search);
		this.events.emit('search.started', { query: criteria.query });
		return search.id;
	}

	private keep(search: Search): void {
		this.searches.set(search.id, search);
		while (this.searches.size > MAX_KEPT_SEARCHES) {
			const oldest = this.searches.keys().next().value;
			if (oldest === undefined) break;
			this.searches.delete(oldest);
		}
	}

	/** Providers taking part in a search: those named by criteria.providers, or all of them. Throws when none of the named ones exists. */
	private selectProviders(criteria: SearchCriteria): IMediaProvider[] {
		const wanted = criteria.providers;
		if (!wanted) return this.providers;
		const selected = this.providers.filter((p) => wanted.includes(p.providerId));
		if (selected.length === 0) throw new Error(`None of the selected search providers is available: ${wanted.join(', ')}`);
		return selected;
	}

	/**
	 * Ids of the available providers that answer an IMDb id with no text query (see IMediaProvider.searchesByImdbId).
	 * Empty when there is none: the Torznab indexer then neither advertises nor serves id searches.
	 */
	imdbIdSearchProviderIds(): string[] {
		return this.providers.filter((p) => p.searchesByImdbId && p.isAvailable()).map((p) => p.providerId);
	}

	/** A kept search by id; throws when it is unknown or was dropped (see MAX_KEPT_SEARCHES). */
	private getSearch(id: string): Search {
		const search = this.searches.get(id);
		if (!search) throw new UnknownSearchError(id);
		return search;
	}

	/** Results of a search so far, as the web UI polls them. */
	getSearchResults(id: string): Promise<MediaSearchResponse> {
		return this.collectResults(this.getSearch(id));
	}

	private async collectResults(search: Search): Promise<MediaSearchResponse> {
		const perProvider = await Promise.allSettled(search.parts.map((part) => part.search.getResults()));
		const combined: MediaSearchResult[] = [];
		for (const r of perProvider) {
			if (r.status === 'fulfilled') combined.push(...r.value);
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

	getSearchStatus(id: string): Promise<MediaSearchStatusResponse> {
		return this.collectStatus(this.getSearch(id));
	}

	private async collectStatus(search: Search): Promise<MediaSearchStatusResponse> {
		// Overall progress = minimum across providers (all must finish before we report 1.0)
		const statuses = await Promise.allSettled(search.parts.map((part) => part.search.getProgress()));
		let min = 1;
		for (const s of statuses) {
			if (s.status === 'fulfilled') min = Math.min(min, s.value);
		}
		const queued = search.parts.some((part) => part.search.queued);
		const raw = queued ? 'Waiting for an earlier search to finish' : `Search progress: ${(min * 100).toFixed(0)}%`;
		return { raw, progress: min, queued };
	}

	/**
	 * Runs a search and resolves with its (blacklist-filtered) results once they settle, see the SEARCH_*
	 * constants. Several callers may collect at once; each gets its own search's results.
	 */
	async searchAndCollect(criteria: SearchCriteria): Promise<MediaSearchResult[]> {
		return (await this.collect(criteria)).list;
	}

	/**
	 * searchAndCollect for the Torznab indexer, whose requests come in runs of the same search: the *arr ask for a
	 * long result list one page at a time, and Sonarr searches a season one episode at a time with the same title
	 * (the indexer filters by episode after the search). Each of them ran the whole eD2k search again, 13-15 s apiece,
	 * and since a network search never returns quite the same list twice, a page could repeat or skip releases of
	 * the page before. Now the results of a search with the same query, IMDb id and providers are handed out again
	 * for SEARCH_REUSE_MS, and a request that arrives while the same search is running waits for it. The blacklist
	 * is applied again on reuse, so an entry added in between is honoured.
	 */
	async searchAndCollectReused(criteria: SearchCriteria): Promise<RecentResult<MediaSearchResult[]>> {
		const providers = criteria.providers ? [...criteria.providers].sort() : null;
		const key = JSON.stringify([criteria.query, criteria.imdbId ?? null, providers, criteria.amuleSearchType ?? null]);
		const { value, startedAt, reused } = await this.reusable.get(key, () => this.collect(criteria));
		return { value: reused ? this.filterBlacklisted(value.list).visible : value.list, startedAt, reused };
	}

	private async collect(criteria: SearchCriteria): Promise<CollectedSearch> {
		const search = this.getSearch(await this.startSearch(criteria));
		const complete = await this.waitUntilStarted(search);
		if (complete) await this.waitUntilSettled(search);
		else this.logger.warn(`Search "${criteria.query}" still queued after ${SEARCH_QUEUE_TIMEOUT_MS / 1000} s; collecting what there is`);
		return { list: (await this.collectResults(search)).list, complete };
	}

	/** True once no provider holds the search in its queue; false when SEARCH_QUEUE_TIMEOUT_MS passes first. */
	private async waitUntilStarted(search: Search): Promise<boolean> {
		const deadline = Date.now() + SEARCH_QUEUE_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (!(await this.collectStatus(search)).queued) return true;
			await sleep(SEARCH_POLL_MS);
		}
		return false;
	}

	/** Returns once the search reports done and its result count held still for SEARCH_STABLE_POLLS polls, or after SEARCH_MAX_WAIT_MS. */
	private async waitUntilSettled(search: Search): Promise<void> {
		const deadline = Date.now() + SEARCH_MAX_WAIT_MS;
		let lastCount = -1;
		let stable = 0;
		while (Date.now() < deadline) {
			await sleep(SEARCH_POLL_MS);
			const status = await this.collectStatus(search);
			const current = (await this.collectResults(search)).list.length;
			stable = current === lastCount ? stable + 1 : 0;
			lastCount = current;
			this.logger.debug(`Search progress: ${Math.floor(status.progress * 100)}%, results so far: ${current}`);
			if (status.progress >= 1 && stable >= SEARCH_STABLE_POLLS) return;
		}
	}
}

/** The id names no kept search: it never existed, was dropped (see MAX_KEPT_SEARCHES) or predates a restart. */
export class UnknownSearchError extends Error {
	constructor(id: string) {
		super(`Unknown search: ${id}`);
		this.name = 'UnknownSearchError';
	}
}
