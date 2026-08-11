import { inject, signal, computed } from 'chispa';
import { WsService } from './WsService';
import type { StatsResponse } from './AmuleApiService';

export class StatsService {
	private ws = inject(WsService);

	/** Reactive aMule status – updated via WebSocket. */
	public readonly stats = computed<StatsResponse | null>(() => this.ws.amuleStatus.get());
}
