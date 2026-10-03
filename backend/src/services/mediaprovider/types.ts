import type { MediaTransfer, MediaSearchResult } from '../../types/MediaTypes';

// ---------------------------------------------------------------------------
// Shared transfer / search types
// ---------------------------------------------------------------------------

// The wire contract lives in src/types (the frontend imports it from there too) and is re-exported
// here so backend code keeps importing from this module.
export { CHUNK_STATUS } from '../../types/MediaTypes';
export type {
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
}

export interface IMediaProvider {
	readonly providerId: string;

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
