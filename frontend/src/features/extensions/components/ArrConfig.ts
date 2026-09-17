import { component, inject, refBindInput, signal } from 'chispa';
import {
	ARR_SYNC_MIN_INTERVAL_MINUTES,
	EXTENSION_TYPES,
	Extension,
	ExtensionsApiService,
	parseArrConfig,
	type ArrExtensionConfig,
} from '../../../services/ExtensionsApiService';
import { ApiError } from '../../../services/BaseApiService';
import tpl from './ArrConfig.html';

export interface ArrConfigProps {
	extension: Extension;
	onSave: (data: { url: string; config: ArrExtensionConfig }) => void;
	onCancel: () => void;
}

/** Config dialog for the sonarr/radarr extensions: endpoint, API key and how often the wanted list is synced. */
export const ArrConfig = component<ArrConfigProps>(({ extension, onSave, onCancel }) => {
	const api = inject(ExtensionsApiService);
	const stored = parseArrConfig(extension.config);
	const appName = EXTENSION_TYPES[extension.type]?.label ?? extension.type;

	const url = signal(extension.url);
	const apiKey = signal(stored.apiKey);
	const interval = signal(String(stored.intervalMinutes));
	const status = signal<{ text: string; ok: boolean } | null>(null);
	const testing = signal(false);

	/** Current form values; null (after setting the status) when they are not valid. */
	const readForm = (): { url: string; config: ArrExtensionConfig } | null => {
		const intervalMinutes = Number(interval.get());
		if (!Number.isInteger(intervalMinutes) || intervalMinutes < ARR_SYNC_MIN_INTERVAL_MINUTES) {
			status.set({ text: `The sync interval must be a whole number of at least ${ARR_SYNC_MIN_INTERVAL_MINUTES} minutes`, ok: false });
			return null;
		}
		if (!apiKey.get().trim()) {
			status.set({ text: 'API key is required', ok: false });
			return null;
		}
		return { url: url.get().trim(), config: { apiKey: apiKey.get().trim(), intervalMinutes } };
	};

	const test = async () => {
		if (testing.get()) return;
		const form = readForm();
		if (!form) return;
		testing.set(true);
		status.set({ text: 'Testing...', ok: true });
		try {
			const res = await api.testConnection(extension.type, form.url, form.config);
			status.set({ text: res.message, ok: true });
		} catch (e) {
			status.set({ text: e instanceof ApiError ? e.message : 'Connection test failed', ok: false });
		} finally {
			testing.set(false);
		}
	};

	return tpl.fragment({
		appName: { inner: appName },
		appName2: { inner: appName },
		urlInput: { _ref: refBindInput(url) },
		apiKeyInput: { _ref: refBindInput(apiKey) },
		intervalInput: { _ref: refBindInput(interval), min: String(ARR_SYNC_MIN_INTERVAL_MINUTES) },
		intervalHint: { inner: `min. ${ARR_SYNC_MIN_INTERVAL_MINUTES}; each run performs up to 10 searches` },
		statusLine: {
			inner: () => status.get()?.text ?? '',
			style: { color: () => (status.get()?.ok === false ? '#ff4d4d' : '') },
		},
		btnTest: { onclick: test, disabled: () => testing.get() },
		btnSave: {
			onclick: () => {
				const form = readForm();
				if (form) onSave(form);
			},
		},
		btnCancel: { onclick: onCancel },
	});
});
