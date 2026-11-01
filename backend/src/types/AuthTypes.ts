/**
 * Response of GET /api/auth/status, shared with the frontend through frontend/src/services/apiTypes.ts.
 * Keep this module free of imports (no libraries, no Node APIs): the frontend build type-checks it
 * without backend/node_modules.
 */

export interface AuthStatus {
	enabled: boolean;
	hasCredentials: boolean;
	hasApiKey: boolean;
	/** This client skips the login (AUTH_REQUIRED=disabled_for_local, local IP). */
	loginExempt: boolean;
}
