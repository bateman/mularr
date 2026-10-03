import { component, inject, refBindInput, signal } from 'chispa';
import {
	ARR_SYNC_MIN_INTERVAL_MINUTES,
	EXTENSION_TYPES,
	ExtensionsApiService,
	parseArrConfig,
	type ArrExtensionConfig,
} from '../../../services/ExtensionsApiService';
import type { ConfigFormProps, ConfigFormValues } from './ConfigForm';
import tpl from './ArrConfigForm.html';

/** Config form for the sonarr/radarr extensions: endpoint, API key and how often the wanted list is synced. */
export const ArrConfigForm = component<ConfigFormProps>(({ type, extension, handle }) => {
	const api = inject(ExtensionsApiService);
	const stored = parseArrConfig(extension?.config);
	const appName = EXTENSION_TYPES[type]?.label ?? type;

	const url = signal(extension?.url ?? '');
	const apiKey = signal(stored.apiKey);
	const interval = signal(String(stored.intervalMinutes));

	const read = (): (ConfigFormValues & { config: ArrExtensionConfig }) | { error: string } => {
		const urlValue = url.get().trim();
		if (!urlValue) return { error: 'URL is required' };
		const intervalMinutes = Number(interval.get());
		if (!Number.isInteger(intervalMinutes) || intervalMinutes < ARR_SYNC_MIN_INTERVAL_MINUTES) {
			return { error: `The sync interval must be a whole number of at least ${ARR_SYNC_MIN_INTERVAL_MINUTES} minutes` };
		}
		if (!apiKey.get().trim()) return { error: 'API key is required' };
		return { url: urlValue, config: { apiKey: apiKey.get().trim(), intervalMinutes } };
	};

	handle.read = read;
	handle.test = async () => {
		const values = read();
		if ('error' in values) throw new Error(values.error);
		return (await api.testConnection(type, values.url, values.config)).message;
	};

	return tpl.fragment({
		appName: { inner: appName },
		appName2: { inner: appName },
		urlInput: { _ref: refBindInput(url) },
		apiKeyInput: { _ref: refBindInput(apiKey) },
		intervalInput: { _ref: refBindInput(interval), min: String(ARR_SYNC_MIN_INTERVAL_MINUTES) },
		intervalHint: { inner: `min. ${ARR_SYNC_MIN_INTERVAL_MINUTES}; each run performs up to 10 searches` },
	});
});
