import { BaseApiService } from './BaseApiService';

export type ExtensionType = /*'validator' | 'enhanced_search' |*/ 'webhook' | 'telegram_indexer' | 'media_previewer' | 'sonarr' | 'radarr';

export interface Extension {
	id: number;
	name: string;
	url: string;
	type: ExtensionType;
	enabled: number;
	config?: string;
}

export const EXTENSION_TYPES: Record<ExtensionType, { label: string; requiresUrl: boolean }> = {
	// validator: { label: 'Validator', requiresUrl: true },
	// enhanced_search: { label: 'Enhanced Search', requiresUrl: false },
	webhook: { label: 'Webhook', requiresUrl: true },
	telegram_indexer: { label: 'Telegram Indexer', requiresUrl: false },
	media_previewer: { label: 'Media Previewer', requiresUrl: true },
	sonarr: { label: 'Sonarr', requiresUrl: true },
	radarr: { label: 'Radarr', requiresUrl: true },
};

/** Extension types that sync a *arr wanted list into the Torznab RSS feed. */
export const ARR_EXTENSION_TYPES: readonly ExtensionType[] = ['sonarr', 'radarr'];

export function isArrExtensionType(type: string): boolean {
	return (ARR_EXTENSION_TYPES as readonly string[]).includes(type);
}

/** Must match ARR_SYNC_*_INTERVAL_MINUTES in backend/src/services/arrsync/ArrSyncService.ts. */
export const ARR_SYNC_DEFAULT_INTERVAL_MINUTES = 60;
export const ARR_SYNC_MIN_INTERVAL_MINUTES = 15;

/** Settings of a sonarr/radarr extension, stored as { apiKey, intervalMinutes } in its config. */
export interface ArrExtensionConfig {
	apiKey: string;
	intervalMinutes: number;
}

export function parseArrConfig(config?: string): ArrExtensionConfig {
	try {
		const parsed = JSON.parse(config || '{}');
		return {
			apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
			intervalMinutes: Number.isInteger(parsed.intervalMinutes) ? parsed.intervalMinutes : ARR_SYNC_DEFAULT_INTERVAL_MINUTES,
		};
	} catch {
		return { apiKey: '', intervalMinutes: ARR_SYNC_DEFAULT_INTERVAL_MINUTES };
	}
}

/** App events a webhook extension can subscribe to. Must match AppEvent in backend/src/services/AppEvents.ts. */
export const WEBHOOK_EVENTS: { id: string; label: string; description: string }[] = [
	{ id: 'download.added', label: 'Download Added', description: 'A new download is added to the queue' },
	{ id: 'download.completed', label: 'Download Completed', description: 'A download finishes and the file is available' },
	{ id: 'download.cancelled', label: 'Download Cancelled', description: 'A download is cancelled and removed' },
	{ id: 'search.started', label: 'Search Started', description: 'A new search is launched' },
	{ id: 'blacklist.added', label: 'Blacklist Entry Added', description: 'A hash is added to the blacklist' },
	{ id: 'system.alert', label: 'System Alert', description: 'Monitoring notifications (daemon restarts, VPN issues...)' },
];

/** Events a webhook extension is subscribed to, stored as { events: string[] } in its config. */
export function parseWebhookEvents(config?: string): string[] {
	try {
		const parsed = JSON.parse(config || '{}');
		return Array.isArray(parsed.events) ? parsed.events : [];
	} catch {
		return [];
	}
}

export class ExtensionsApiService extends BaseApiService {
	constructor() {
		super('/api/extensions');
	}

	async getExtensions(): Promise<Extension[]> {
		return this.request<Extension[]>('');
	}

	async addExtension(v: Partial<Extension>): Promise<{ success: boolean; id?: number }> {
		return this.request<{ success: boolean; id?: number }>('', {
			method: 'POST',
			body: JSON.stringify(v),
		});
	}

	async deleteExtension(id: number): Promise<void> {
		return this.request<void>(`/${id}`, { method: 'DELETE' });
	}

	async toggleExtension(id: number, enabled: boolean): Promise<void> {
		return this.request<void>(`/${id}/toggle`, {
			method: 'PATCH',
			body: JSON.stringify({ enabled }),
		});
	}

	async updateExtensionUrl(id: number, url: string): Promise<void> {
		return this.request<void>(`/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ url }),
		});
	}

	async updateExtensionConfig(id: number, config: object): Promise<void> {
		return this.request<void>(`/${id}/config`, {
			method: 'PATCH',
			body: JSON.stringify({ config }),
		});
	}

	/** Checks the given settings against the remote service without saving them. Rejects with the reason on failure. */
	async testConnection(type: ExtensionType, url: string, config: object): Promise<{ success: boolean; message: string }> {
		return this.request<{ success: boolean; message: string }>('/test-connection', {
			method: 'POST',
			body: JSON.stringify({ type, url, config }),
		});
	}
}
