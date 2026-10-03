interface ProviderMeta {
	name: string;
	icon: string;
	iconClass: string;
}

const providersMeta: Record<string, ProviderMeta> = {
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

export function getProviderName(provider?: string) {
	if (!provider) return 'Unknown';
	return providersMeta[provider]?.name ?? provider;
}

export function getProviderIcon(provider?: string) {
	if (!provider) return '-';
	const meta = providersMeta[provider];
	if (meta?.iconClass) {
		const span = document.createElement('span');
		span.className = `icon-img ${meta.iconClass}`;
		return span;
	}
	return meta?.icon ?? '❓';
}
