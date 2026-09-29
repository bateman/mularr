import './styles/style.css';
import { inject, mountRoot } from 'chispa';
import { LocalPrefsService } from './services/LocalPrefsService';
import { AuthApiService } from './services/AuthApiService';
import { App } from './layout/App';
import { LoginView } from './features/login/LoginView';
import { routes } from './routes';

// Initialize theme
const prefs = inject(LocalPrefsService);
const savedTheme = prefs.getTheme();
document.documentElement.setAttribute('data-theme', savedTheme);

const mountApp = () => {
	mountRoot(App({ routes }), document.body);
};

(async () => {
	const authService = inject(AuthApiService);
	let loginRequired = false;
	try {
		loginRequired = (await authService.getStatus()).loginRequired;
	} catch {
		// If we can't reach the backend, proceed and let the app handle errors
	}

	// Show the login page only when the backend says this client needs it:
	// interactive login is enabled (both AUTH_USERNAME and AUTH_PASSWORD set) and
	// AUTH_REQUIRED=disabled_for_local_addresses doesn't exempt our address.
	// Otherwise the UI is served openly — either mularr sits behind a trusted
	// authenticating proxy, or we're on the LAN.
	if (loginRequired && !authService.isLoggedIn()) {
		mountRoot(LoginView({ onLogin: mountApp }), document.body);
	} else {
		mountApp();
	}
})();
