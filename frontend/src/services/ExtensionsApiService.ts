import { BaseApiService } from './BaseApiService';

export type ExtensionType = /*'validator' | 'enhanced_search' |*/ 'webhook' | 'telegram_indexer' | 'media_previewer';

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
};

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
}
