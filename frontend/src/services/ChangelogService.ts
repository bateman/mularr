import { inject } from 'chispa';
import { LocalPrefsService } from './LocalPrefsService';
import { DialogService } from './DialogService';
import { CHANGELOG, type ChangelogVersion } from '../changelog';
import { ChangelogDialog } from '../components/ChangelogDialog';

const LAST_SEEN_ID_KEY = 'changelog.lastSeenId';
const SHOW_ON_STARTUP_KEY = 'changelog.showOnStartup';

/** Any semver pre-release suffix (-dev, -rc1, -beta.2, ...) is considered unstable. */
export function isUnstableVersion(version: string): boolean {
	return /-[0-9a-z]/i.test(version);
}

/**
 * "What's new" flow: decides which changelog entries have not been notified
 * yet (localStorage marker with the highest entry id shown), opens the dialog
 * and owns the "show on startup" preference that the dialog and Settings edit.
 */
export class ChangelogService {
	private readonly prefs = inject(LocalPrefsService);
	private readonly dialogService = inject(DialogService);

	public readonly appVersion: string = __APP_MANIFEST__.version;
	public readonly isUnstable = isUnstableVersion(this.appVersion);

	public getShowOnStartup(): boolean {
		return this.prefs.get(SHOW_ON_STARTUP_KEY, true);
	}

	public setShowOnStartup(value: boolean): void {
		this.prefs.set(SHOW_ON_STARTUP_KEY, value);
	}

	/** Versions reduced to the entries newer than the last notified one (empty when up to date). */
	public getUnseenVersions(): ChangelogVersion[] {
		const lastSeenId = this.prefs.get(LAST_SEEN_ID_KEY, 0);
		return CHANGELOG.map((v) => ({ ...v, entries: v.entries.filter((e) => e.id > lastSeenId) })).filter((v) => v.entries.length > 0);
	}

	public markAllSeen(): void {
		const latestId = Math.max(0, ...CHANGELOG.flatMap((v) => v.entries.map((e) => e.id)));
		this.prefs.set(LAST_SEEN_ID_KEY, latestId);
	}

	/** Called once when the app mounts: opens the dialog only if there are unnotified changes. */
	public showOnStartupIfNeeded(): void {
		if (!this.getShowOnStartup()) return;
		const unseen = this.getUnseenVersions();
		if (unseen.length === 0) return;
		this.open(unseen, "What's new");
	}

	/** Full changelog, every version (sidebar version click). */
	public openFull(): void {
		this.open(CHANGELOG, 'Changelog');
	}

	private open(versions: ChangelogVersion[], title: string): void {
		this.markAllSeen();
		this.dialogService.open({
			title,
			width: '640px',
			render: (close) => ChangelogDialog({ versions, onClose: close }),
		});
	}
}
