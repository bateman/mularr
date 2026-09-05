import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { __APP_CONFIG__ } from '../app-env';
import type { AuthStatus } from '../types/AuthTypes';
import { LoggerFactory } from './logging/Logger';

// Wire contract shared with the frontend (see src/types/AuthTypes.ts), re-exported for backend consumers
export type { AuthStatus };

/** Constant-time comparison, so a wrong credential can't be narrowed down character by character through response timing. */
function safeEqual(expected: string, actual: string): boolean {
	const a = Buffer.from(expected);
	const b = Buffer.from(actual);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export class AuthService {
	private readonly logger = LoggerFactory.create(this);
	private readonly username = __APP_CONFIG__.auth.username;
	private readonly password = __APP_CONFIG__.auth.password;
	private readonly apiKey = __APP_CONFIG__.auth.apiKey;
	private readonly jwtSecret: string;

	constructor(dataDir: string) {
		this.jwtSecret = this.resolveJwtSecret(dataDir);
	}

	/**
	 * Resolves the JWT signing secret. Priority: the JWT_SECRET env var, then a
	 * previously persisted secret in the data directory. If neither exists, a
	 * random secret is generated and persisted so tokens survive restarts.
	 */
	private resolveJwtSecret(dataDir: string): string {
		const envSecret = __APP_CONFIG__.auth.jwtSecret;
		if (envSecret) return envSecret;

		const secretPath = path.join(dataDir, 'jwt-secret');
		try {
			const stored = fs.readFileSync(secretPath, 'utf-8').trim();
			if (stored) return stored;
		} catch {
			// File doesn't exist yet — generate a new secret below
		}

		const secret = crypto.randomBytes(48).toString('hex');
		try {
			fs.mkdirSync(dataDir, { recursive: true });
			fs.writeFileSync(secretPath, secret, { encoding: 'utf-8', mode: 0o600 });
			this.logger.info(`Generated new JWT secret and saved it to ${secretPath}`);
		} catch (err) {
			this.logger.warn(`Could not persist JWT secret to ${secretPath} — session tokens will be invalidated on restart.`, err);
		}
		return secret;
	}

	isAuthEnabled(): boolean {
		return !!(this.username || this.apiKey);
	}

	getStatus(): AuthStatus {
		return {
			enabled: this.isAuthEnabled(),
			hasCredentials: !!(this.username && this.password),
			hasApiKey: !!this.apiKey,
		};
	}

	validateCredentials(username: string, password: string): boolean {
		if (!this.username || !this.password) return false;
		// Compare both regardless of the first result, so timing doesn't reveal which one failed
		const usernameOk = safeEqual(this.username, username);
		const passwordOk = safeEqual(this.password, password);
		return usernameOk && passwordOk;
	}

	validateApiKey(key: string): boolean {
		if (!this.apiKey) return false;
		return safeEqual(this.apiKey, key);
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
		res.setHeader('Set-Cookie', this.sidCookie(token, maxAge));
	}

	/** Clears the SID cookie by setting Max-Age=0. */
	clearSidCookie(res: Response): void {
		res.setHeader('Set-Cookie', this.sidCookie('', 0));
	}

	setSidCookieOpenMode(res: Response): void {
		res.setHeader('Set-Cookie', this.sidCookie('mularr_open', 3600));
	}

	/**
	 * Serializes the SID cookie. HttpOnly keeps it out of page scripts. SameSite=Strict keeps it off
	 * cross-site requests: it only serves the qBittorrent-compatible API, whose clients (Sonarr,
	 * Radarr...) are not browsers, so nothing legitimate needs it to travel cross-site.
	 */
	private sidCookie(value: string, maxAge: number): string {
		return `SID=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Strict`;
	}
}
