import { type Route } from 'chispa';
import { DashboardView } from './features/dashboard/DashboardView';
import { ServersView } from './features/servers/ServersView';
import { TransfersView } from './features/transfers/TransfersView';
import { SearchView } from './features/search/SearchView';
import { SharedView } from './features/shared/SharedView';
import { SettingsView } from './features/settings/SettingsView';
import { CategoriesView } from './features/categories/CategoriesView';
import { ExtensionsView } from './features/extensions/ExtensionsView';
import { IndexerFeedView } from './features/indexerfeed/IndexerFeedView';

export const routes: Route[] = [
	{ path: '/', component: DashboardView },
	{ path: '/dashboard', component: DashboardView },
	{ path: '/servers', component: ServersView },
	{ path: '/transfers', component: TransfersView },
	{ path: '/search', component: SearchView },
	{ path: '/shared', component: SharedView },
	{ path: '/indexer-feed', component: IndexerFeedView },
	{ path: '/extensions', component: ExtensionsView },
	{ path: '/categories', component: CategoriesView },
	{ path: '/settings', component: SettingsView },
];
