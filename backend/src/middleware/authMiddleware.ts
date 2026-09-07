import type { IncomingMessage } from 'http';
import { Request, Response, NextFunction } from 'express';
import { container } from '../services/container/ServiceContainer';
import { AuthService } from '../services/AuthService';
import { LoggerFactory } from '../services/logging/Logger';

const logger = LoggerFactory.create('AuthMiddleware');

/**
 * Result of authenticating a raw HTTP request.
 *
 * - `refreshedSid`: when the request was authenticated via a JWT stored in the
 *   SID cookie, a freshly-signed token the caller should set back as the cookie
 *   (sliding-window session). Only meaningful for HTTP responses.
 * - `clearSid`: when an SID cookie was present but invalid, the caller should
 *   clear it so stale cookies don't linger.
 */
export type AuthOutcome = { authorized: true; refreshedSid?: string } | { authorized: false; clearSid: boolean };

export interface AuthOptions {
	// When false, reject session credentials (qBit SID cookie + Bearer/query
	// session-JWTs) and accept only the API key. Used for the Torznab indexer,
	// which per the Newznab/Torznab contract authenticates by API key only:
	// accepting the qBit cookie there let a wrong apikey pass whenever an *arr
	// download-client session cookie existed for the same host.
	allowSession?: boolean;
	// Which auth posture decides whether this check enforces anything:
	//   'api'         → enforce when any app credential is set (isAuthEnabled).
	//                   Used for the M2M surfaces (qBit + Torznab).
	//   'interactive' → enforce only when interactive login is enabled.
	//                   Used for the web-UI routes and the WebSocket, so they are
	//                   served openly (behind a trusted proxy) when
	//                   AUTH_USERNAME/PASSWORD are unset, even if API_KEY is configured.
	scope?: 'api' | 'interactive';
}

function parseSidCookie(req: IncomingMessage): string | undefined {
	const cookieHeader = req.headers.cookie || '';
	for (const part of cookieHeader.split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === 'SID') return rest.join('=');
	}
	return undefined;
}

function parseQuery(req: IncomingMessage): URLSearchParams {
	// req.url is path + query only; the base is irrelevant, it's just needed to build a URL
	return new URL(req.url ?? '/', 'http://localhost').searchParams;
}

/** Which credential kinds the request carried, for the 401 log. Values are never included: they are the tokens themselves. */
function describePresentedCredentials(req: IncomingMessage): string {
	const present: string[] = [];
	if (req.headers.authorization) present.push('Authorization header');
	if (req.headers['x-api-key']) present.push('X-Api-Key header');
	if (parseSidCookie(req)) present.push('SID cookie');
	const query = parseQuery(req);
	if (query.has('apikey')) present.push('apikey query param');
	if (query.has('token')) present.push('token query param');
	return present.length > 0 ? present.join(', ') : 'none';
}

/**
 * Authenticates a raw `http.IncomingMessage`, so it works both for Express
 * routes and for the WebSocket upgrade request (which never reaches Express).
 *
 * Accepted credentials, in order:
 *   1. `Authorization: Bearer <apikey|jwt>` header
 *   2. `X-Api-Key: <apikey>` header (Sonarr / Prowlarr style)
 *   3. `SID=<apikey|jwt>` cookie (qBittorrent compat)
 *   4. `?apikey=<apikey>` query param (Torznab / Newznab compat)
 *   5. `?token=<apikey|jwt>` query param (browser WebSocket clients can't set headers)
 *
 * Session credentials (JWTs, in any of the positions above) are only accepted
 * when `allowSession` is not false; API keys are always accepted.
 */
export function authenticateRequest(req: IncomingMessage, opts: AuthOptions = {}): AuthOutcome {
	const allowSession = opts.allowSession !== false; // default: allow (qBit API, web UI)
	const scope = opts.scope ?? 'api';
	const authService = container.get(AuthService);

	const active = scope === 'interactive' ? authService.isInteractiveLoginEnabled() : authService.isAuthEnabled();
	if (!active) {
		return { authorized: true };
	}

	const validSessionOrApiKey = (token: string): boolean => authService.validateApiKey(token) || (allowSession && authService.validateToken(token));

	// 1. Authorization: Bearer <apikey | session-JWT>
	const authHeader = req.headers.authorization;
	if (authHeader?.startsWith('Bearer ')) {
		const token = authHeader.slice(7);
		if (validSessionOrApiKey(token)) {
			return { authorized: true };
		}
	}

	// 2. X-Api-Key header (always an API key)
	const xApiKey = req.headers['x-api-key'];
	if (typeof xApiKey === 'string' && authService.validateApiKey(xApiKey)) {
		return { authorized: true };
	}

	// 3. Cookie: SID=<apikey | session-JWT> — session auth, only when allowed.
	let clearSid = false;
	if (allowSession) {
		const sid = parseSidCookie(req);
		if (sid) {
			// API key stored as SID — always valid, no refresh needed
			if (authService.validateApiKey(sid)) {
				return { authorized: true };
			}
			// JWT stored as SID — refresh on every valid request (sliding window) so
			// the session never expires as long as Sonarr/Radarr keep polling.
			const refreshed = authService.refreshToken(sid);
			if (refreshed) {
				return { authorized: true, refreshedSid: refreshed };
			}
			// Invalid or expired: tell the caller to clear the cookie to prevent confusion.
			clearSid = true;
		}
	}

	const query = parseQuery(req);

	// 4. ?apikey=<key> query param (Torznab / Newznab compat)
	const queryApiKey = query.get('apikey');
	if (queryApiKey && authService.validateApiKey(queryApiKey)) {
		return { authorized: true };
	}

	// 5. ?token=<apikey | session-JWT> query param (WebSocket clients from the browser)
	const queryToken = query.get('token');
	if (queryToken && validSessionOrApiKey(queryToken)) {
		return { authorized: true };
	}

	return { authorized: false, clearSid };
}

export function createAuthMiddleware(opts: AuthOptions = {}) {
	return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
		const outcome = authenticateRequest(req, opts);
		const authService = container.get(AuthService);

		if (outcome.authorized) {
			if (outcome.refreshedSid) authService.setSidCookie(res, outcome.refreshedSid);
			return next();
		}

		if (outcome.clearSid) {
			logger.debug('Invalid or expired SID cookie, clearing it');
			authService.clearSidCookie(res);
		}

		// Never dump headers or query here: they carry the tokens and API keys themselves
		logger.warn(
			`Unauthorized request to ${req.method} ${req.path} from ${req.socket.remoteAddress} (credentials presented: ${describePresentedCredentials(req)}; session allowed: ${opts.allowSession !== false})`,
		);

		res.status(401).json({ error: 'Unauthorized' });
	};
}

// Default: accepts the session cookie/JWT (qBit-compat API). Enforces whenever
// any app credential is configured.
export const authMiddleware = createAuthMiddleware();

// API-key-only — rejects the session cookie/JWT. Used for the Torznab indexer.
export const apiKeyOnlyAuthMiddleware = createAuthMiddleware({ allowSession: false });

// Web-UI routes — gated on interactive login only. When AUTH_USERNAME/PASSWORD
// are unset the UI routes are served openly (M2M API_KEY auth is unaffected).
export const uiAuthMiddleware = createAuthMiddleware({ scope: 'interactive' });
