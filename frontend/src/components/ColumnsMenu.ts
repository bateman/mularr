import { component, onUnmount, signal } from 'chispa';
import { TableColumns } from '../utils/TableColumns';
import tpl from './ColumnsMenu.html';
import '../styles/ui-context-menu.css';

export interface IColumnsMenuProps {
	/** The button that opened the menu; the menu drops below it, right-aligned. */
	anchor: HTMLElement;
	columns: TableColumns;
	onClose: () => void;
}

/** Popup with one checkbox per table column. Toggling keeps the menu open; "Reset columns" closes it. */
export const ColumnsMenu = component<IColumnsMenuProps>(({ anchor, columns, onClose }) => {
	const list = signal(columns.columns());
	onUnmount(columns.onChange(() => list.set(columns.columns())));

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') onClose();
	};
	document.addEventListener('keydown', onKeyDown);
	onUnmount(() => document.removeEventListener('keydown', onKeyDown));

	const rect = anchor.getBoundingClientRect();

	return tpl.fragment({
		overlay: {
			onclick: (e) => {
				if ((e.target as HTMLElement).closest('.ctx-menu') === null) onClose();
			},
			oncontextmenu: (e) => {
				e.preventDefault();
				onClose();
			},
		},
		container: {
			style: {
				top: `${rect.bottom + 2}px`,
				right: `${Math.max(0, window.innerWidth - rect.right)}px`,
			},
		},
		colList: {
			inner: () =>
				list.get().map((col) =>
					tpl.colItem({
						classes: { 'ctx-menu-item-disabled': col.locked },
						title: col.locked ? 'This column is always visible' : '',
						onclick: (e) => {
							e.stopPropagation();
							if (!col.locked) columns.setVisible(col.key, !col.visible);
						},
						nodes: {
							colCheck: { checked: col.visible, disabled: col.locked },
							colLabel: { inner: col.label },
						},
					})
				),
		},
		resetItem: {
			onclick: (e: MouseEvent) => {
				e.stopPropagation();
				columns.reset();
				onClose();
			},
		},
	});
});
