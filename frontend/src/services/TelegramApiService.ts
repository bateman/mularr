import { BaseApiService } from './BaseApiService';

export interface TelegramUser {
	id: string;
	firstName: string;
	lastName?: string;
	username?: string;
	phone?: string;
}

export interface TelegramStatus {
	status: 'connected' | 'disconnected' | 'waiting_code' | 'waiting_password';
	user?: TelegramUser;
	/** Whether searches reach the Telegram index; independent of being signed in. */
	searchEnabled: boolean;
}

/** A chat of the account with what the index holds for it. Every `_at` is epoch ms. */
export interface TelegramChat {
	id: string;
	title: string;
	type: string;
	indexing_enabled: boolean;
	/** A pass over this chat is running right now. */
	indexing_now: boolean;
	/** Indexed messages (text or media). */
	message_count: number;
	/** Indexed messages carrying a file. */
	media_count: number;
	/** Sum of the indexed file sizes, in bytes. */
	media_size: number;
	/** Forum topics known for the chat (0 for non-forum chats). */
	topic_count: number;
	last_message_id: number;
	/** Date of the newest indexed message; null while nothing is indexed. */
	last_message_at: number | null;
	/** End of the last indexing pass; null if the chat was never visited. */
	last_checked_at: number | null;
	/** Last pass that stored new messages; null if none did. */
	last_indexed_at: number | null;
	/** Error that ended the last pass; null when it went fine. */
	last_error: string | null;
}

/** Where the periodic indexing cycle stands. Times are epoch ms. */
export interface TelegramIndexingCycle {
	running: boolean;
	currentChatId: string | null;
	lastRunAt: number | null;
	/** When the next cycle is due; null while one runs or nothing is scheduled. */
	nextRunAt: number | null;
}

export interface TelegramChatsResponse {
	chats: TelegramChat[];
	cycle: TelegramIndexingCycle;
}

export class TelegramApiService extends BaseApiService {
	public constructor() {
		super('/api/telegram');
	}

	async getStatus(): Promise<TelegramStatus> {
		return this.request<TelegramStatus>('/status');
	}

	async startAuth(apiId: number, apiHash: string, phoneNumber: string): Promise<{ error?: string }> {
		return this.request<{ error?: string }>('/auth/start', {
			method: 'POST',
			body: JSON.stringify({ apiId, apiHash, phoneNumber }),
		});
	}

	async submitCode(code: string): Promise<{ error?: string }> {
		return this.request<{ error?: string }>('/auth/code', {
			method: 'POST',
			body: JSON.stringify({ code }),
		});
	}

	async submitPassword(password: string): Promise<{ error?: string }> {
		return this.request<{ error?: string }>('/auth/password', {
			method: 'POST',
			body: JSON.stringify({ password }),
		});
	}

	async logout(): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>('/logout', {
			method: 'POST',
		});
	}

	async setSearchEnabled(enabled: boolean): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>('/search-enabled', {
			method: 'PUT',
			body: JSON.stringify({ enabled }),
		});
	}

	async getChats(): Promise<TelegramChatsResponse> {
		return this.request<TelegramChatsResponse>('/chats');
	}

	/** Indexes the chat now instead of waiting for the next cycle (it must be enabled). */
	async indexChatNow(chatId: string): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(`/chats/${chatId}/index`, { method: 'POST' });
	}

	async updateChatIndexing(chatId: string, enabled: boolean): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(`/chats/${chatId}/indexing`, {
			method: 'PUT',
			body: JSON.stringify({ enabled }),
		});
	}
}
