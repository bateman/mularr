import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCrossSite, isLocalAddress, normalizeIp, parseNetworks, resolveClientIp } from './clientAddressTools';

test('local addresses', () => {
	for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '::1', 'fd00::1', 'fe80::1']) {
		assert.equal(isLocalAddress(ip), true, ip);
	}
	for (const ip of ['8.8.8.8', '172.32.0.1', '2001:db8::1', 'not-an-ip', '']) {
		assert.equal(isLocalAddress(ip), false, ip);
	}
});

test('normalizes IPv4-mapped IPv6 and zone ids', () => {
	assert.equal(normalizeIp('::ffff:192.168.1.10'), '192.168.1.10');
	assert.equal(normalizeIp('fe80::1%eth0'), 'fe80::1');
});

test('rejects invalid trusted networks', () => {
	for (const bad of ['10.0.0.0/33', 'foo', '10.0.0.0/8/1', '::1/129', '10.0.0.0/x']) {
		assert.throws(() => parseNetworks([bad]), undefined, bad);
	}
	assert.doesNotThrow(() => parseNetworks(['172.29.4.0/22', ' 172.17.0.1 ', 'fc00::/7', '']));
	// A mapped entry stays IPv4: as IPv6 its /22 would cover every IPv4 client
	const mapped = parseNetworks(['::ffff:172.29.4.0/22']);
	assert.equal(resolveClientIp('::ffff:8.8.8.8', { 'x-forwarded-for': '192.168.1.1' }, mapped), undefined);
	assert.equal(resolveClientIp('172.29.4.5', { 'x-forwarded-for': '192.168.1.1' }, mapped), '192.168.1.1');
});

test('resolves the client IP', () => {
	const trusted = parseNetworks(['172.29.4.0/22']);
	const xff = (v: string) => ({ 'x-forwarded-for': v });
	// Untrusted peer without forwarding headers: the peer
	assert.equal(resolveClientIp('8.8.8.8', {}, trusted), '8.8.8.8');
	assert.equal(resolveClientIp('::ffff:192.168.1.5', {}, trusted), '192.168.1.5');
	// Untrusted peer with forwarding headers (spoof, or a proxy missing from the list): unknown
	assert.equal(resolveClientIp('8.8.8.8', xff('192.168.1.1'), trusted), undefined);
	assert.equal(resolveClientIp('172.18.0.2', xff('8.8.8.8'), trusted), undefined);
	assert.equal(resolveClientIp('172.18.0.2', { 'x-real-ip': '8.8.8.8' }, trusted), undefined);
	// Trusted proxy: rightmost untrusted hop wins, spoofed hops on the left are ignored
	assert.equal(resolveClientIp('172.29.4.5', xff('192.168.1.1, 8.8.8.8'), trusted), '8.8.8.8');
	assert.equal(resolveClientIp('172.29.4.5', xff('8.8.8.8, 172.29.4.9'), trusted), '8.8.8.8');
	assert.equal(resolveClientIp('172.29.4.5', xff('192.168.1.20'), trusted), '192.168.1.20');
	// Trusted proxy with no usable hop: unknown, never the proxy's own (local) IP
	assert.equal(resolveClientIp('172.29.4.5', {}, trusted), undefined);
	assert.equal(resolveClientIp('172.29.4.5', xff('172.29.4.9'), trusted), undefined);
	assert.equal(resolveClientIp('172.29.4.5', xff('192.168.1.1, '), trusted), undefined);
	assert.equal(resolveClientIp('172.29.4.5', xff('garbage'), trusted), undefined);
	assert.equal(resolveClientIp(undefined, {}, trusted), undefined);
});

test('detects cross-site browser requests', () => {
	assert.equal(isCrossSite({ host: 'nas:8940' }), false);
	assert.equal(isCrossSite({ host: 'nas:8940', origin: 'http://nas:8940' }), false);
	assert.equal(isCrossSite({ host: 'nas:8940', origin: 'https://evil.example' }), true);
	assert.equal(isCrossSite({ host: 'nas:8940', origin: 'null' }), true);
	// Proxy that rewrites Host: the browser's own Sec-Fetch-Site still says same-origin
	assert.equal(isCrossSite({ host: 'mularr:8940', origin: 'https://mularr.lan', 'sec-fetch-site': 'same-origin' }), false);
	assert.equal(isCrossSite({ host: 'mularr:8940', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), true);
});
