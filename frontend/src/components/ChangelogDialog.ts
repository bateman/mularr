import { component, inject, signal, effect, refBindCheckbox } from 'chispa';
import { ChangelogService } from '../services/ChangelogService';
import { type ChangelogEntryType, type ChangelogVersion } from '../changelog';
import { StarBanner } from './StarBanner';
import tpl from './ChangelogDialog.html';
import './ChangelogDialog.css';

export interface ChangelogDialogProps {
	versions: ChangelogVersion[];
	onClose: () => void;
}

const TYPE_LABELS: Record<ChangelogEntryType, string> = {
	feature: 'New',
	improvement: 'Improved',
	fix: 'Fixed',
};

export const ChangelogDialog = component<ChangelogDialogProps>(({ versions, onClose }) => {
	const changelogService = inject(ChangelogService);

	// Checkbox is the inverse of the preference; persisted immediately like the local prefs in Settings.
	const dontShowAgain = signal(!changelogService.getShowOnStartup());
	effect(() => {
		changelogService.setShowOnStartup(!dontShowAgain.get());
	});

	// "1.0.0-dev" belongs to the "1.0.0" group: flag it as still in development.
	const baseAppVersion = changelogService.appVersion.replace(/-.*$/, '');
	const versionLabel = (v: ChangelogVersion) => {
		const inDevelopment = changelogService.isUnstable && v.version === baseAppVersion;
		return `v${v.version}${inDevelopment ? ' (in development)' : ''}`;
	};

	return tpl.fragment({
		unstableBanner: {
			style: { display: changelogService.isUnstable ? '' : 'none' },
		},
		unstableVersion: { inner: `v${changelogService.appVersion}` },
		versionsList: {
			inner: versions.map((v) =>
				tpl.versionBlock({
					nodes: {
						versionName: { inner: versionLabel(v) },
						versionDate: { inner: v.date || '' },
						entriesList: {
							inner: v.entries.map((e) =>
								tpl.entryItem({
									nodes: {
										entryType: { inner: TYPE_LABELS[e.type], addClass: `type-${e.type}` },
										entryText: { inner: e.text },
									},
								})
							),
						},
					},
				})
			),
		},
		starBanner: { inner: StarBanner() },
		dontShowAgain: { _ref: refBindCheckbox(dontShowAgain) },
		btnClose: { onclick: onClose },
	});
});
