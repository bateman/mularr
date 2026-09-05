import { MainDB, Extension, ValidationResult } from '../services/db/MainDB';
import { container } from './container/ServiceContainer';
import { AppEvent, AppEvents, isAppEvent } from './AppEvents';

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

export class ExtensionsService {
	private readonly db = container.get(MainDB);
	private readonly events = container.get(AppEvents);

	constructor() {
		// Forward every app event to the 'webhook' extensions subscribed to it
		this.events.onAny((event, payload) => this.dispatchToWebhooks(event, payload));
	}

	// CRUD Extensions
	getAllExtensions(): Extension[] {
		return this.db.getAllExtensions();
	}

	addExtension(extension: Omit<Extension, 'id'>) {
		return this.db.addExtension(extension);
	}

	deleteExtension(id: number) {
		this.db.deleteExtension(id);
	}

	toggleExtension(id: number, enabled: boolean) {
		this.db.toggleExtension(id, enabled);
	}

	/**
	 * Changes the endpoint an extension points to. Only the URL is editable after creation:
	 * the type is fixed and everything else lives in `config`.
	 */
	updateExtensionUrl(id: number, url: unknown) {
		const extension = this.db.getExtensionById(id);
		if (!extension) throw new Error(`Extension ${id} not found`);
		if (typeof url !== 'string' || !isHttpUrl(url.trim())) {
			throw new Error('url must be a valid http(s) URL');
		}
		this.db.updateExtensionUrl(id, url.trim());
	}

	updateExtensionConfig(id: number, config: Record<string, unknown>) {
		const extension = this.db.getExtensionById(id);
		if (!extension) throw new Error(`Extension ${id} not found`);
		if (extension.type === 'webhook') {
			const events = config.events;
			if (!Array.isArray(events) || !events.every(isAppEvent)) {
				throw new Error('Webhook config must contain an "events" array of valid event names');
			}
		}
		this.db.updateExtensionConfig(id, JSON.stringify(config));
	}

	// Webhooks
	/**
	 * Sends the event to every enabled 'webhook' extension subscribed to it.
	 * Scheme: POST <extension.url> { event, timestamp, data }
	 * Webhooks are called in parallel; failures are logged and never propagate.
	 */
	private dispatchToWebhooks(event: AppEvent, data: unknown): void {
		try {
			const webhooks = this.getAllExtensions().filter((v) => v.enabled && v.type === 'webhook' && this.getSubscribedEvents(v).includes(event));
			if (webhooks.length === 0) return;

			const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data });
			for (const webhook of webhooks) void this.postWebhook(webhook, event, body);
		} catch (error) {
			console.error(`[ExtensionsService] Failed to dispatch ${event} to webhooks:`, error);
		}
	}

	/** Never rejects: every failure is logged here. */
	private async postWebhook(webhook: Extension, event: AppEvent, body: string): Promise<void> {
		try {
			const response = await fetch(webhook.url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) {
				throw new Error(`Webhook responded ${response.status}`);
			}
		} catch (error: any) {
			console.error(`[ExtensionsService] Webhook ${webhook.name} failed for ${event}:`, error?.message ?? error);
		}
	}

	/** Events a webhook extension is subscribed to, stored as { events: string[] } in its config. */
	private getSubscribedEvents(webhook: Extension): string[] {
		try {
			const config = JSON.parse(webhook.config || '{}');
			return Array.isArray(config.events) ? config.events : [];
		} catch {
			return [];
		}
	}

	// Validations
	/**
	 * Returns true if the file is considered safe/valid to be exposed as 100% completed.
	 */
	getValidationStatus(fileHash: string): boolean {
		// Get all enabled extensions, strictly of type 'validator'
		const extensions = this.getAllExtensions().filter((v) => v.enabled && v.type === 'validator');
		if (extensions.length === 0) return true; // No validators = no restrictions

		// Check results
		const results = this.db.getValidationsForFile(fileHash);

		// Every enabled validator must have a 'passed' result
		for (const v of extensions) {
			const res = results.find((r) => r.extension_id === v.id);
			if (!res || res.status !== 'passed') return false;
		}
		return true;
	}

	getResultsForFile(fileHash: string): ValidationResult[] {
		return this.db.getValidationsForFile(fileHash);
	}

	async processFile(fileHash: string, filePath: string) {
		// Only process Type 'validator'
		const extensions = this.getAllExtensions().filter((v) => v.enabled && v.type === 'validator');
		if (extensions.length === 0) return;

		console.log(`[ExtensionsService] Processing file ${fileHash} (${filePath})`);

		for (const v of extensions) {
			// Check if already validated (optional, but good optimize)
			const existing = this.db.getValidation(fileHash, v.id);
			if (existing && existing.status === 'passed') continue;

			// Trigger validation
			try {
				// Initial status pending
				this.upsertValidation(fileHash, v.id, 'pending', 'Starting validation...');

				// Call external API
				// Scheme: POST /validate { fileHash, filePath }
				const response = await fetch(v.url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ fileHash, filePath }),
				});

				if (!response.ok) {
					throw new Error(`Validator responded ${response.status}`);
				}

				const data = await response.json();
				// Assume response: { valid: boolean, details: string }
				const status = data.valid ? 'passed' : 'failed';
				this.upsertValidation(fileHash, v.id, status, data.details || 'Validation completed');
				console.log(`[ExtensionsService] Validator ${v.name} result for ${fileHash}: ${status}`);
			} catch (error: any) {
				console.error(`Validator ${v.name} failed:`, error);
				this.upsertValidation(fileHash, v.id, 'failed', error.message);
			}
		}
	}

	private upsertValidation(fileHash: string, extensionId: number, status: string, details: string) {
		this.db.upsertValidation(fileHash, extensionId, status, details);
	}
}
