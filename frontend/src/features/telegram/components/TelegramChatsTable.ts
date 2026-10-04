import { component, componentList, computed, inject, refBindCheckbox, refBindInput, signal, type Signal } from 'chispa';
import { TelegramApiService, type TelegramChat, type TelegramChatsResponse } from '../../../services/TelegramApiService';
import { LocalPrefsService } from '../../../services/LocalPrefsService';
import { ColumnsMenuService } from '../../../services/ColumnsMenuService';
import { TableColumns } from '../../../utils/TableColumns';
import { fbytes, relativeTime } from '../../../utils/formats';
import { smartLoad, smartPoll } from '../../../utils/scheduling';
import tpl from './TelegramChatsTable.html';
import './TelegramChatsTable.css';

/** The chats list is re-read this often, so counters and "indexing now" move on their own. */
const CHATS_POLL_MS = 10_000;

export interface TelegramChatsTableProps {
	/** Receives the message of a failed action (toggle, index now), for the host to display. */
	onError: (message: string) => void;
}

interface ChatRowProps {
	now: Signal<number>;
	onToggleChat: (chat: TelegramChat) => void;
	onIndexNow: (chat: TelegramChat) => void;
}

const fullDate = (at: number | null) => (at ? new Date(at).toLocaleString() : '');

const ChatRows = componentList<TelegramChat, ChatRowProps>(
	(c, i, l, props) => {
		const { now, onToggleChat, onIndexNow } = props!;
		const statusText = () => (c.get().indexing_now ? 'Indexing now…' : c.get().indexing_enabled ? 'Indexing' : 'Ignored');
		const statusClasses = {
			'is-running': () => c.get().indexing_now,
			'is-indexing': () => !c.get().indexing_now && c.get().indexing_enabled,
			'is-ignored': () => !c.get().indexing_enabled,
		};
		const toggleText = () => (c.get().indexing_enabled ? 'Disable' : 'Enable');
		const lastMessage = () => (c.get().last_message_at ? relativeTime(c.get().last_message_at!, now.get()) : '-');
		const lastChecked = () => {
			const chat = c.get();
			if (chat.indexing_now) return 'now';
			return chat.last_checked_at ? relativeTime(chat.last_checked_at, now.get()) : 'never';
		};
		// The index button only makes sense for enabled chats, and not while a pass over the chat runs
		const indexBtn = {
			onclick: () => onIndexNow(c.get()),
			disabled: () => c.get().indexing_now,
			style: { display: () => (c.get().indexing_enabled ? '' : 'none') },
		};
		const toggleBtn = { inner: toggleText, onclick: () => onToggleChat(c.get()) };

		return tpl.chatRow({
			nodes: {
				chatNameText: { inner: () => c.get().title, title: () => `${c.get().title} (${c.get().id})` },
				mobType: { inner: () => c.get().type },
				mobCounts: {
					inner: () => {
						const chat = c.get();
						return `${chat.message_count.toLocaleString()} msgs · ${chat.media_count.toLocaleString()} files · ${fbytes(chat.media_size)}`;
					},
				},
				mobChecked: { inner: () => `Checked ${lastChecked()}` },
				mobError: {
					inner: () => c.get().last_error ?? '',
					style: { display: () => (c.get().last_error ? '' : 'none') },
				},
				mobStatusBadge: { inner: statusText, classes: statusClasses },
				mobIndexBtn: indexBtn,
				mobToggleBtn: toggleBtn,

				typeCol: { inner: () => c.get().type },
				statusBadge: { inner: statusText, classes: statusClasses },
				messagesCol: { inner: () => c.get().message_count.toLocaleString() },
				filesCol: { inner: () => c.get().media_count.toLocaleString() },
				sizeCol: { inner: () => (c.get().media_size > 0 ? fbytes(c.get().media_size) : '-') },
				topicsCol: { inner: () => (c.get().topic_count > 0 ? String(c.get().topic_count) : '-') },
				lastMessageCol: { inner: lastMessage, title: () => fullDate(c.get().last_message_at) },
				lastCheckedCol: {
					inner: lastChecked,
					title: () => {
						const chat = c.get();
						const checked = fullDate(chat.last_checked_at);
						const indexed = chat.last_indexed_at ? `New messages: ${fullDate(chat.last_indexed_at)}` : 'No new messages so far';
						return checked ? `${checked}\n${indexed}` : '';
					},
				},
				errorCol: { inner: () => c.get().last_error ?? '', title: () => c.get().last_error ?? '' },
				indexBtn,
				toggleBtn,
			},
		});
	},
	(c) => c.id
);

/**
 * The chats of the Telegram account with what the index holds for each one, filterable, with per-chat actions.
 * Loads and polls the list itself, so mount it only while signed in: the poller stops on unmount.
 */
export const TelegramChatsTable = component<TelegramChatsTableProps>(({ onError }) => {
	const api = inject(TelegramApiService);
	const prefs = inject(LocalPrefsService);
	const columnsMenu = inject(ColumnsMenuService);
	const columns = new TableColumns({ prefs, prefsKey: 'telegram.chats' });

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

	const toggleChat = async (chat: TelegramChat) => {
		try {
			await api.updateChatIndexing(chat.id, !chat.indexing_enabled);
			loadChats();
		} catch (e: any) {
			onError(e.message || 'Error updating chat');
		}
	};

	const indexChatNow = async (chat: TelegramChat) => {
		try {
			await api.indexChatNow(chat.id);
			loadChats();
		} catch (e: any) {
			onError(e.message || 'Error requesting the indexing');
		}
	};

	// Loads right away and keeps the list fresh until the component leaves the DOM
	smartPoll(loadChats, CHATS_POLL_MS);

	const allChats = computed(() => data.get()?.chats ?? []);

	// Alphabetical only: a row keeps its place when its indexing is toggled ("Only indexing" narrows long lists)
	const visibleChats = computed(() => {
		const text = filterText.get().trim().toLowerCase();
		const indexingOnly = onlyIndexing.get();
		return allChats
			.get()
			.filter((c) => (!indexingOnly || c.indexing_enabled) && (!text || c.title.toLowerCase().includes(text)))
			.sort((a, b) => a.title.localeCompare(b.title));
	});

	const emptyText = computed(() => {
		if (data.get() === null) return 'Loading chats...';
		if (allChats.get().length === 0) return 'No chats loaded.';
		return visibleChats.get().length === 0 ? 'No chats match the filter.' : '';
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
		btnRefresh: { onclick: loadChats },
		columnsBtn: { onclick: (e) => columnsMenu.show(e.currentTarget as HTMLElement, columns) },
		chatsTable: { _ref: (el) => columns.attach(el) },
		chatsList: {
			inner: () =>
				emptyText.get()
					? tpl.emptyRow({ nodes: { emptyText: { inner: emptyText } } })
					: ChatRows(visibleChats, { now, onToggleChat: toggleChat, onIndexNow: indexChatNow }),
		},
	});
});
