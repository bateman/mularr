import type { IndexerFeedMediaType } from '../types/IndexerFeedTypes';
import { torznabCategories } from './torznabTools';

/**
 * Helpers to match eD2k release names against what Sonarr/Radarr/Lidarr ask for. Shared by the Torznab
 * controller (file kind of every search, episode searches), the *arr wanted sync (see services/arrsync) and the
 * provider feeds (see services/indexerfeed).
 */

// 0* absorbs zero-padding (S01E07 == S1E7); \s? allows a split SxxEyy.
const EPISODE_PATTERNS = [/\bs0*(\d+)\s?e0*(\d+)\b/i, /\b0*(\d+)x0*(\d+)\b/i];

/** Normalizes dot/underscore separators so word boundaries hold in release names. */
function normalizeSeparators(name: string): string {
	return name.replace(/[._]/g, ' ');
}

/** True when the release name carries the given season/episode (S01E07, S1E7, 1x07...). */
export function releaseMatchesEpisode(name: string, season: number, ep: number): boolean {
	const normalized = normalizeSeparators(name);
	for (const pattern of EPISODE_PATTERNS) {
		const m = normalized.match(pattern);
		if (m && parseInt(m[1], 10) === season && parseInt(m[2], 10) === ep) {
			return true;
		}
	}
	return false;
}

export function filterByEpisode<T extends { name: string }>(results: T[], season: number, ep: number): T[] {
	return results.filter((r) => releaseMatchesEpisode(r.name, season, ep));
}

/**
 * Feed category of a release nobody classified: an episode marker (S01E07, 1x07) makes it TV, anything else
 * is offered as a movie. The *arr parse the name themselves, so a wrong guess only means the release is
 * served to the app that will ignore it.
 */
export function guessMediaType(name: string): IndexerFeedMediaType {
	const normalized = normalizeSeparators(name);
	return EPISODE_PATTERNS.some((pattern) => pattern.test(normalized)) ? 'tv' : 'movie';
}

const VIDEO_EXTENSIONS = new Set(['mkv', 'mp4', 'avi', 'm4v', 'mov', 'wmv', 'ts', 'm2ts', 'mpg', 'mpeg', 'webm', 'flv', 'ogm', 'divx', 'iso']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'wma', 'wav', 'ape', 'wv', 'aiff', 'aif', 'mka', 'dsf', 'dff']);
const ARCHIVE_EXTENSIONS = new Set(['rar', 'zip', '7z', 'tar', 'gz', 'bz2', 'xz']);
/**
 * Files that are never what anyone searches for: the sidecars shared next to a video (artwork, .nfo, subtitles,
 * separate audio tracks, checksums), playlists, and executables (the classic fake "movie.exe" on eD2k). Their names carry the release
 * title, so they match a search as well as the video itself.
 */
const JUNK_EXTENSIONS = new Set([
	...['nfo', 'txt', 'log', 'url', 'lnk', 'ini', 'db'],
	...['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tbn', 'ico'],
	...['srt', 'sub', 'idx', 'ass', 'ssa', 'vtt', 'smi', 'sup', 'mks'],
	...['ac3', 'eac3', 'dts', 'dtshd'],
	...['sfv', 'md5', 'sha1', 'sha256', 'par2', 'torrent'],
	...['m3u', 'm3u8', 'pls', 'cue'],
	...['exe', 'com', 'bat', 'cmd', 'scr', 'pif', 'vbs', 'msi'],
]);

export type FileKind = 'video' | 'audio' | 'archive' | 'junk';

/**
 * What the file name's extension says the file is, or undefined when it has no extension this module knows:
 * release names such as "Movie.1995.1080p" end in a dot-separated token that is not an extension at all.
 */
export function fileKind(name: string): FileKind | undefined {
	if (!name.includes('.')) return undefined;
	const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
	if (VIDEO_EXTENSIONS.has(ext)) return 'video';
	if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
	if (ARCHIVE_EXTENSIONS.has(ext) || /^r\d{2}$/.test(ext)) return 'archive';
	if (JUNK_EXTENSIONS.has(ext)) return 'junk';
	return undefined;
}

