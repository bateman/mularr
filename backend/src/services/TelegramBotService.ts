import { Bot, InputFile } from 'node-telegram-bot-api';
import axios from 'axios';

export class TelegramBotService {
	private bot: Bot | null = null;
	private chatId: string | null = null;
	private topicId: number | null = null;

	private escape(text?: string) {
		return text ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
	}

	constructor(token: string | undefined, chatId: string | undefined, topicId?: number) {
		if (token && chatId) {
			this.bot = new Bot(token);
			this.chatId = chatId;
			this.topicId = topicId ?? null;
			console.log('Telegram Bot Service initialized');
		} else {
			console.warn('Telegram Bot Service NOT initialized: Missing token or chatId');
		}
	}

	async sendMessage(message: string) {
		if (!this.bot || !this.chatId) return;

		try {
			await this.bot.api.sendMessage({
				chat_id: this.chatId,
				text: message,
				parse_mode: 'HTML',
				message_thread_id: this.topicId ?? undefined,
			});
		} catch (error) {
			console.error('Error sending Telegram message:', error);
		}
	}
}
