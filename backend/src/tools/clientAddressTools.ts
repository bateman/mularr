import type { IncomingHttpHeaders } from 'http';
import net, { BlockList } from 'net';

// Loopback, private IPv4, link-local, IPv6 ULA
const LOCAL_NETWORKS = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'];

/** Strips the IPv4-mapped prefix (`::ffff:1.2.3.4`) and an IPv6 zone id (`fe80::1%eth0`). */
export function normalizeIp(ip: string): string {
	const trimmed = ip.trim().replace(/%.*$/, '');
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
	return mapped ? mapped[1] : trimmed;
}

/** Builds a list from IPs/CIDRs; throws on an invalid entry so a typo fails at startup. */
export function parseNetworks(entries: string[]): BlockList {
	const list = new BlockList();
	for (const raw of entries) {
		const entry = raw.trim();
		if (!entry) continue;
		const [rawAddress, prefix, ...rest] = entry.split('/');
		// ::ffff:172.29.4.0/22 is meant as IPv4; as IPv6 a /22 would cover every IPv4 client
		const address = normalizeIp(rawAddress);
		const family = net.isIP(address);
		const max = family === 4 ? 32 : 128;
		if (!family || rest.length || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > max))) {
			throw new Error(`Invalid network "${entry}": expected an IP or CIDR, e.g. 172.17.0.1 or 10.0.0.0/8`);
		}
		const type = family === 4 ? 'ipv4' : 'ipv6';
		if (prefix === undefined) list.addAddress(address, type);
		else list.addSubnet(address, Number(prefix), type);
	}
	return list;
}

/** False for anything that is not a valid IP. */
export function inNetworks(list: BlockList, ip: string): boolean {
	const family = net.isIP(ip);
	return family !== 0 && list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

const localNetworks = parseNetworks(LOCAL_NETWORKS);

export function isLocalAddress(ip: string): boolean {
	return inNetworks(localNetworks, ip);
}

/**
 * The real client IP: the socket peer, or, when the peer is a trusted proxy, the rightmost
 * X-Forwarded-For hop that is not itself trusted. Undefined when it can't be told.
 */
export function resolveClientIp(remoteAddress: string | undefined, headers: IncomingHttpHeaders, trusted: BlockList): string | undefined {
	if (!remoteAddress) return undefined;
	const peer = normalizeIp(remoteAddress);
	const forwardedFor = headers['x-forwarded-for'];
	if (!inNetworks(trusted, peer)) {
		// Forwarding headers from an unlisted peer: a proxy missing from TRUSTED_NETWORKS, client unknown
		return forwardedFor !== undefined || headers['forwarded'] || headers['x-real-ip'] ? undefined : peer;
	}
	const hops = String(forwardedFor ?? '').split(',');
	for (let i = hops.length - 1; i >= 0; i--) {
		// shortcut: hops with a port (1.2.3.4:80) count as unknown, fine for Traefik/nginx/Caddy
		const hop = normalizeIp(hops[i]);
		if (!net.isIP(hop)) return undefined;
		if (!inNetworks(trusted, hop)) return hop;
	}
	return undefined; // only trusted hops (or none): the real client is unknown
}

/** A browser request made by another site (CORS is open, so IP alone must not authorize it). */
export function isCrossSite(headers: IncomingHttpHeaders): boolean {
	const origin = headers.origin;
	if (!origin || headers['sec-fetch-site'] === 'same-origin') return false;
	try {
		return new URL(origin).host !== headers.host;
	} catch {
		return true; // e.g. "Origin: null"
	}
}
