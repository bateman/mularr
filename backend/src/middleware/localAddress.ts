import type { IncomingMessage } from 'http';
import net from 'net';

/**
 * Networks treated as "local" by AUTH_REQUIRED=disabled_for_local_addresses. Same set the *Arr apps use
 * (Sonarr/Radarr IsLocalAddress): loopback, RFC 1918 private ranges and link-local, plus their IPv6
 * counterparts. CGNAT (100.64.0.0/10) is deliberately left out: it can hold other customers of the same ISP.
 */
const LOCAL_NETWORKS = new net.BlockList();
LOCAL_NETWORKS.addSubnet('127.0.0.0', 8, 'ipv4');
LOCAL_NETWORKS.addSubnet('10.0.0.0', 8, 'ipv4');
LOCAL_NETWORKS.addSubnet('172.16.0.0', 12, 'ipv4');
LOCAL_NETWORKS.addSubnet('192.168.0.0', 16, 'ipv4');
LOCAL_NETWORKS.addSubnet('169.254.0.0', 16, 'ipv4');
LOCAL_NETWORKS.addAddress('::1', 'ipv6');
LOCAL_NETWORKS.addSubnet('fe80::', 10, 'ipv6'); // link-local
LOCAL_NETWORKS.addSubnet('fec0::', 10, 'ipv6'); // site-local (deprecated, still matched by the *Arr apps)
LOCAL_NETWORKS.addSubnet('fc00::', 7, 'ipv6'); // unique local

/** True when `address` is a literal IP in one of LOCAL_NETWORKS. Anything unparseable (hostnames, "unknown", garbage) is not local. */
export function isLocalAddress(address: string | undefined): boolean {
	if (!address) return false;
	let ip = address.trim();
	// Bracketed IPv6, optionally with a port: "[::1]:1234"
	const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
	if (bracketed) ip = bracketed[1];
	// IPv4 with a port: "192.168.1.2:1234" (some proxies append it)
	else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
	// Zone index: "fe80::1%eth0"
	ip = ip.replace(/%.*$/, '');
	// IPv4-mapped IPv6, as Node reports IPv4 peers on a dual-stack socket: "::ffff:192.168.1.2"
	const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i.exec(ip);
	if (mapped) ip = mapped[1];

	const family = net.isIP(ip);
	if (family === 0) return false;
	return LOCAL_NETWORKS.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

function headerValues(req: IncomingMessage, name: string): string[] {
	const raw = req.headers[name];
	if (raw === undefined) return [];
	return (Array.isArray(raw) ? raw : [raw]).flatMap((value) => value.split(','));
}

/**
 * Whether the request comes from a local address, following reverse proxies.
 *
 * The TCP peer must be local. Forwarding headers are only looked at in that case, since only a local peer can
 * be a proxy we trust; and then every address they carry (X-Forwarded-For and X-Real-IP) must be local too.
 * Requiring all of them, not just the rightmost hop, keeps a chain of local proxies from masking a remote
 * client, while a remote client still can't pass: it can prepend fake local entries, but the address its
 * proxy appends is its own, public one.
 *
 * So a LAN browser reaching the port directly is local, and a remote user coming through a reverse proxy
 * (Traefik, nginx, Caddy, cloudflared...) is not, provided the proxy sets X-Forwarded-For or X-Real-IP, as
 * they all do by default or in their standard configuration.
 */
export function isLocalRequest(req: IncomingMessage): boolean {
	if (!isLocalAddress(req.socket.remoteAddress)) return false;
	const forwarded = [...headerValues(req, 'x-forwarded-for'), ...headerValues(req, 'x-real-ip')];
	return forwarded.every(isLocalAddress);
}
