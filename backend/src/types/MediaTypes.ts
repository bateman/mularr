/**
 * Wire contract for transfers and search results, shared with the frontend through
 * frontend/src/services/apiTypes.ts. Keep this module free of imports (no libraries, no Node APIs):
 * the frontend build type-checks it without backend/node_modules.
 */

export enum CHUNK_STATUS {
	UNAVAILABLE = 0,
	AVAILABLE = 1,
	COMPLETE = 2,
	DOWNLOADING = 3,
}

export interface ChunkInfo {
	chunkStates: CHUNK_STATUS[];
	chunkAvailability: number[];
	partCount: number;
	sizeFull: number;
}

export interface TransferSource {
	clientName?: string;
	ip?: string;
	port?: number;
	software?: string;
	softwareVersion?: string;
	downloadSpeed?: number;
	uploadSpeed?: number;
	availableParts?: number;
	remoteFilename?: string;
	sourceFrom?: number;
	remoteQueueRank?: number;
	waitingPosition?: number;
}

export interface TransferSourceNameCount {
	name: string;
	count: number;
}

/** One download as exposed by /api/media/transfers and the media:transfers WebSocket message, whatever the provider. */
export interface MediaTransfer {
	rawLine: string;
	name?: string;
	size?: number;
	completed?: number;
	speed?: number;
	isCompleted?: boolean;
	progress?: number;
	sourceCount?: number;
	priority?: number;
	status?: string;
	statusId?: number;
	stopped?: boolean;
	remaining?: number;
	hash?: string;
	link?: string;
	timeLeft?: number;
	categoryName?: string | null;
	/** ISO timestamp of when the download was added, when tracked. */
	addedOn?: string | null;
	provider?: string;
	/** Resolved absolute path to the file on disk. Populated by MediaProviderService. */
	filePath?: string;
	/** Human-readable source label (e.g. Telegram chat name). Provider-agnostic. */
	sourceName?: string;
	/** Chunk information for the transfer. */
	chunkInfo?: ChunkInfo;
	/** Peers currently related to this transfer (download sources). */
	sources?: TransferSource[];
	/** Aggregated source names (client names grouped by count). */
	sourceNames?: TransferSourceNameCount[];
}

/**
 * aMule category as exposed by the API. The EC library types every field as optional; AmuleService
 * normalizes them before anything leaves the backend, so consumers can rely on them being present.
 */
export interface MediaCategory {
	id: number;
	name: string;
	path: string;
	comment: string;
	color: number;
	priority: number;
	/** Effective directory on disk: `path` if set, otherwise aMule's global IncomingDir. Only /api/amule/categories fills it. */
	resolvedPath?: string;
}

export interface MediaTransfersResponse {
	raw: string;
	list: MediaTransfer[];
	categories: MediaCategory[];
}

export interface MediaSearchResult {
	name: string;
	size: number;
	hash: string;
	link?: string;
	sourceCount?: number;
	completeSourceCount?: number;
	downloadStatus?: number;
	type?: string;
	provider: string;
	/** Human-readable source label (e.g. Telegram chat name). Provider-agnostic. */
	sourceName?: string;
}

export interface MediaSearchResponse {
	raw: string;
	list: MediaSearchResult[];
	/** Number of results hidden because their hash is blacklisted. */
	blacklistedCount?: number;
}

export interface MediaSearchStatusResponse {
	raw: string;
	progress: number; // 0–1
}
