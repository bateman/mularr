import { BaseApiService } from './BaseApiService';
import type { SpeedSample } from './apiTypes';

// Wire contract owned by the backend (see apiTypes.ts)
export type { SpeedSample };

export interface SpeedHistoryResponse {
	samples: SpeedSample[];
}

export class DashboardApiService extends BaseApiService {
	constructor() {
		super('/api/stats');
	}

	/**
	 * Fetch the full speed-history buffer (or only samples newer than `since` ms timestamp).
	 */
	async getSpeedHistory(since?: number): Promise<SpeedHistoryResponse> {
		const qs = since != null ? `?since=${since}` : '';
		return this.request<SpeedHistoryResponse>(`/speed-history${qs}`);
	}
}
