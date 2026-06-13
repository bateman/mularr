import { Request, Response, NextFunction } from 'express';
import { container } from '../services/container/ServiceContainer';
import { AuthService } from '../services/AuthService';

function parseSidCookie(req: Request): string | undefined {
	const cookieHeader = req.headers.cookie || '';
	for (const part of cookieHeader.split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === 'SID') return rest.join('=');
	}
	return undefined;
}

export interface AuthMiddlewareOptions {
	// When false, SESSION credentials are rejected — the qBit SID cookie and
	// Bearer session-JWTs — leaving only the API key itself (?apikey= query,
	// X-Api-Key header, or Bearer <apikey>). Used for the Torznab indexer,
	// which per the Newznab/Torznab contract authenticates by API key only.
	// Accepting the qBit login cookie there let a WRONG indexer apikey pass
	// whenever a download-client session cookie existed for the same host
	// (Sonarr/Radarr cache cookies per-host and send them on indexer requests).
	allowSession?: boolean;
}

export function createAuthMiddleware(opts: AuthMiddlewareOptions = {}) {
	const allowSession = opts.allowSession !== false; // default: allow (qBit API, web UI)

	return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
		const authService = container.get(AuthService);

		if (!authService.isAuthEnabled()) {
			return next();
		}

		// 1. Authorization: Bearer <apikey | session-JWT>
		const authHeader = req.headers.authorization;
		if (authHeader?.startsWith('Bearer ')) {
			const token = authHeader.slice(7);
			if (authService.validateApiKey(token) || (allowSession && authService.validateToken(token))) {
				return next();
			}
		}

		// 2. X-Api-Key header (always an API key)
		const xApiKey = req.headers['x-api-key'] as string | undefined;
		if (xApiKey && authService.validateApiKey(xApiKey)) {
			return next();
		}

		// 3. Cookie: SID=<apikey | session-JWT> — session auth, only when allowed.
		if (allowSession) {
			const sid = parseSidCookie(req);
			if (sid) {
				// API key stored as SID — always valid, no refresh needed
				if (authService.validateApiKey(sid)) {
					return next();
				}
				// JWT stored as SID — refresh on every valid request (sliding window) so
				// the session never expires as long as Sonarr/Radarr keep polling.
				const refreshed = authService.refreshToken(sid);
				if (refreshed) {
					authService.setSidCookie(res, refreshed);
					return next();
				}
				// If the token is invalid or expired, clear the cookie to prevent confusion.
				console.log('[AuthMiddleware] Invalid or expired SID cookie, clearing it');
				authService.clearSidCookie(res);
			}
		}

		// 4. ?apikey=<key> query param (Torznab / Newznab compat)
		const queryApiKey = req.query.apikey as string | undefined;
		if (queryApiKey && authService.validateApiKey(queryApiKey)) {
			return next();
		}

		console.warn(`[AuthMiddleware] Unauthorized request to ${req.method} ${req.path}`);
		// Log which credential channels were PRESENT (booleans only), never their
		// values — so a 401 stays debuggable ("cookie present but no apikey", etc.)
		// without leaking secrets (apikey / SID cookie / Authorization) into stdout.
		// This route 401s on every *arr poll until its apikey is corrected, so the
		// old full headers/query dump would have flooded logs with live credentials.
		console.log('[AuthMiddleware] credentials seen:', {
			bearer: !!authHeader,
			xApiKey: !!xApiKey,
			sidCookie: /(?:^|;\s*)SID=/.test(req.headers.cookie || ''),
			queryApiKey: !!queryApiKey,
			sessionAllowed: allowSession,
		});

		res.status(401).json({ error: 'Unauthorized' });
	};
}

// Default: full credential set incl. session cookie/JWT — the qBit-compat API,
// the web UI, and mularr's own API routes all rely on the session cookie.
export const authMiddleware = createAuthMiddleware();

// API-key-only — rejects the qBit session cookie/JWT so a wrong apikey always
// 401s. Used for the Torznab indexer route.
export const apiKeyOnlyAuthMiddleware = createAuthMiddleware({ allowSession: false });
