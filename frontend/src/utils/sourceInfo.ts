import { getProviderName } from '../services/ProvidersApiService';

/** What a Provider Info cell shows: the source label and, when the provider has one, the release's page on its website. */
export interface SourceInfo {
	provider?: string;
	sourceName?: string;
	webUrl?: string;
}

/** Provider Info content: the label, as a link to the release's page when there is one; `fallback` when there is no label. */
export function sourceInfoContent(info: SourceInfo, fallback = ''): string | HTMLElement {
	if (!info.sourceName) return fallback;
	if (!info.webUrl) return info.sourceName;
	const a = document.createElement('a');
	a.href = info.webUrl;
	a.target = '_blank';
	a.rel = 'noopener';
	a.textContent = info.sourceName;
	a.onclick = (e) => e.stopPropagation(); // keep the row's own click handling (selection, details) untouched
	return a;
}
