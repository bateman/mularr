import { inject, component, signal } from 'chispa';
import { ExtensionsApiService, Extension, EXTENSION_TYPES } from '../../services/ExtensionsApiService';
import { DialogService } from '../../services/DialogService';
import { TelegramConfig } from './components/TelegramConfig';
import { WebhookConfig } from './components/WebhookConfig';
import { AddExtensionForm } from './components/AddExtensionForm';
import tpl from './ExtensionsView.html';
import './ExtensionsView.css';

export const ExtensionsView = component(() => {
	const api = inject(ExtensionsApiService);
	const dialogService = inject(DialogService);
	const extensions = signal<Extension[]>([]);

	const refresh = async () => {
		try {
			const list = await api.getExtensions();
			extensions.set(list);
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to load extensions', 'Error');
		}
	};

	const handleDelete = async (id: number) => {
		if (await dialogService.confirm('Are you sure you want to delete this extension?', 'Delete Extension')) {
			try {
				await api.deleteExtension(id);
				refresh();
			} catch (e) {
				console.error(e);
				await dialogService.alert('Failed to delete extension', 'Error');
			}
		}
	};

	const handleToggle = async (id: number, current: boolean) => {
		try {
			await api.toggleExtension(id, !current);
			refresh();
		} catch (e) {
			console.error(e);
			await dialogService.alert('Failed to toggle extension status', 'Error');
		}
	};

	const openAddDialog = () => {
		dialogService.open({
			title: 'Add Extension',
			render: (close) =>
				AddExtensionForm({
					onSave: async (v) => {
						if (EXTENSION_TYPES[v.type]?.requiresUrl && !v.url) {
							await dialogService.alert('URL is required for this extension type');
							return;
						}
						try {
							const res = await api.addExtension(v);
							await refresh();
							close();
							// A webhook does nothing until events are selected — open its config right away
							if (v.type === 'webhook' && res?.id != null) {
								const created = extensions.get().find((x) => x.id === res.id);
								if (created) openWebhookDialog(created);
							}
						} catch (e) {
							console.error(e);
							await dialogService.alert('Failed to add extension', 'Error');
						}
					},
					onCancel: close,
				}),
		});
	};

	const openTelegramDialog = () => {
		dialogService.open({
			title: 'Telegram Configuration',
			width: '700px',
			render: () => TelegramConfig(),
		});
	};

	const openWebhookDialog = (ext: Extension) => {
		dialogService.open({
			title: `Webhook: ${ext.name}`,
			width: '450px',
			render: (close) =>
				WebhookConfig({
					extension: ext,
					onSave: async (events) => {
						try {
							await api.updateExtensionConfig(ext.id, { events });
							refresh();
							close();
						} catch (e) {
							console.error(e);
							await dialogService.alert('Failed to save webhook configuration', 'Error');
						}
					},
					onCancel: close,
				}),
		});
	};

	const openConfigDialog = (ext: Extension) => {
		if (ext.type === 'telegram_indexer') openTelegramDialog();
		else if (ext.type === 'webhook') openWebhookDialog(ext);
	};

	const hasConfigDialog = (ext: Extension) => ext.type === 'telegram_indexer' || ext.type === 'webhook';

	refresh();

	return tpl.fragment({
		btnRefresh: { onclick: refresh },
		btnAdd: { onclick: openAddDialog },

		listBody: {
			inner: () => {
				const list = extensions.get();
				if (list.length === 0) {
					return tpl.noItemsRow({});
				}

				return list.map((v) =>
					tpl.extensionRow({
						nodes: {
							idCol: { inner: String(v.id) },
							nameCol: {
								nodes: {
									nameText: { inner: v.name },
									mobileInfo: {
										nodes: {
											mobUrl: { inner: v.url },
											mobEnabled: {
												inner: v.enabled ? 'Enabled' : 'Disabled',
												style: { color: v.enabled ? '#46d369' : '#ff4d4d', fontWeight: 'bold' },
											},
											mobBtnConfigure: {
												style: { display: hasConfigDialog(v) ? '' : 'none' },
												onclick: () => {
													openConfigDialog(v);
												},
											},
											mobBtnToggle: {
												onclick: () => handleToggle(v.id, !!v.enabled),
												inner: v.enabled ? 'Disable' : 'Enable',
											},
											mobBtnDelete: { onclick: () => handleDelete(v.id) },
										},
									},
								},
							},
							urlCol: { inner: v.url },
							typeCol: { inner: () => EXTENSION_TYPES[v.type]?.label ?? v.type },
							enabledCol: { inner: v.enabled ? 'Yes' : 'No' },

							btnConfigure: {
								style: { display: hasConfigDialog(v) ? '' : 'none' },
								onclick: () => {
									openConfigDialog(v);
								},
							},

							btnToggle: {
								onclick: () => handleToggle(v.id, !!v.enabled),
								inner: v.enabled ? 'Disable' : 'Enable',
							},
							btnDelete: { onclick: () => handleDelete(v.id) },
						},
					})
				);
			},
		},
	});
});
