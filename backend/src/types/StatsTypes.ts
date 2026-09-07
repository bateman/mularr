/**
 * Speed history sample, shared with the frontend through frontend/src/services/apiTypes.ts.
 * Keep this module free of imports (no libraries, no Node APIs): the frontend build type-checks it
 * without backend/node_modules.
 */

export interface SpeedSample {
	/** Unix timestamp (ms) */
	ts: number;
	/** Download speed (B/s) summed from active aMule transfers */
	dlAmule: number;
	/** Download speed (B/s) summed from active Telegram transfers */
	dlTelegram: number;
	/** Total download speed (B/s) – sum of all providers */
	dlTotal: number;
	/** Upload speed (B/s) from aMule global stat */
	ulAmule: number;
	/** Number of active aMule transfers */
	activeAmule: number;
	/** Number of active Telegram transfers */
	activeTelegram: number;
	/** Total number of shared files */
	totalShared: number;
}
