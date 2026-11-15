import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileKind, filterByFileKind, isVideoFileName, wantedFilesFor } from './releaseNameTools';

const base = 'La Cosa (1982) (The Thing) (BDRip - 1080p x264 - ITA DTS 5.1 ENG AAC 5.1)';
const names = (results: { name: string }[]) => results.map((r) => r.name);

test('classifies files by extension', () => {
	assert.equal(fileKind(`${base}.mkv`), 'video');
	assert.equal(fileKind('Album - 01 Track.FLAC'), 'audio');
	assert.equal(fileKind('Album.part.r01'), 'archive');
	for (const ext of ['nfo', 'jpg', 'srt', 'mks', 'ac3', 'dts', 'sfv', 'exe']) assert.equal(fileKind(`${base}.${ext}`), 'junk', ext);
	assert.equal(fileKind(`${base}-fanart.jpg`), 'junk');
});

test('a name with no known extension has no kind', () => {
	for (const name of ['Movie.1995.1080p', 'Movie (1995) x264', 'Movie.HDTV']) assert.equal(fileKind(name), undefined, name);
	assert.equal(isVideoFileName('Movie.1995.1080p'), false);
	assert.equal(isVideoFileName('Movie.1995.1080p.MKV'), true);
});

test('a video search keeps videos, archives and names with no extension', () => {
	const results = ['a.mkv', 'a.nfo', 'a-poster.jpg', 'a.srt', 'a.mp3', 'a.rar', 'a.1080p'].map((name) => ({ name }));
	assert.deepEqual(names(filterByFileKind(results, 'video')), ['a.mkv', 'a.rar', 'a.1080p']);
});

test('an audio search keeps audio, archives and names with no extension', () => {
	const results = ['a.flac', 'a.mp3', 'a.cue', 'a.jpg', 'a.mkv', 'a.zip', 'Artist - Album'].map((name) => ({ name }));
	assert.deepEqual(names(filterByFileKind(results, 'audio')), ['a.flac', 'a.mp3', 'a.zip', 'Artist - Album']);
});

test('a search for anything drops junk only', () => {
	const results = ['a.mkv', 'a.flac', 'a.rar', 'a.pdf', 'a.nfo', 'a.jpg', 'a.exe'].map((name) => ({ name }));
	assert.deepEqual(names(filterByFileKind(results, 'any')), ['a.mkv', 'a.flac', 'a.rar', 'a.pdf']);
});

test('the Torznab action and categories tell what files a search wants', () => {
	assert.equal(wantedFilesFor('movie', undefined), 'video');
	assert.equal(wantedFilesFor('tvsearch', '5000,5040'), 'video');
	assert.equal(wantedFilesFor('music', '3000'), 'audio');
	// The action wins over the categories for everything but a plain search
	assert.equal(wantedFilesFor('tvsearch', '3000'), 'video');
	assert.equal(wantedFilesFor('music', '5000'), 'audio');
	assert.equal(wantedFilesFor('search', undefined), 'any');
	assert.equal(wantedFilesFor('search', '5000,5070'), 'video');
	assert.equal(wantedFilesFor('search', '2000'), 'video');
	assert.equal(wantedFilesFor('search', '3000,3040'), 'audio');
	assert.equal(wantedFilesFor('search', '2000,3000'), 'any');
	assert.equal(wantedFilesFor('search', '7000'), 'any');
	assert.equal(wantedFilesFor('search', ''), 'any');
	assert.equal(wantedFilesFor('search', ['5000', '5070']), 'video');
	assert.equal(wantedFilesFor('search', '5000,'), 'video');
});
