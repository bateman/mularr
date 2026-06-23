import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Response } from 'express';

export interface AuthStatus {
	enabled: boolean;
	hasCredentials: boolean;
	hasApiKey: boolean;
	interactiveLoginEnabled: boolean;
}

export class AuthService {
	private readonly username?: string;
	private readonly password?: string;
	private readonly apiKey?: string;
	private readonly jwtSecret: string;

	constructor() {
		this.username = process.env.AUTH_USERNAME;
		this.password = process.env.AUTH_PASSWORD;
		this.apiKey = process.env.API_KEY;

		const envSecret = process.env.JWT_SECRET;
		if (envSecret) {
			this.jwtSecret = envSecret;
		} else {
			// Auto-generate a random secret (invalidates on restart, acceptable)
			this.jwtSecret = crypto.randomBytes(48).toString('hex');
			if (this.isAuthEnabled()) {
				console.warn('[AuthService] JWT_SECRET not set — session tokens will be invalidated on restart.');
			}
		}

		// Partial interactive credentials are ambiguous: interactive login needs
		// BOTH username and password, so a half-configured pair silently disables
		// the login UI. Warn so it isn't mistaken for an enabled login.
		if (!!this.username !== !!this.password) {
			console.warn(
				'[AuthService] Only one of AUTH_USERNAME/AUTH_PASSWORD is set — interactive login stays DISABLED. Set both to enable it.',
			);
		}
	}

	/**
	 * Interactive login (the web UI login page + session gate) is enabled only
	 * when BOTH AUTH_USERNAME and AUTH_PASSWORD are set. When disabled, the web
	 * UI is served without a login page — intended to run behind a trusted
	 * authenticating reverse proxy / SSO that handles human auth.
	 */
	isInteractiveLoginEnabled(): boolean {
		return !!(this.username && this.password);
	}

	/** API_KEY (machine-to-machine) auth on the /api/as-* surfaces. */
	isApiKeyAuthEnabled(): boolean {
		return !!this.apiKey;
	}

	/**
	 * Whether any app-level credential is configured. Gates the M2M middlewares
	 * and the qBittorrent open-mode fallback. True when API_KEY is set or when
	 * interactive login is fully configured.
	 */
	isAuthEnabled(): boolean {
		return this.isApiKeyAuthEnabled() || this.isInteractiveLoginEnabled();
	}

	getStatus(): AuthStatus {
		return {
			enabled: this.isAuthEnabled(),
			hasCredentials: !!(this.username && this.password),
			hasApiKey: !!this.apiKey,
			interactiveLoginEnabled: this.isInteractiveLoginEnabled(),
		};
	}

	validateCredentials(username: string, password: string): boolean {
		if (!this.username || !this.password) return false;
		return username === this.username && password === this.password;
	}

	validateApiKey(key: string): boolean {
		if (!this.apiKey) return false;
		// Use timing-safe comparison to prevent timing attacks
		try {
			return this.apiKey.length === key.length && crypto.timingSafeEqual(Buffer.from(this.apiKey), Buffer.from(key));
		} catch {
			return false;
		}
	}

	generateToken(username: string, noExpiry = false): string {
		if (noExpiry) {
			// No expiry for API-key-based logins: apps like Sonarr/Radarr do not
			// re-authenticate on 401, so expiring tokens would permanently break them.
			return jwt.sign({ sub: username }, this.jwtSecret);
		}
		return jwt.sign({ sub: username }, this.jwtSecret, { expiresIn: '7d' });
	}

	validateToken(token: string): boolean {
		try {
			jwt.verify(token, this.jwtSecret);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Verifies a JWT and returns a freshly-signed token.
	 * Preserves the expiry behaviour of the original token: if it had no `exp`
	 * claim (API-key login), the refreshed token also has no expiry.
	 * Returns null if the token is invalid (wrong secret, malformed, etc.).
	 */
	refreshToken(token: string): string | null {
		try {
			const payload = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload;
			return this.generateToken(payload.sub as string, !payload.exp);
		} catch {
			return null;
		}
	}

	/**
	 * Sets the SID cookie on the response. Max-Age is derived from the JWT `exp`
	 * claim so credential-based sessions expire with the token. For API-key tokens
	 * (no `exp` claim) a 10-year fallback is used so integrations like Sonarr/Radarr
	 * are never broken by cookie expiry.
	 */
	setSidCookie(res: Response, token: string): void {
		const NO_EXPIRY_MAX_AGE = 60 * 60 * 24 * 365 * 10; // 10 years in seconds
		let maxAge: number;
		try {
			const payload = jwt.decode(token) as jwt.JwtPayload;
			maxAge = payload?.exp ? payload.exp - Math.floor(Date.now() / 1000) : NO_EXPIRY_MAX_AGE;
		} catch {
			maxAge = NO_EXPIRY_MAX_AGE;
		}
		res.setHeader('Set-Cookie', `SID=${token}; HttpOnly; Path=/; Max-Age=${maxAge}`);
	}

	/** Clears the SID cookie by setting Max-Age=0. */
	clearSidCookie(res: Response): void {
		res.setHeader('Set-Cookie', 'SID=; HttpOnly; Path=/; Max-Age=0');
	}

	setSidCookieOpenMode(res: Response): void {
		res.setHeader('Set-Cookie', 'SID=mularr_open; HttpOnly; Path=/; Max-Age=3600');
	}
}
