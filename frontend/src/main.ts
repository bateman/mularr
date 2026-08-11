import './styles/style.css';
import { inject, appendChild } from 'chispa';
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
	document.body.innerHTML = '';
	appendChild(document.body, App({ routes }));
};

(async () => {
	const authService = inject(AuthApiService);
	let status = { enabled: false, hasCredentials: false, hasApiKey: false, interactiveLoginEnabled: false };
	try {
		status = await authService.getStatus();
	} catch {
		// If we can't reach the backend, proceed and let the app handle errors
	}

	// Show the login page only when interactive login is enabled (both
	// AUTH_USERNAME and AUTH_PASSWORD set). When disabled, the UI is served
	// openly — mularr expects to sit behind a trusted authenticating proxy.
	if (status.interactiveLoginEnabled && !authService.isLoggedIn()) {
		appendChild(document.body, LoginView({ onLogin: mountApp }));
	} else {
		mountApp();
	}
})();
