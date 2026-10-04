import { Router } from 'express';
import { TelegramController } from '../controllers/TelegramController';

export const telegramRoutes = () => {
	const router = Router();
	const controller = new TelegramController();

	router.get('/status', controller.getStatus);
	router.post('/auth/start', controller.startAuth);
	router.post('/auth/code', controller.submitCode);
	router.post('/auth/password', controller.submitPassword);
	router.post('/logout', controller.logout);
	router.put('/search-enabled', controller.setSearchEnabled);

	router.get('/chats', controller.getChats);
	router.put('/chats/:chatId/indexing', controller.updateChatIndexing);
	router.post('/chats/:chatId/index', controller.indexChatNow);

	return router;
};
