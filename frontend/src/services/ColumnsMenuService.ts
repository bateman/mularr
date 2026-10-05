import { ColumnsMenu } from '../components/ColumnsMenu';
import { TableColumns } from '../utils/TableColumns';

/** Opens the column picker of a table below its button, one menu at a time (same shape as ContextMenuService). */
export class ColumnsMenuService {
	private currentMenu: ReturnType<typeof ColumnsMenu> | null = null;

	show(anchor: HTMLElement, columns: TableColumns): void {
		this.close();
		const menuInstance = ColumnsMenu({ anchor, columns, onClose: () => this.close() });
		this.currentMenu = menuInstance;
		menuInstance.mount(document.body);
	}

	close(): void {
		if (this.currentMenu) {
			this.currentMenu.unmount();
			this.currentMenu = null;
		}
	}
}
