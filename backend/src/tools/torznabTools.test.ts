import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultCategories, torznabAction, torznabCategories } from './torznabTools';

test('the categories of a request are its numeric ids, one each', () => {
	assert.deepEqual(torznabCategories('5000,5030,5040'), ['5000', '5030', '5040']);
	assert.deepEqual(torznabCategories(' 2000 , 2010,'), ['2000', '2010']);
	assert.deepEqual(torznabCategories(['5000', '5070,5000']), ['5000', '5070']);
	assert.deepEqual(torznabCategories('2000,"><x>,abc'), ['2000']);
	assert.deepEqual(torznabCategories(''), []);
	assert.deepEqual(torznabCategories(undefined), []);
	assert.deepEqual(torznabCategories({ a: '1' }), []);
});

test('a plain search is read as the action of its categories', () => {
	// What Prowlarr sends for an app's RSS sync or text-only search
	assert.equal(torznabAction('search', '5000,5030,5040'), 'tvsearch');
	assert.equal(torznabAction('search', '5070'), 'tvsearch');
	assert.equal(torznabAction('search', '2000,2010,2020'), 'movie');
	assert.equal(torznabAction('search', '3000,3010,3030,3040'), 'music');
	// Prowlarr's Test and manual search, mixed or other categories
	assert.equal(torznabAction('search', undefined), 'search');
	assert.equal(torznabAction('search', ''), 'search');
	assert.equal(torznabAction('search', '2000,5000'), 'search');
	assert.equal(torznabAction('search', '7000'), 'search');
});

test('an action that names its app is kept whatever the categories', () => {
	assert.equal(torznabAction('tvsearch', '2000'), 'tvsearch');
	assert.equal(torznabAction('movie', '5000'), 'movie');
	assert.equal(torznabAction('music', undefined), 'music');
});

test('every result carries each requested category on its own', () => {
	assert.deepEqual(resultCategories('tvsearch', '5000,5030,5040'), ['5000', '5030', '5040']);
	assert.deepEqual(resultCategories('search', '2000'), ['2000']);
});

test('a request with no categories gets the top category of its action', () => {
	assert.deepEqual(resultCategories('tvsearch', undefined), ['5000']);
	assert.deepEqual(resultCategories('movie', ''), ['2000']);
	assert.deepEqual(resultCategories('music', undefined), ['3000']);
	assert.deepEqual(resultCategories('search', undefined), ['2000']);
});
