import type { SearchProviderId } from './apiTypes';

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
