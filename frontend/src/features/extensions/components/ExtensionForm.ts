import { component, refBindCheckbox, refBindInput, signal } from 'chispa';
import { Extension, ExtensionType, isArrExtensionType } from '../../../services/ExtensionsApiService';
import { ApiError } from '../../../services/BaseApiService';
import type { ConfigFormHandle, ConfigFormProps } from './ConfigForm';
import { ArrConfigForm } from './ArrConfigForm';
import { WebhookConfigForm } from './WebhookConfigForm';
import { UrlConfigForm } from './UrlConfigForm';
import { HispashareConfigForm } from './HispashareConfigForm';
import tpl from './ExtensionForm.html';

export interface ExtensionFormValues {
	name: string;
	enabled: boolean;
	url: string;
	config: Record<string, unknown>;
}

export interface ExtensionFormProps {
	type: ExtensionType;
	/** Present when editing an existing extension; absent when creating one. */
	extension?: Extension;
	/** Persists the values; a rejection is shown in the form and keeps it open. */
	onSave: (values: ExtensionFormValues) => Promise<void>;
	onCancel: () => void;
}

/** Type-specific form; null for types with nothing to configure at creation (Telegram sets itself up afterwards). */
function createConfigForm(props: ConfigFormProps) {
	if (isArrExtensionType(props.type)) return ArrConfigForm(props);
	switch (props.type) {
		case 'webhook':
			return WebhookConfigForm(props);
		case 'media_previewer':
			return UrlConfigForm(props);
		case 'hispashare':
			return HispashareConfigForm(props);
		default:
			return null;
	}
}

/**
 * The complete form of one extension type: name and enabled flag when creating, plus the type's own
 * settings (see the *ConfigForm components). Nothing is persisted until Save.
 */
export const ExtensionForm = component<ExtensionFormProps>(({ type, extension, onSave, onCancel }) => {
	const creating = !extension;
	const name = signal(extension?.name ?? '');
	const enabled = signal(extension ? !!extension.enabled : true);
	const status = signal<{ text: string; ok: boolean } | null>(null);
	const busy = signal(false);

	const handle: ConfigFormHandle = {};
	const configForm = createConfigForm({ type, extension, handle });
	// The config form fills the handle when it mounts, which happens while this fragment renders, after the
	// bindings below were built. Checked once that pass has finished, so the Test button shows up when supported.
	const canTest = signal(false);
	queueMicrotask(() => canTest.set(!!handle.test));

	const save = async () => {
		if (busy.get()) return;
		if (creating && !name.get().trim()) {
			status.set({ text: 'Label is required', ok: false });
			return;
		}
		const values = handle.read ? handle.read() : { url: extension?.url ?? '', config: {} };
		if ('error' in values) {
			status.set({ text: values.error, ok: false });
			return;
		}
		busy.set(true);
		try {
			await onSave({ name: name.get().trim(), enabled: enabled.get(), url: values.url, config: values.config });
		} catch (e) {
			status.set({ text: e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Failed to save', ok: false });
		} finally {
			busy.set(false);
		}
	};

	const test = async () => {
		if (busy.get() || !handle.test) return;
		busy.set(true);
		status.set({ text: 'Testing...', ok: true });
		try {
			status.set({ text: await handle.test(), ok: true });
		} catch (e) {
			status.set({ text: e instanceof ApiError || e instanceof Error ? e.message : 'Connection test failed', ok: false });
		} finally {
			busy.set(false);
		}
	};

	return tpl.fragment({
		commonFields: { style: { display: creating ? '' : 'none' } },
		nameInput: { _ref: refBindInput(name) },
		enabledInput: { _ref: refBindCheckbox(enabled) },
		configFormHost: { inner: configForm ?? '' },
		statusLine: {
			inner: () => status.get()?.text ?? '',
			style: { color: () => (status.get()?.ok === false ? '#ff4d4d' : '') },
		},
		btnTest: { onclick: test, disabled: () => busy.get(), style: { display: () => (canTest.get() ? '' : 'none') } },
		btnSave: { onclick: save, disabled: () => busy.get() },
		btnCancel: { onclick: onCancel },
	});
});
