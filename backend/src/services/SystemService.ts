import axios from 'axios';
import { container } from './container/ServiceContainer';
import { GluetunService } from './GluetunService';

/**
 * How long a public IP lookup is reused. Matches the system:info broadcast period in
 * WsBroadcastService, so the UI is never staler than it already was, while the WS
 * (re)connects and REST calls in between stop hitting ipify again.
 */
const PUBLIC_IP_TTL_MS = 5 * 60 * 1000;

interface PublicIpLookup {
	ip: Promise<string | null>;
	expiresAt: number;
}

type IpDetails = Record<string, unknown>;

export class SystemService {
	private readonly gluetunService = container.get(GluetunService);
	private publicIpLookup: PublicIpLookup | null = null;
	/** ipinfo details keyed by IP. They never change for a given IP, and the map only grows when the public IP does. */
	private readonly ipDetailsLookups = new Map<string, Promise<IpDetails | null>>();

	public async getSystemInfo(): Promise<any> {
		const info: any = {};

		// VPN Info
		if (this.gluetunService.isEnabled) {
			const vpnStatus = await this.gluetunService.getVpnStatus();
			if (vpnStatus) {
				info.vpn = {
					enabled: true,
					status: vpnStatus.status,
					...vpnStatus,
				};
			} else {
				info.vpn = { enabled: true, status: 'error' };
			}

			// Port Forwarding Info
			const port = await this.gluetunService.getPortForwarded();
			if (port) {
				info.vpn.port = port;
			}
		} else {
			info.vpn = { enabled: false };
		}

		// Public IP Info (third-party lookups, cached: see getPublicIp / getIpInfo)

		// if (this.gluetunService.isEnabled) {
		// 	publicIp = await this.gluetunService.getPublicIp();
		// 	console.log('Gluetun Public IP:', publicIp);
		// }

		const publicIp = await this.getPublicIp();
		info.publicIp = publicIp;

		// Expanded IP Info (if we have an IP)
		if (publicIp) {
			const ipDetails = await this.getIpInfo(publicIp);
			if (ipDetails) {
				info.ipDetails = ipDetails;
			}
		}

		return info;
	}

	/** Cached for PUBLIC_IP_TTL_MS; concurrent callers share one in-flight request. A failed lookup is not cached. */
	private getPublicIp(): Promise<string | null> {
		if (!this.publicIpLookup || this.publicIpLookup.expiresAt <= Date.now()) {
			const lookup: PublicIpLookup = { ip: this.fetchPublicIp(), expiresAt: Date.now() + PUBLIC_IP_TTL_MS };
			lookup.ip.then((ip) => {
				if (ip === null && this.publicIpLookup === lookup) this.publicIpLookup = null;
			});
			this.publicIpLookup = lookup;
		}
		return this.publicIpLookup.ip;
	}

	private async fetchPublicIp(): Promise<string | null> {
		try {
			const res = await axios.get('https://api.ipify.org?format=json', { timeout: 2000 });
			return typeof res.data?.ip === 'string' ? res.data.ip : null;
		} catch (e) {
			// ignore network errors
			return null;
		}
	}

	/** Cached per IP; concurrent callers share one in-flight request. A failed lookup is not cached. */
	private getIpInfo(ip: string): Promise<IpDetails | null> {
		let lookup = this.ipDetailsLookups.get(ip);
		if (!lookup) {
			lookup = this.fetchIpInfo(ip).then((details) => {
				if (details === null) this.ipDetailsLookups.delete(ip);
				return details;
			});
			this.ipDetailsLookups.set(ip, lookup);
		}
		return lookup;
	}

	private async fetchIpInfo(ip: string): Promise<IpDetails | null> {
		try {
			// NOTE: ipinfo.io has rate limits for unauthenticated requests, hence the per-IP cache above.
			const res = await axios.get(`https://ipinfo.io/${ip}/json`, { timeout: 3000 });
			return res.data ?? null;
		} catch (error) {
			// ignore enrichment errors
			return null;
		}
	}
}
