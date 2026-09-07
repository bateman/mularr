import { Router } from 'express';
import { ExtensionsController } from '../controllers/ExtensionsController';

export const extensionsRoutes = () => {
	const router = Router();
	const controller = new ExtensionsController();

	router.get('/', controller.list);
	router.post('/', controller.add);
	router.delete('/:id', controller.delete);
	router.patch('/:id', controller.update);
	router.patch('/:id/toggle', controller.toggle);
	router.patch('/:id/config', controller.updateConfig);

	return router;
};
