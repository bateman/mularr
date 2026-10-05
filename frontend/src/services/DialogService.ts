import { type Component } from 'chispa';
import { DialogHost } from '../components/DialogHost';
import { MessageDialog } from '../components/MessageDialog';

export interface DialogCustomOptions {
	title: string;
	width?: string;
	render: (close: () => void) => Component;
	onClose?: () => void;
}

export class DialogService {
	public alert(message: string, title: string = 'Message'): Promise<void> {
		return new Promise((resolve) => {
			this.open({
				title,
				width: '420px',
				render: (close) =>
					MessageDialog({
						message,
						type: 'alert',
						onConfirm: () => {
							close();
							resolve();
						},
					}),
			});
		});
	}

	public confirm(message: string, title: string = 'Confirm'): Promise<boolean> {
		return new Promise((resolve) => {
			this.open({
				title,
				width: '420px',
				render: (close) =>
					MessageDialog({
						message,
						type: 'confirm',
						onConfirm: () => {
							close();
							resolve(true);
						},
						onCancel: () => {
							close();
							resolve(false);
						},
					}),
			});
		});
	}

	public open(options: DialogCustomOptions) {
		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			dialogInstance.unmount();
			options.onClose?.();
		};
		const dialogInstance = DialogHost({
			title: options.title,
			width: options.width,
			onClose: close,
			body: options.render(close),
		});

		dialogInstance.mount(document.body);
		return dialogInstance;
	}
}
