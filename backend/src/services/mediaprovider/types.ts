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

export interface IMediaProvider {
	readonly providerId: string;

	/** Return true if this provider should handle the given link/hash. */
	canHandleDownload(link: string): boolean;

	/** Fire-and-forget search initiation. */
	startSearch(query: string): Promise<void>;

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
