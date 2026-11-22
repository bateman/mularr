interface Entry<T> {
	startedAt: number;
	/** Infinity while the run is going: a run in progress is shared until it settles. */
	expiresAt: number;
	value: Promise<T>;
}

/** What RecentResults.get hands out: the value, when the run that produced it began, and whether it was shared. */
export interface RecentResult<T> {
	value: T;
	startedAt: number;
	reused: boolean;
}

/**
 * The results of recent runs of a slow lookup, by key. A run still going is shared with every caller asking for the
 * same key; a finished one is handed out again for `ttlMs` after it settled, when `keep` accepts its value. A run
 * that fails, or whose value `keep` rejects, is forgotten as soon as it settles, so the next caller starts a new one.
 * At most `maxEntries` are kept, the oldest dropped first.
 */
export class RecentResults<T> {
	/** Entries by key, oldest first (Map keeps insertion order). */
	private readonly entries = new Map<string, Entry<T>>();

	constructor(
		private readonly ttlMs: number,
		private readonly maxEntries: number,
		private readonly keep: (value: T) => boolean,
		private readonly now: () => number = Date.now
	) {}

	/** The value of the run kept or going for `key`, or of a new run of `run` when there is none. */
	async get(key: string, run: () => Promise<T>): Promise<RecentResult<T>> {
		this.dropExpired();
		const kept = this.entries.get(key);
		if (kept) return { value: await kept.value, startedAt: kept.startedAt, reused: true };

		// The executor turns a synchronous throw of run() into a rejection
		const entry: Entry<T> = { startedAt: this.now(), expiresAt: Infinity, value: new Promise<T>((resolve) => resolve(run())) };
		this.entries.set(key, entry);
		this.dropOldest();
		// Registered before the caller awaits the value, so the entry is settled by the time anyone sees it
		entry.value.then(
			(value) => {
				if (this.entries.get(key) !== entry) return;
				if (this.keep(value)) entry.expiresAt = this.now() + this.ttlMs;
				else this.entries.delete(key);
			},
			() => {
				if (this.entries.get(key) === entry) this.entries.delete(key);
			}
		);
		return { value: await entry.value, startedAt: entry.startedAt, reused: false };
	}

	private dropExpired(): void {
		const now = this.now();
		for (const [key, entry] of this.entries) {
			if (entry.expiresAt <= now) this.entries.delete(key);
		}
	}

	/** A run going when its entry is dropped still answers the callers waiting for it; only later ones start anew. */
	private dropOldest(): void {
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
	}
}
