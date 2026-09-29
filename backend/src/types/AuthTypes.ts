/**
 * Response of GET /api/auth/status, shared with the frontend through frontend/src/services/apiTypes.ts.
 * Keep this module free of imports (no libraries, no Node APIs): the frontend build type-checks it
 * without backend/node_modules.
 */

export interface AuthStatus {
	enabled: boolean;
	hasCredentials: boolean;
	hasApiKey: boolean;
	/** True only when BOTH AUTH_USERNAME and AUTH_PASSWORD are set: the web UI shows the login page. */
	interactiveLoginEnabled: boolean;
	/** Interactive login is enabled and AUTH_REQUIRED does not waive it for the requesting client. When false, the web UI skips the login page. */
	loginRequired: boolean;
	/** AUTH_REQUIRED=disabled_for_local_addresses: clients on a local address skip the login page. */
	localBypassEnabled: boolean;
}