/**
 * True when the file name has a video container extension: what Sonarr/Radarr import as is. Stricter than
 * filterByFileKind(…, 'video'), which also keeps archives and names with no known extension.
 */
export function isVideoFileName(name: string): boolean {
	return fileKind(name) === 'video';
}

/** What a search asks for: video for Sonarr/Radarr, audio for Lidarr, anything but junk when unknown (see wantedFilesFor). */
export type WantedFiles = 'video' | 'audio' | 'any';

/**
 * What a Torznab request wants (see WantedFiles): video for a movie or TV search, audio for a music search. A plain
 * search names no app, but Sonarr sends some of its own as one (anime absolute numbers, specials), so it is told by
 * its categories (`cat`, e.g. "5000,5070"): all of them movie (2xxx) or TV (5xxx) is video, all audio (3xxx) is audio,
 * anything else (none, a mix, books...) is any.
 */
export function wantedFilesFor(t: unknown, cat: unknown): WantedFiles {
	if (t === 'music') return 'audio';
	if (t !== 'search') return 'video';
	const cats = torznabCategories(cat).map((c) => Math.floor(Number(c) / 1000));
	if (cats.length === 0) return 'any';
	if (cats.every((c) => c === 2 || c === 5)) return 'video';
	if (cats.every((c) => c === 3)) return 'audio';
	return 'any';
}

/**
 * Keeps the results whose file can be what the search wants (see WantedFiles). A name with no known extension is
 * kept: nothing says it is the wrong kind. Archives are kept by every search: albums on eD2k are often shared only
 * as one archive, and an unpacker next to the *arr (e.g. Unpackerr) makes them importable.
 */
export function filterByFileKind<T extends { name: string }>(results: T[], wanted: WantedFiles): T[] {
	return results.filter((r) => {
		const kind = fileKind(r.name);
		if (kind === undefined || kind === 'archive') return true;
		return wanted === 'any' ? kind !== 'junk' : kind === wanted;
	});
}

/** True when the release name carries the given year as a standalone token (e.g. "Movie (1995)", "Movie.1995.1080p"). */
export function releaseMatchesYear(name: string, year: number): boolean {
	return new RegExp(`(^|[^0-9])${year}([^0-9]|$)`).test(normalizeSeparators(name));
}

/**
 * Releases often drop apostrophes (e.g. "Widow's Bay" -> "Widows Bay"), so the query is widened to
 * match both spellings.
 */
