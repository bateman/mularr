import { Bot, InputFile } from 'node-telegram-bot-api';
import axios from 'axios';
import { LoggerFactory } from './logging/Logger';

export class TelegramBotService {
	private readonly logger = LoggerFactory.create(this);
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
			this.logger.info('Telegram Bot Service initialized');
		} else {
			this.logger.warn('Telegram Bot Service NOT initialized: Missing token or chatId');
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
			this.logger.error('Error sending Telegram message:', error);
		}
	}
}
