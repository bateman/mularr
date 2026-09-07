import axios from 'axios';
import { __APP_CONFIG__ } from '../app-env';

export class GluetunService {
	private readonly apiBase = __APP_CONFIG__.gluetun.api;

	public get isEnabled(): boolean {
		return __APP_CONFIG__.gluetun.enabled;
	}

	public async getPublicIp(): Promise<string | null> {
		try {
			const res = await axios.get(`${this.apiBase}/publicip/ip`);
			return res.data?.public_ip || res.data?.ip || (typeof res.data === 'string' ? res.data : null);
		} catch (error) {
			// console.error('Error fetching public IP from Gluetun:', error);
			return null;
		}
	}

	public async getVpnStatus(): Promise<any> {
		try {
			const res = await axios.get(`${this.apiBase}/vpn/status`);
			return res.data;
		} catch (error) {
			// console.error('Error fetching VPN status from Gluetun:', error);
			return null;
		}
	}

	public async getPortForwarded(): Promise<number | null> {
		try {
			const res = await axios.get(`${this.apiBase}/portforward`, { timeout: 5000 });

			// GLUETUN_PORT_INDEX picks one entry of the "ports" array Gluetun returns when it forwards several ports
			const portIndex = __APP_CONFIG__.gluetun.portIndex;
			if (portIndex !== undefined) {
				const ports = res.data?.ports;
				return Array.isArray(ports) && ports[portIndex] != null ? ports[portIndex] : null;
			}

			// Default behavior: use the single forwarded port
			return res.data?.port || null;
		} catch (error) {
			return null;
		}
	}
}
