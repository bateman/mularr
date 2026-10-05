import { component, refBindInput, signal } from 'chispa';
import { WEBHOOK_EVENTS, parseWebhookEvents } from '../../../services/ExtensionsApiService';
import type { ConfigFormProps } from './ConfigForm';
import tpl from './WebhookConfigForm.html';

/** Config form for webhook extensions: endpoint plus the events it subscribes to. */
export const WebhookConfigForm = component<ConfigFormProps>(({ extension, handle }) => {
	const url = signal(extension?.url ?? '');
	const selected = new Set(parseWebhookEvents(extension?.config));

	handle.read = () => {
		const value = url.get().trim();
		if (!value) return { error: 'URL is required' };
		return { url: value, config: { events: [...selected] } };
	};

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
	});
});
