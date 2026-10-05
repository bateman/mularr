import { component, inject, refBindInput, signal } from 'chispa';
import {
	ExtensionsApiService,
	HISPASHARE_DEFAULT_API_URL,
	parseHispashareConfig,
	type HispashareExtensionConfig,
} from '../../../services/ExtensionsApiService';
import type { ConfigFormProps, ConfigFormValues } from './ConfigForm';
import tpl from './HispashareConfigForm.html';

/** Config form for the hispashare extension: API URL and personal token. */
export const HispashareConfigForm = component<ConfigFormProps>(({ type, extension, handle }) => {
	const api = inject(ExtensionsApiService);
	const stored = parseHispashareConfig(extension?.config);

	const url = signal(extension?.url || HISPASHARE_DEFAULT_API_URL);
	const token = signal(stored.token);

	const read = (): (ConfigFormValues & { config: HispashareExtensionConfig }) | { error: string } => {
		const tokenValue = token.get().trim();
		if (!tokenValue) return { error: 'Token is required' };
		return { url: url.get().trim() || HISPASHARE_DEFAULT_API_URL, config: { token: tokenValue } };
	};

	handle.read = read;
	handle.test = async () => {
		const values = read();
		if ('error' in values) throw new Error(values.error);
		return (await api.testConnection(type, values.url, values.config)).message;
	};

	return tpl.fragment({
		urlInput: { _ref: refBindInput(url) },
		tokenInput: { _ref: refBindInput(token) },
	});
});
