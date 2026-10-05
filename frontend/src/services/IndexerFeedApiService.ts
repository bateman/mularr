import { BaseApiService } from './BaseApiService';
import type { ArrSyncStatusResponse, IndexerFeedListResponse, IndexerFeedMediaType, WantedListResponse } from './apiTypes';

export type {
	ArrSyncExtensionStatus,
	ArrSyncStatusResponse,
	IndexerFeedItem,
	IndexerFeedListResponse,
	IndexerFeedMediaType,
	WantedItem,
	WantedListResponse,
} from './apiTypes';

export interface IndexerFeedListParams {
	type?: IndexerFeedMediaType;
	/** Case-insensitive substring of the release name. */
	search?: string;
	/** Only releases found for this wanted title (WantedItem.key). */
	jobKey?: string;
	offset?: number;
	limit?: number;
}

/** Feed served to Sonarr/Radarr by the Torznab endpoint, and the *arr wanted sync that fills it. */
export class IndexerFeedApiService extends BaseApiService {
	constructor() {
		super('/api/indexer-feed');
	}

	async list(params: IndexerFeedListParams = {}): Promise<IndexerFeedListResponse> {
		const query = new URLSearchParams();
		if (params.type) query.set('type', params.type);
		if (params.search) query.set('q', params.search);
		if (params.jobKey) query.set('job', params.jobKey);
		if (params.offset !== undefined) query.set('offset', String(params.offset));
		if (params.limit !== undefined) query.set('limit', String(params.limit));
		const qs = query.toString();
		return this.request<IndexerFeedListResponse>(qs ? `?${qs}` : '');
	}

	async removeItem(hash: string): Promise<void> {
		await this.request<void>(`/${encodeURIComponent(hash)}`, { method: 'DELETE' });
	}

	async clear(): Promise<{ success: boolean; removed: number }> {
		return this.request<{ success: boolean; removed: number }>('', { method: 'DELETE' });
	}

	/** Wanted titles read live from every enabled Sonarr/Radarr, with the sync's knowledge of each. */
	async getWanted(): Promise<WantedListResponse> {
		return this.request<WantedListResponse>('/wanted');
	}

	async getSyncStatus(): Promise<ArrSyncStatusResponse> {
		return this.request<ArrSyncStatusResponse>('/sync-status');
	}

	/** Requests a run of one Sonarr/Radarr extension; runs right away or after the current run. */
	async runSync(extensionId: number): Promise<{ success: boolean; status: ArrSyncStatusResponse }> {
		return this.request<{ success: boolean; status: ArrSyncStatusResponse }>(`/sync/${extensionId}`, { method: 'POST' });
	}
}
