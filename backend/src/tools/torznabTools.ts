/** The Torznab search actions Mularr answers (`t=`), caps aside. */
export type TorznabSearchAction = 'search' | 'tvsearch' | 'movie' | 'music';

/**
 * The categories of a Torznab request (`cat`): a comma list ("5000,5030,5040"), or several `cat=` that Express hands
 * over as an array. Only numeric ids are kept, trimmed and without leading zeros ("05000" is written back as 5000,
 * which the caps know), in the order given and without repeats.
 */
export function torznabCategories(cat: unknown): string[] {
	const ids = [cat]
		.flat()
		.filter((c): c is string => typeof c === 'string')
		.flatMap((c) => c.split(','))
		.map((c) => c.trim())
		.filter((c) => /^\d+$/.test(c))
		.map((c) => String(Number(c)));
	return [...new Set(ids)];
}

/**
 * The action a search stands for. Sonarr, Radarr and Lidarr name their app with the action (tvsearch, movie, music),
 * but Prowlarr does not pass it on: it rewrites every request with no id parameter (an RSS sync, a text-only movie
 * search) to a plain `search`, whichever app it comes from. The categories still tell the apps apart, so a search
 * whose categories all belong to one family is read as that family's action: TV (5xxx), movies (2xxx) or audio (3xxx).
 * A search with no categories (Prowlarr's own Test and manual search) or with mixed ones stays a plain search.
 */
export function torznabAction(t: TorznabSearchAction, cat: unknown): TorznabSearchAction {
	if (t !== 'search') return t;
	const families = new Set(torznabCategories(cat).map((c) => Math.floor(Number(c) / 1000)));
	if (families.size !== 1) return 'search';
	const [family] = families;
	if (family === 5) return 'tvsearch';
	if (family === 2) return 'movie';
	if (family === 3) return 'music';
	return 'search';
}

/**
 * The categories written on every result of a request: the ones it asked for, each on its own, or the top category
 * of its action when it asked for none. One element per category matters to Prowlarr: it maps each category value
 * to its caps on its own, a value such as "5000,5030,5040" maps to nothing, and a result left with no category is
 * dropped from every search an app sends through it.
 */
export function resultCategories(action: TorznabSearchAction, cat: unknown): string[] {
	const requested = torznabCategories(cat);
	if (requested.length > 0) return requested;
	if (action === 'tvsearch') return ['5000'];
	if (action === 'music') return ['3000'];
	return ['2000'];
}
