import { component, refBindInput, signal } from 'chispa';
import type { ConfigFormProps } from './ConfigForm';
import tpl from './UrlConfigForm.html';

/** Config form for extensions whose only setting is the endpoint they point to (e.g. media previewer). */
export const UrlConfigForm = component<ConfigFormProps>(({ extension, handle }) => {
	const url = signal(extension?.url ?? '');

	handle.read = () => {
		const value = url.get().trim();
		if (!value) return { error: 'URL is required' };
		return { url: value, config: {} };
	};

	return tpl.fragment({
		urlInput: { _ref: refBindInput(url) },
	});
});
