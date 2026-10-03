import { component, refBindSelect, signal, SelectOption } from 'chispa';
import { EXTENSION_TYPES, ExtensionType } from '../../../services/ExtensionsApiService';
import tpl from './ExtensionTypePicker.html';

const EXTENSION_TYPE_OPTIONS: SelectOption[] = Object.entries(EXTENSION_TYPES).map(([k, v]) => ({ label: v.label, value: k }));

export interface ExtensionTypePickerProps {
	onSelect: (type: ExtensionType) => void;
	onCancel: () => void;
}

/** First step of adding an extension: pick the type. The form for that type comes next (see ExtensionForm). */
export const ExtensionTypePicker = component<ExtensionTypePickerProps>(({ onSelect, onCancel }) => {
	const extensionType = signal<string>(EXTENSION_TYPE_OPTIONS[0].value);

	return tpl.fragment({
		typeSelect: { _ref: refBindSelect(extensionType, EXTENSION_TYPE_OPTIONS) },
		btnAccept: { onclick: () => onSelect(extensionType.get() as ExtensionType) },
		btnCancel: { onclick: onCancel },
	});
});
