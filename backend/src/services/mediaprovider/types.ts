import type { MediaTransfer, MediaSearchResult } from '../../types/MediaTypes';

// ---------------------------------------------------------------------------
// Shared transfer / search types
// ---------------------------------------------------------------------------

// The wire contract lives in src/types (the frontend imports it from there too) and is re-exported
// here so backend code keeps importing from this module.
export { CHUNK_STATUS, SEARCH_PROVIDER_IDS } from '../../types/MediaTypes';
export type {
	SearchProviderId,
	ChunkInfo,
	TransferSource,
	TransferSourceNameCount,
	MediaCategory,
	MediaTransfer,
	MediaTransfersResponse,
	MediaSearchResult,
	MediaSearchResponse,
	MediaSearchStatusResponse,
} from '../../types/MediaTypes';

// ---------------------------------------------------------------------------
// IMediaProvider contract
// ---------------------------------------------------------------------------

/**
 * What a search is looking for. Every provider handles `query`; the identifiers are hints for providers
 * that can look a title up directly (a provider that ignores them just searches by text).
 */
export interface SearchCriteria {
	query: string;
	/** IMDb id of the wanted title ("tt0133093"), when the caller knows it (the *arr wanted sync does). */
	imdbId?: string | null;
	/**
	 * eD2k network scope chosen in the UI dropdown: 'Global' (default), 'Local' or 'Kad', matched
	 * case-insensitively by AmuleService. Only the aMule provider has a use for it.
	 */
	amuleSearchType?: string;
	/**
	 * Set by MediaSearchService: true when a user is waiting for the results (web UI), false for background
	 * searches (Torznab, *arr wanted sync). Rate-limited providers use it to keep quota for the former.
	 */
	interactive?: boolean;
	/**
	 * Ids of the providers to search (see SEARCH_PROVIDER_IDS); every provider when absent. Honoured by
	 * MediaSearchService, which leaves the others out of the search and of the collected results. The *arr
	 * wanted sync sets it from the extension's config, e.g. to keep an unreliable network out of the feed.
	 */
	providers?: readonly string[];
}

export interface IMediaProvider {
	readonly providerId: string;

	/**
	 * Whether searches reach this provider right now (its service is configured and switched on). Listed to
	 * the UI as the providers one can pick; an unavailable provider answers searches with no results.
	 */
	isAvailable(): boolean;

	/** Return true if this provider should handle the given link/hash. */
	canHandleDownload(link: string): boolean;

	/** Fire-and-forget search initiation. */
	startSearch(criteria: SearchCriteria): Promise<void>;

	/** Return cached/latest search results for this provider. */
	getSearchResults(): Promise<MediaSearchResult[]>;

	/** 0 = not started / in-progress, 1 = complete. */
	getSearchStatus(): Promise<number>;

	addDownload(link: string): Promise<void>;
	removeDownload(hash: string): Promise<void>;
	pauseDownload(hash: string): Promise<void>;
	resumeDownload(hash: string): Promise<void>;
	stopDownload(hash: string): Promise<void>;

	getTransfers(): Promise<MediaTransfer[]>;

	/** Clear completed transfers tracked by this provider. */
	clearCompletedTransfers(hashes?: string[]): Promise<void>;
}
