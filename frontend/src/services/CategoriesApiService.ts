import { BaseApiService } from './BaseApiService';
import type { MediaCategory } from './MediaApiService';

// Wire contract owned by the backend, re-exported for the categories feature
export type { MediaCategory };

export class CategoriesApiService extends BaseApiService {
	constructor() {
		super('/api/amule/categories');
	}

	public async getAll(): Promise<MediaCategory[]> {
		return this.request<MediaCategory[]>('/');
	}

	public async create(category: Partial<MediaCategory>): Promise<MediaCategory> {
		return this.request<MediaCategory>('/', {
			method: 'POST',
			body: JSON.stringify(category),
		});
	}

	public async update(id: number, category: Partial<MediaCategory>, moveFiles = false): Promise<MediaCategory> {
		return this.request<MediaCategory>(`/${id}`, {
			method: 'PUT',
			body: JSON.stringify({ ...category, moveFiles }),
		});
	}

	public async delete(id: number): Promise<void> {
		return this.request<void>(`/${id}`, {
			method: 'DELETE',
		});
	}
}
