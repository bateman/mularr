import { container } from '../../container/ServiceContainer';
import { AmuleService } from '../../AmuleService';
import type { IMediaProvider, MediaSearchResult, MediaTransfer, SearchCriteria } from '../types';
import { LoggerFactory } from '../../logging/Logger';

export class AmuleMediaProvider implements IMediaProvider {
	private readonly logger = LoggerFactory.create(this);
	readonly providerId = 'amule';
	private readonly amuleService = container.get(AmuleService);

	/** aMule is what Mularr runs on, so it always takes part. */
	isAvailable(): boolean {
		return true;
	}

	canHandleDownload(link: string): boolean {
		return !link.startsWith('telegram:');
	}

	/** eD2k searches by keywords only; the identifiers in the criteria are ignored. */
	async startSearch(criteria: SearchCriteria): Promise<void> {
		await this.amuleService.startSearch(criteria.query, criteria.amuleSearchType);
	}

	async getSearchResults(): Promise<MediaSearchResult[]> {
		try {
			const result = await this.amuleService.getSearchResults();
			return (result.list || []).map((f: any) => ({
				name: f.name,
				size: f.size,
				hash: f.hash,
				link: f.link,
				sourceCount: f.sourceCount,
				completeSourceCount: f.completeSourceCount,
				downloadStatus: f.downloadStatus,
				type: f.type || '',
				provider: 'amule',
			}));
		} catch (e) {
			this.logger.error('getSearchResults error:', e);
			return [];
		}
	}

	async getSearchStatus(): Promise<number> {
		try {
			const status = await this.amuleService.getSearchStatus();
			return status.progress ?? 0;
		} catch (e) {
			return 0;
		}
	}

	async addDownload(link: string): Promise<void> {
		await this.amuleService.addDownload(link);
	}

	async removeDownload(hash: string): Promise<void> {
		await this.amuleService.removeDownload(hash);
	}

	async pauseDownload(hash: string): Promise<void> {
		await this.amuleService.pauseDownload(hash);
	}

	async resumeDownload(hash: string): Promise<void> {
		await this.amuleService.resumeDownload(hash);
	}

	async stopDownload(hash: string): Promise<void> {
		await this.amuleService.stopDownload(hash);
	}

	async getTransfers(): Promise<MediaTransfer[]> {
		try {
			const result = await this.amuleService.getTransfers();
			return result.list.map((d) => ({ ...d, provider: 'amule' })) as MediaTransfer[];
		} catch (e) {
			this.logger.error('getTransfers error:', e);
			return [];
		}
	}

	async clearCompletedTransfers(hashes?: string[]): Promise<void> {
		if (!hashes) {
			await this.amuleService.clearCompletedTransfers();
		} else {
			const amuleHashes = hashes.filter((h) => !h.startsWith('telegram:'));
			if (amuleHashes.length > 0) {
				await this.amuleService.clearCompletedTransfers(amuleHashes);
			}
		}
	}
}
