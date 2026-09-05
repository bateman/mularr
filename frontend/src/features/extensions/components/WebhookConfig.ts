import { component, refBindInput, signal } from 'chispa';
import { Extension, WEBHOOK_EVENTS, parseWebhookEvents } from '../../../services/ExtensionsApiService';
import tpl from './WebhookConfig.html';

export interface WebhookConfigProps {
	extension: Extension;
	onSave: (data: { url: string; events: string[] }) => void;
	onCancel: () => void;
}

export const WebhookConfig = component<WebhookConfigProps>(({ extension, onSave, onCancel }) => {
	const url = signal(extension.url);
	const selected = new Set(parseWebhookEvents(extension.config));

	return tpl.fragment({
		urlInput: { _ref: refBindInput(url) },
		eventsList: {
			inner: WEBHOOK_EVENTS.map((ev) =>
				tpl.eventRow({
					nodes: {
						eventCheckbox: {
							checked: selected.has(ev.id),
							onchange: (e: Event) => {
								if ((e.target as HTMLInputElement).checked) selected.add(ev.id);
								else selected.delete(ev.id);
							},
						},
						eventLabel: { inner: ev.label },
						eventId: { inner: ev.id },
						eventDescription: { inner: ev.description },
					},
				})
			),
		},
		btnSave: { onclick: () => onSave({ url: url.get().trim(), events: [...selected] }) },
		btnCancel: { onclick: onCancel },
	});
});
