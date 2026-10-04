import { component, computed, effect, inject, refBindCheckbox, refBindInput, refBindSelect, signal } from 'chispa';
import { TelegramApiService, type TelegramChat, type TelegramChatsResponse } from '../../../services/TelegramApiService';
import { type ContextMenuItem } from '../../../services/ContextMenuService';
import { DialogService } from '../../../services/DialogService';
import { LocalPrefsService } from '../../../services/LocalPrefsService';
import { ColumnsMenuService } from '../../../services/ColumnsMenuService';
import { ListManager, type MobileSortOption } from '../../../utils/ListManager';
import { TableColumns } from '../../../utils/TableColumns';
import { relativeTime } from '../../../utils/formats';
import { smartLoad, smartPoll } from '../../../utils/scheduling';
import { ChatRows, toChatItems, type ChatColumn, type ChatItem } from './TelegramChatRows';
import tpl from './TelegramChatsTable.html';
import './TelegramChatsTable.css';

/** The chats list is re-read this often, so counters and "indexing now" move on their own. */
const CHATS_POLL_MS = 10_000;

const MOBILE_SORT_OPTIONS: MobileSortOption<ChatColumn>[] = [
	{ value: 'title-asc', label: 'Chat A→Z', col: 'title', dir: 'asc' },
	{ value: 'title-desc', label: 'Chat Z→A', col: 'title', dir: 'desc' },
	{ value: 'messages-desc', label: 'Messages ↓', col: 'message_count', dir: 'desc' },
	{ value: 'messages-asc', label: 'Messages ↑', col: 'message_count', dir: 'asc' },
	{ value: 'files-desc', label: 'Files ↓', col: 'media_count', dir: 'desc' },
	{ value: 'size-desc', label: 'Size ↓', col: 'media_size', dir: 'desc' },
	{ value: 'last-message-desc', label: 'Last message ↓', col: 'last_message_at', dir: 'desc' },
	{ value: 'last-checked-desc', label: 'Last checked ↓', col: 'last_checked_at', dir: 'desc' },
];

export interface TelegramChatsTableProps {
	/** Receives the message of a failed action (toggle, index now, clear, delete), for the host to display. */
	onError: (message: string) => void;
}

/**
 * The chats of the Telegram account with what the index holds for each one, filterable, sortable and
 * multi-selectable, with per-chat actions (the destructive ones, clearing or deleting a chat's index, live in
 * the row menu, which acts on the whole selection).
 * Loads and polls the list itself, so mount it only while signed in: the poller stops on unmount.
 */
