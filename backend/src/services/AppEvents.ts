import type { DownloadDbRecord } from './db/MainDB';

/** Payload shared by every download.* event. */
export interface DownloadEventPayload {
	hash: string;
	name: string;
	size: number;
	category: string | null;
	provider: string;
}

/** Domain events emitted across the app, with the payload each one carries. */
export interface AppEventPayloads {
	'download.added': DownloadEventPayload & { link: string };
	'download.completed': DownloadEventPayload;
	'download.cancelled': DownloadEventPayload;
	'search.started': { query: string };
	'blacklist.added': { hash: string; name: string; size: number | null; reason: string | null };
	'system.alert': { message: string };
}

export type AppEvent = keyof AppEventPayloads;

export const APP_EVENTS: readonly AppEvent[] = [
	'download.added',
	'download.completed',
	'download.cancelled',
	'search.started',
	'blacklist.added',
	'system.alert',
];

export function isAppEvent(value: unknown): value is AppEvent {
	return typeof value === 'string' && (APP_EVENTS as readonly string[]).includes(value);
}

type Listener<E extends AppEvent> = (payload: AppEventPayloads[E]) => void;
type AnyListener = (event: AppEvent, payload: AppEventPayloads[AppEvent]) => void;

/**
 * In-process typed event bus. Emitters publish domain events without knowing who
 * consumes them (webhooks, notifications...). Listener errors are logged and never
 * reach the emitter, so emit() is always safe to call inline.
 */
export class AppEvents {
	private readonly listeners = new Map<AppEvent, Set<(payload: any) => void>>();
	private readonly anyListeners = new Set<AnyListener>();

	on<E extends AppEvent>(event: E, listener: Listener<E>): void {
		if (!this.listeners.has(event)) this.listeners.set(event, new Set());
		this.listeners.get(event)!.add(listener);
	}

	/** Subscribes to every event. */
	onAny(listener: AnyListener): void {
		this.anyListeners.add(listener);
	}

	emit<E extends AppEvent>(event: E, payload: AppEventPayloads[E]): void {
		for (const listener of this.listeners.get(event) ?? []) this.safeCall(event, () => listener(payload));
		for (const listener of this.anyListeners) this.safeCall(event, () => listener(event, payload));
	}

	private safeCall(event: AppEvent, fn: () => void): void {
		try {
			fn();
		} catch (error) {
			console.error(`[AppEvents] Listener error for ${event}:`, error);
		}
	}
}

/**
 * Maps a downloads-table record to the public download.* payload so DB column names never leak into the contract.
 * Only the hash is required: downloads not tracked in the DB get empty defaults for the rest.
 */
export function toDownloadEventPayload(record: Pick<DownloadDbRecord, 'hash'> & Partial<DownloadDbRecord>, provider: string): DownloadEventPayload {
	return { hash: record.hash, name: record.name ?? '', size: record.size ?? 0, category: record.category_name ?? null, provider };
}
