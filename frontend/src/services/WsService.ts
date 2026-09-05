import { inject, signal } from 'chispa';
import { AuthApiService } from './AuthApiService';
import type { StatsResponse, AmuleUpDownClient, Server, ServersResponse, AmuleFile } from './AmuleApiService';
import type { TransfersResponse } from './MediaApiService';
import type { SpeedSample } from './DashboardApiService';
import type { SystemInfo } from './SystemApiService';

/** Maximum speed-sample buffer kept in the frontend (matches DashboardView's chart window). */
const MAX_SPEED_SAMPLES = 2160;

/** Maximum number of aMule log lines kept in the frontend buffer. */
const MAX_LOG_LINES = 500;

/** A single aMule log line with a stable id for keyed list rendering. */
export interface LogLine {
	id: number;
	text: string;
}

/** Reconnect delays: 1 s, 2 s, 4 s … capped at 30 s. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** Close code the backend sends when the connection failed authentication. */
const WS_CLOSE_UNAUTHORIZED = 4401;

/**
 * WsService
 *
 * Maintains a single WebSocket connection to the backend (/ws) and exposes
 * reactive signals that are updated whenever the backend pushes new data.
 *
 * Components should read these signals directly instead of polling REST
 * endpoints for periodic data.
 *
 * Browsers can't set headers on a WebSocket, so the session JWT is passed as
 * `?token=` in the connection URL. If the backend rejects it (close code 4401)
 * the token is dropped and the page reloads so the login screen is shown,
 * mirroring how BaseApiService handles a 401 response.
 */
export class WsService {
	// ── Public signals ─────────────────────────────────────────────────────────
	public readonly connected = signal(false);
	public readonly amuleStatus = signal<StatsResponse | null>(null);
	public readonly transfers = signal<TransfersResponse | null>(null);
	public readonly uploadQueue = signal<{ list: AmuleUpDownClient[] } | null>(null);
	public readonly speedSamples = signal<SpeedSample[]>([]);
	public readonly amuleLog = signal<LogLine[]>([]);
	public readonly servers = signal<ServersResponse | null>(null);
	public readonly sharedFiles = signal<{ list: AmuleFile[] } | null>(null);
	public readonly systemInfo = signal<SystemInfo | null>(null);

	// ── Internals ──────────────────────────────────────────────────────────────
	private readonly auth = inject(AuthApiService);
	private ws: WebSocket | null = null;
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;
	private logLineSeq = 0;

	constructor() {
		this.connect();
	}

	// ── Connection management ──────────────────────────────────────────────────

	private buildUrl(): string {
		const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
		const url = new URL(`${proto}://${window.location.host}/ws`);
		const token = this.auth.getToken();
		if (token) url.searchParams.set('token', token);
		return url.toString();
	}

	private connect(): void {
		if (this.stopped) return;
		const url = this.buildUrl();
		const ws = new WebSocket(url);
		this.ws = ws;

		ws.addEventListener('open', () => {
			this.reconnectAttempt = 0;
			this.connected.set(true);
			console.log('[WS] Connected');
		});

		ws.addEventListener('close', (ev) => {
			this.connected.set(false);
			if (ev.code === WS_CLOSE_UNAUTHORIZED) {
				// Token missing, expired or invalid — same handling as a REST 401:
				// stop reconnecting, drop the token and reload so main.ts shows LoginView.
				console.warn('[WS] Unauthorized, reloading to login');
				this.stopped = true;
				this.auth.clearToken();
				window.location.reload();
				return;
			}
			console.log('[WS] Disconnected');
			this.scheduleReconnect();
		});

		ws.addEventListener('error', () => {
			// close event will fire afterwards and handle reconnect
		});

		ws.addEventListener('message', (ev) => {
			try {
				this.handleMessage(JSON.parse(ev.data as string));
			} catch (e) {
				console.error('[WS] Failed to parse message', e);
			}
		});
	}

	private scheduleReconnect(): void {
		if (this.stopped) return;
		const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
		this.reconnectAttempt++;
		console.log(`[WS] Reconnecting in ${delay} ms (attempt ${this.reconnectAttempt})`);
		this.reconnectTimer = setTimeout(() => this.connect(), delay);
	}

	/** Gracefully close the socket and stop reconnecting. */
	public dispose(): void {
		this.stopped = true;
		if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
		this.ws?.close();
	}

	// ── Message dispatch ───────────────────────────────────────────────────────

	private handleMessage(msg: { type: string; data: unknown }): void {
		switch (msg.type) {
			case 'amule:status':
				this.amuleStatus.set(msg.data as StatsResponse);
				break;

			case 'media:transfers':
				this.transfers.set(msg.data as TransfersResponse);
				break;

			case 'amule:upload-queue':
				this.uploadQueue.set(msg.data as { list: AmuleUpDownClient[] });
				break;

			case 'stats:speed-history': {
				const { samples } = msg.data as { samples: SpeedSample[] };
				this.speedSamples.set(samples);
				break;
			}

			case 'stats:speed-sample': {
				const sample = msg.data as SpeedSample;
				const prev = this.speedSamples.get();
				const next = prev.length >= MAX_SPEED_SAMPLES ? [...prev.slice(1), sample] : [...prev, sample];
				this.speedSamples.set(next);
				break;
			}

			case 'amule:log': {
				// Full snapshot (sent on connect): replaces the buffer
				const { lines } = msg.data as { lines: string[] };
				this.amuleLog.set(this.toLogLines(lines));
				break;
			}

			case 'amule:log-append': {
				// Incremental feed: concatenate and trim to the max buffer size
				const { lines } = msg.data as { lines: string[] };
				if (!lines.length) break;
				const next = [...this.amuleLog.get(), ...this.toLogLines(lines)];
				this.amuleLog.set(next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next);
				break;
			}

			case 'amule:servers':
				this.servers.set(msg.data as ServersResponse);
				break;

			case 'amule:shared':
				this.sharedFiles.set(msg.data as { list: AmuleFile[] });
				break;

			case 'system:info':
				this.systemInfo.set(msg.data as SystemInfo);
				break;

			default:
				console.warn('[WS] Unknown message type:', msg.type);
		}
	}

	private toLogLines(lines: string[]): LogLine[] {
		return lines.map((text) => ({ id: this.logLineSeq++, text }));
	}
}