export const TelegramChatsTable = component<TelegramChatsTableProps>(({ onError }) => {
	const api = inject(TelegramApiService);
	const dialogs = inject(DialogService);
	const prefs = inject(LocalPrefsService);
	const columnsMenu = inject(ColumnsMenuService);
	const columns = new TableColumns({ prefs, prefsKey: 'telegram.chats' });

	// Sorting and multi-selection (click, Ctrl/Cmd+click, Shift+click). Nulls (never checked, nothing indexed) sort last either way.
	const mgr = new ListManager<ChatItem, ChatColumn>({
		defaultColumn: 'title',
		numericColumns: ['message_count', 'media_count', 'media_size', 'topic_count', 'last_message_at', 'last_checked_at'],
		mobileSortOptions: MOBILE_SORT_OPTIONS,
		prefs: { service: prefs, key: 'telegram.chats' },
	});

	/** The chats list with the cycle status, as the API returns it; null until the first load. */
	const data = signal<TelegramChatsResponse | null>(null);
	/** Wall-clock reference for the relative times, refreshed with `data`. */
	const now = signal(Date.now());
	const filterText = signal('');
	const onlyIndexing = signal(false);

	const loadChats = smartLoad(async () => {
		data.set(await api.getChats());
		now.set(Date.now());
	}, 'telegram-chats');

	/** Runs an action on a chat and reloads the list; failures go to the host. */
	const runAction = async (action: () => Promise<unknown>, errorText: string) => {
		try {
			await action();
			loadChats();
		} catch (e: any) {
			onError(e.message || errorText);
		}
	};

	const toggleChat = (chat: TelegramChat) => runAction(() => api.updateChatIndexing(chat.id, !chat.indexing_enabled), 'Error updating chat');
	const indexChatNow = (chat: TelegramChat) => runAction(() => api.indexChatNow(chat.id), 'Error requesting the indexing');

	// Menu actions work on the selection; the texts name the chat when there is one, the count otherwise
	const describe = (chats: TelegramChat[]) => (chats.length === 1 ? `"${chats[0].title}"` : `${chats.length} chats`);
	const countMessages = (chats: TelegramChat[]) => chats.reduce((sum, c) => sum + c.message_count, 0).toLocaleString();

	const setChatsIndexing = (chats: TelegramChat[], enabled: boolean) =>
		runAction(() => Promise.all(chats.map((c) => api.updateChatIndexing(c.id, enabled))), 'Error updating chats');
	const indexChatsNow = (chats: TelegramChat[]) => runAction(() => Promise.all(chats.map((c) => api.indexChatNow(c.id))), 'Error requesting the indexing');

	const clearChatsIndex = async (chats: TelegramChat[]) => {
		const enabledCount = chats.filter((c) => c.indexing_enabled).length;
		const next =
			enabledCount === chats.length
				? `${chats.length === 1 ? 'The chat stays' : 'The chats stay'} enabled and will be indexed again from scratch.`
				: enabledCount === 0
					? `${chats.length === 1 ? 'The chat stays' : 'The chats stay'} ignored.`
					: 'Enabled chats will be indexed again from scratch, ignored ones stay as they are.';
		const message = `Clear the index of ${describe(chats)}?\n\n${countMessages(chats)} messages and their topics will be removed. ${next}`;
		if (!(await dialogs.confirm(message, 'Clear Index'))) return;
		await runAction(() => Promise.all(chats.map((c) => api.clearChatIndex(c.id))), 'Error clearing the chat index');
	};

	const deleteChats = async (chats: TelegramChat[]) => {
		const message =
			`Delete ${describe(chats)} and ${chats.length === 1 ? 'its' : 'their'} ${countMessages(chats)} indexed messages?\n\n` +
			`If the account still has ${chats.length === 1 ? 'this chat' : 'any of these chats'}, it will show up again as Ignored after the next indexing cycle.`;
		if (!(await dialogs.confirm(message, 'Delete Chat'))) return;
		mgr.clearSelection();
		await runAction(() => Promise.all(chats.map((c) => api.deleteChat(c.id))), 'Error deleting the chat');
	};

	// Purging a chat while a pass over it runs is refused by the backend, so the menu greys those entries out meanwhile.
	// Enable/Disable takes its direction from the clicked row and applies it to the whole selection, as the servers table does.
	const menuItems = (targets: ChatItem[], clicked: ChatItem): ContextMenuItem[] => {
		const suffix = targets.length > 1 ? ` (${targets.length} chats)` : '';
		const indexable = targets.filter((c) => c.indexing_enabled && !c.indexing_now);
		const anyRunning = targets.some((c) => c.indexing_now);
		return [
			{
				label: `Index now${indexable.length > 1 ? ` (${indexable.length} chats)` : ''}`,
				icon: '🔄',
				disabled: indexable.length === 0,
				onClick: () => indexChatsNow(indexable),
			},
			{
				label: `${clicked.indexing_enabled ? 'Disable' : 'Enable'} indexing${suffix}`,
				icon: clicked.indexing_enabled ? '⏸️' : '▶️',
				onClick: () => setChatsIndexing(targets, !clicked.indexing_enabled),
			},
			{ separator: true },
			{ label: `Clear index${suffix}`, icon: '🧹', disabled: anyRunning, onClick: () => clearChatsIndex(targets) },
			{
				label: targets.length > 1 ? `Delete ${targets.length} chats` : 'Delete chat',
				icon: '🗑️',
				disabled: anyRunning,
				onClick: () => deleteChats(targets),
			},
		];
	};

	// Loads right away and keeps the list fresh until the component leaves the DOM
	smartPoll(loadChats, CHATS_POLL_MS);

	const allChats = computed(() => data.get()?.chats ?? []);

	// Filter here, sort in the manager ("Only indexing" narrows long lists)
	const filteredChats = computed(() => {
		const text = filterText.get().trim().toLowerCase();
		const indexingOnly = onlyIndexing.get();
		return allChats.get().filter((c) => (!indexingOnly || c.indexing_enabled) && (!text || c.title.toLowerCase().includes(text)));
	});
	effect(() => mgr.items.set(toChatItems(filteredChats.get())));
	const visibleChats = mgr.sortedItems;

	const emptyText = computed(() => {
		if (data.get() === null) return 'Loading chats...';
		if (allChats.get().length === 0) return 'No chats loaded.';
		return filteredChats.get().length === 0 ? 'No chats match the filter.' : '';
	});

	const cycleNote = computed(() => {
		const res = data.get();
		if (!res) return '';
		const { cycle, chats } = res;
		if (cycle.running) {
			const current = cycle.currentChatId ? chats.find((c) => c.id === cycle.currentChatId) : undefined;
			return current ? `Indexing ${current.title}…` : 'Indexing cycle running…';
		}
		const parts: string[] = [];
		if (cycle.lastRunAt) parts.push(`last cycle ${relativeTime(cycle.lastRunAt, now.get())}`);
		if (cycle.nextRunAt) parts.push(`next check ${relativeTime(cycle.nextRunAt, now.get())}`);
		return parts.join(' · ');
	});

	return tpl.fragment({
		cycleNote: { inner: cycleNote },
		filterInput: { _ref: refBindInput(filterText) },
		onlyIndexingCheck: { _ref: refBindCheckbox(onlyIndexing) },
		mobileSortSelect: { _ref: refBindSelect(mgr.mobileSortValue, MOBILE_SORT_OPTIONS) },
		btnRefresh: { onclick: loadChats },
		columnsBtn: { onclick: (e) => columnsMenu.show(e.currentTarget as HTMLElement, columns) },
		chatsTable: { _ref: (el) => columns.attach(el) },
		thChat: { onclick: () => mgr.sort('title') },
		thType: { onclick: () => mgr.sort('type') },
		thStatus: { onclick: () => mgr.sort('indexing_enabled') },
		thMessages: { onclick: () => mgr.sort('message_count') },
		thFiles: { onclick: () => mgr.sort('media_count') },
		thSize: { onclick: () => mgr.sort('media_size') },
		thTopics: { onclick: () => mgr.sort('topic_count') },
		thLastMessage: { onclick: () => mgr.sort('last_message_at') },
		thLastChecked: { onclick: () => mgr.sort('last_checked_at') },
		thError: { onclick: () => mgr.sort('last_error') },
		chatsList: {
			inner: () =>
				emptyText.get()
					? tpl.emptyRow({ nodes: { emptyText: { inner: emptyText } } })
					: ChatRows(visibleChats, { now, mgr, onToggleChat: toggleChat, onIndexNow: indexChatNow, menuItems }),
		},
	});
});
