import type { SearchProviderId } from './apiTypes';
import type { Extension } from './ExtensionsApiService';

export type { SearchProviderId };

/**
 * Runtime counterpart of SEARCH_PROVIDER_IDS in backend/src/types/MediaTypes.ts, which only reaches the
 * frontend as a type. `satisfies` rejects an id the backend does not know; providersMeta below, keyed by
 * the backend type, fails to compile when the backend adds one.
 */
export const SEARCH_PROVIDER_IDS = ['amule', 'telegram', 'hispashare'] as const satisfies readonly SearchProviderId[];

interface ProviderMeta {
	name: string;
	icon: string;
	iconClass: string;
}

const providersMeta: Record<SearchProviderId, ProviderMeta> = {
	amule: {
		name: 'aMule',
		icon: '🐴',
		iconClass: 'icon-emule',
	},
	telegram: {
		name: 'Telegram',
		icon: '📩',
		iconClass: 'icon-telegram',
	},
	hispashare: {
		name: 'Hispashare',
		icon: '🎬',
		iconClass: 'icon-hispashare',
	},
};

function metaOf(provider: string): ProviderMeta | undefined {
	return (providersMeta as Record<string, ProviderMeta | undefined>)[provider];
}

export function getProviderName(provider?: string) {
	if (!provider) return 'Unknown';
	return metaOf(provider)?.name ?? provider;
}

export function getProviderIcon(provider?: string) {
	if (!provider) return '-';
	const meta = metaOf(provider);
	if (meta?.iconClass) {
		const span = document.createElement('span');
		span.className = `icon-img ${meta.iconClass}`;
		return span;
	}
	return meta?.icon ?? '❓';
}

/**
 * Providers a search reaches, derived from the extensions: aMule is always there, the others only while
 * the extension that configures them is enabled.
 */
export function getAvailableSearchProviders(extensions: Extension[]): SearchProviderId[] {
	const enabled = (type: string) => extensions.some((x) => x.type === type && !!x.enabled);
	const providers: SearchProviderId[] = ['amule'];
	if (enabled('telegram_indexer')) providers.push('telegram');
	if (enabled('hispashare')) providers.push('hispashare');
	return providers;
}
