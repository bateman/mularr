import { __APP_CONFIG__, type LogLevel } from '../../app-env';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Scoped console logger. Every line reads `2026-09-05T14:03:12.345Z INFO  [MediaProviderService] message ...`;
 * the extra arguments are handed to console untouched, so errors keep their stack and objects stay inspectable.
 * Anything below LOG_LEVEL (see app-env.ts) is dropped.
 *
 * Levels, as used across the backend:
 *   debug  per-request chatter and polling detail (every *arr request, search progress, full Torznab responses)
 *   info   state changes worth seeing in normal operation (daemon start/stop, downloads added or completed)
 *   warn   something recoverable went wrong, or a request was refused
 *   error  an operation failed
 */
export class Logger {
	constructor(private readonly scope: string) {}

	debug(...args: unknown[]): void {
		this.write('debug', args);
	}

	info(...args: unknown[]): void {
		this.write('info', args);
	}

	warn(...args: unknown[]): void {
		this.write('warn', args);
	}

	error(...args: unknown[]): void {
		this.write('error', args);
	}

	private write(level: LogLevel, args: unknown[]): void {
		if (LEVEL_RANK[level] < LEVEL_RANK[__APP_CONFIG__.logLevel]) return;
		const prefix = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${this.scope}]`;
		const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
		sink(prefix, ...args);
	}
}

/**
 * Creates loggers scoped to the calling class, the usual case: `private readonly logger = LoggerFactory.create(this)`
 * takes the name from the instance's constructor, so the field can be copied between classes untouched. A class
 * or an explicit string are accepted too, for code that isn't a class (middleware functions, index.ts).
 */
export class LoggerFactory {
	static create(scope: string | object): Logger {
		if (typeof scope === 'string') return new Logger(scope);
		const name = typeof scope === 'function' ? (scope as Function).name : scope.constructor.name;
		return new Logger(name || 'Unknown');
	}
}