export function expandApostrophes(query: string): string {
	const stripped = query.replace(/['’]/g, '');
	return stripped === query || stripped.trim() === '' ? query : `${query} OR ${stripped}`;
}

// What separates the tokens of a file name: "El.principe..." and "El_principe..." read the same.
const SEPARATORS = ' \t._-';
const OPENERS = '([';
const CLOSERS = ')]';
// Punctuation an uploader may glue a year with: "(Julius Onah,2025)".
const GLUE = ',;:';

/**
 * The year of a release name, as Radarr's Parser.ReportMovieTitleRegex reads it in its "Normal movie
 * format" branch: (1(8|9)|20)\d{2} behind a [-_\W] that is not ")", "[" or "!", and before a (\W+|_|$).
 * 1080p, x264 and two years in a row (".2017.2160p") are not years, so hoistMovieYear never moves a
 * token Radarr would not have read as the year in the first place.
 */
const MOVIE_YEAR_RE = /(?<![^\W_)\[!])(?:1(?:8|9)|20)\d{2}(?!p|i|(?:1(?:8|9)|20)\d{2}|\]|\W(?:1(?:8|9)|20)\d{2})/i;

/**
 * An episode marker ("S01E22", "1x04", "23x1156"): the one anchor the *arr match a series by, and no anchor
 * at all for a movie. Hispashare lists whole seasons as movies (all six chapters of "Furioso (Temporada 1)"
 * arrive as `movie`), so an episode name that reaches the movie feed keeps its shape: moving its year in
 * front of the title only offers Radarr a movie nobody has. Capturing 1920x1080 is not a risk: a resolution
 * has no separator before its first digits, so it never reads as an episode.
 */
const EPISODE_RE = /(?:^|[^\p{L}\p{N}])(?:s\d{1,2}[ ._-]?e\d{1,4}|\d{1,2}x\d{2,4})(?![\p{L}\p{N}])/iu;

function strip(value: string, characters: string, side: 'start' | 'end' | 'both'): string {
	const hits = (index: number) => characters.includes(value.charAt(index));
	let start = 0;
	let end = value.length;
	if (side !== 'end') while (start < end && hits(start)) start++;
	if (side !== 'start') while (end > start && hits(end - 1)) end--;
	return value.slice(start, end);
}

function occurrences(value: string, character: string): number {
	return character ? value.split(character).length - 1 : 0;
}

/**
 * Radarr's movie parser takes everything before the first year as the movie title, and its title group is
 * lazy: a file name that hides the year behind a parenthetical is read as a movie nobody has. Radarr still
 * finds the year, but the title comes out wrong and the release is rejected as Unknown Movie:
 *
 *   La.decision.de.Anne.(Nick.Cassavetes,2009).(Spanish.English.Subs).BDrip.1080p.x264-AC3.mkv
 *   before: title "La.decision.de.Anne.(Nick.Cassavetes"  year 2009
 *   after:  title "La.decision.de.Anne"                    year 2009
 *
 * Hispashare file names are typed by hand and carry all these shapes: the director next to the year
 * ("(Nick.Cassavetes,2009)"), a collection and the director in front of it ("(Clasicos Disney) (1990
 * George Scribner)"), or the original title and the director in two groups ("Titulo (Original) (Director,
 * 2009)"), of which only the first one separates the title from the year. The repair is a *move*: the year
 * goes right after the title and every other token
 * keeps its place, its brackets and its separators -- nothing is dropped, nothing is invented, and a
 * dot-separated name stays dot-separated.
 *
 * A name whose year already follows the title is returned untouched, so clean names ("Movie (1995)",
 * "Movie.1995.1080p"), names without a year ("Movie.avi") and episode names ("One Piece 23x1156") are all
 * published verbatim. The eD2k link is built elsewhere, so the file everybody downloads keeps its name.
 */
export function hoistMovieYear(name: string): string {
	// An episode is matched by its season/episode marker, never by a year (see EPISODE_RE)
	if (EPISODE_RE.test(name)) return name;
	const match = MOVIE_YEAR_RE.exec(name);
	if (!match) return name;
	const year = match[0];
	const before = name.slice(0, match.index);
	const after = name.slice(match.index + year.length);
	// `before` is the movie title, then whatever the uploader dragged in front of the year
	let body = strip(before, SEPARATORS, 'end');
	// A bracket right before the year is the year's *own* group ("... (1990)"), not junk: "(Clasicos
	// Disney) (1990 George Scribner)" hides the year behind the first group and brackets it with the second.
	const lastChar = body.charAt(body.length - 1);
	const yearBracket = OPENERS.includes(lastChar) ? lastChar : '';
	if (yearBracket) body = body.slice(0, -1);
	// The title ends at the *first* group the uploader opened: "(Original) (Director, 2009)" hides the year
	// behind two groups, and only the first one separates the title from both of them (the last one left the
	// original title glued to the movie title, which Radarr reads as a movie nobody has just the same).
	const openings = [body.indexOf('('), body.indexOf('[')].filter((index) => index >= 0);
	const opening = openings.length > 0 ? Math.min(...openings) : -1;
	// Nothing but separators (or the year's own bracket) before the year: Radarr already reads this right
	if (opening < 0) return name;
	const title = strip(body.slice(0, opening), SEPARATORS, 'end');
	if (!title) return name;
	// Everything the uploader typed between the title and the year
	const junkStart = body.charAt(opening);
	let junk = strip(body.slice(opening), SEPARATORS + GLUE, 'end');
	// The separator the uploader used between the title and the junk is the one to join the head with
	const gap = SEPARATORS.includes(before.charAt(title.length)) ? before.charAt(title.length) : ' ';
	// The character behind the year is the separator that joins it with the rest of the name, and it is the
	// uploader's too: dropping it left the dot of the extension out of "... (Tousou) (2015).mkv" and out of
	// "... DVD-Rip.1964.mp4", which is a name with no file extension left in it.
	let restGap = gap;
	let rest = after;
	if (SEPARATORS.includes(rest.charAt(0))) {
		restGap = rest.charAt(0);
		rest = strip(rest, SEPARATORS, 'start');
	}
	if (yearBracket) {
		// The year lived in a group of its own. When the group closes right behind it ("(2026)") both brackets
		// are the year's and go with it: keeping the opening one would leave an empty "()" in the name
		// ("Furioso (Temporada 1) (2026) Furioso.1x05.mkv"). When it does not close there ("(1990 George
		// Scribner)"), the group carries junk that keeps its place behind the year and the bracket goes with it.
		const closer = CLOSERS.charAt(OPENERS.indexOf(yearBracket));
		if (closer && rest.charAt(0) === closer) {
			rest = rest.slice(1);
			if (SEPARATORS.includes(rest.charAt(0))) restGap = rest.charAt(0);
			rest = strip(rest, SEPARATORS, 'start');
		} else rest = yearBracket + rest;
	} else {
		// The year lived inside a group that opened *before* it ("(Julius Onah,2025)"): junk owns that
		// bracket now, so the one that closed the group after the year moves over with it
		const closer = CLOSERS.charAt(OPENERS.indexOf(junkStart));
		if (closer && occurrences(junk, junkStart) > occurrences(junk, closer)) {
			junk += closer;
			if (rest.charAt(0) === closer) {
				rest = rest.slice(1);
				if (SEPARATORS.includes(rest.charAt(0))) restGap = rest.charAt(0);
				rest = strip(rest, SEPARATORS, 'start');
			}
		}
	}
	const parts = [title, `(${year})`];
	if (strip(junk, SEPARATORS + GLUE, 'both')) parts.push(junk);
	let published = parts.join(gap);
	if (/[\p{L}\p{N}]/u.test(rest)) published += restGap + rest;
	// "( George Scribner)" -> "(George Scribner)", in either separator style
	return published.replace(/([([])[._\s]+/g, '$1');
}

/**
 * hoistMovieYear for the file names that carry no year at all: Radarr has nothing to anchor the match on and
 * the release is rejected as Unknown Movie, whatever the title looks like:
 *
 *   La.decision.de.Anne.(Spanish.English).HDrip.XviD-AC3.by.Triki.(proteinicos.es).avi
 *   before: no year to find          after: "La decision de Anne (2009) ..."  title and year 2009
 *
 * The title and the year come from the provider's catalogue, never from the name, and go in front of it:
 * Radarr reads the catalogue title as the movie and the year next to it. Nothing has to be lined up with the
 * uploader's name, because the *arr are also told the IMDb id of the work when the provider knows it (see
 * IndexerController.renderRss) and match the release by id before they look at the name at all.
 *
 * Names that already carry a year are returned untouched: hoistMovieYear owns those, and a year the uploader
 * typed beats the one on the catalogue page (a remake, a re-release). So are episode names, which the *arr
 * match by their season/episode marker and never by a year (see EPISODE_RE).
 */
export function withMovieYear(name: string, year?: number, title?: string): string {
	if (!year || year <= 0 || !title || MOVIE_YEAR_RE.test(name) || EPISODE_RE.test(name)) return name;
	return `${title} (${year}) ${name}`;
}
