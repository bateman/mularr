import { component, refBindInput, signal } from 'chispa';
import { Extension } from '../../../services/ExtensionsApiService';
import tpl from './ExtensionUrlConfig.html';

export interface ExtensionUrlConfigProps {
	extension: Extension;
	onSave: (url: string) => void;
	onCancel: () => void;
}

/** Config dialog for extensions whose only setting is the endpoint they point to (e.g. media previewer). */
export const ExtensionUrlConfig = component<ExtensionUrlConfigProps>(({ extension, onSave, onCancel }) => {
	const url = signal(extension.url);

	return tpl.fragment({
		urlInput: { _ref: refBindInput(url) },
		btnSave: { onclick: () => onSave(url.get().trim()) },
		btnCancel: { onclick: onCancel },
	});
});
