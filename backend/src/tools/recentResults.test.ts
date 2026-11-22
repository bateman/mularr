import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecentResults } from './recentResults';

/** A clock the test moves by hand, and a run that counts its calls and settles when told to. */
function setup(ttlMs = 1000, maxEntries = 10, keep: (v: string[]) => boolean = (v) => v.length > 0) {
	let time = 0;
	const clock = { now: () => time, advance: (ms: number) => (time += ms) };
	const cache = new RecentResults<string[]>(ttlMs, maxEntries, keep, clock.now);
	let runs = 0;
	const run = (value: string[]) => () => {
		runs++;
		return Promise.resolve(value);
	};
	return { cache, clock, run, runs: () => runs };
}

test('a run in progress is shared by the callers asking for the same key', async () => {
	const { cache } = setup();
	let runs = 0;
	let finish!: (v: string[]) => void;
	const run = () => {
		runs++;
		return new Promise<string[]>((resolve) => (finish = resolve));
	};
	const first = cache.get('q', run);
	const second = cache.get('q', run);
	finish(['a']);
	assert.deepEqual(await first, { value: ['a'], startedAt: 0, reused: false });
	assert.deepEqual(await second, { value: ['a'], startedAt: 0, reused: true });
	assert.equal(runs, 1);
});

test('a kept value is handed out until ttlMs after the run settled', async () => {
	const { cache, clock, run, runs } = setup(1000);
	clock.advance(50);
	await cache.get('q', run(['a']));
	clock.advance(999);
	assert.deepEqual(await cache.get('q', run(['b'])), { value: ['a'], startedAt: 50, reused: true });
	clock.advance(1);
	assert.deepEqual(await cache.get('q', run(['b'])), { value: ['b'], startedAt: 1050, reused: false });
	assert.equal(runs(), 2);
});

test('a value keep rejects is not handed out again', async () => {
	const { cache, run, runs } = setup();
	await cache.get('q', run([]));
	assert.deepEqual((await cache.get('q', run(['a']))).value, ['a']);
	assert.equal(runs(), 2);
});

test('a failed run is not handed out again', async () => {
	const { cache, run, runs } = setup();
	await assert.rejects(
		cache.get('q', () => Promise.reject(new Error('down'))),
		/down/
	);
	await assert.rejects(
		cache.get('q', () => {
			throw new Error('sync');
		}),
		/sync/
	);
	assert.deepEqual((await cache.get('q', run(['a']))).value, ['a']);
	assert.equal(runs(), 1);
});

test('the callers sharing a run that fails all get the error', async () => {
	const { cache } = setup();
	let fail!: (e: Error) => void;
	const run = () => new Promise<string[]>((_, reject) => (fail = reject));
	const first = cache.get('q', run);
	const second = cache.get('q', run);
	fail(new Error('down'));
	await assert.rejects(first, /down/);
	await assert.rejects(second, /down/);
});

test('keys are kept apart, and the oldest is dropped past maxEntries', async () => {
	const { cache, run, runs } = setup(1000, 2);
	await cache.get('a', run(['a']));
	await cache.get('b', run(['b']));
	assert.deepEqual((await cache.get('b', run(['x']))).value, ['b']);
	await cache.get('c', run(['c']));
	assert.equal(runs(), 3);
	assert.deepEqual(await cache.get('a', run(['a2'])), { value: ['a2'], startedAt: 0, reused: false });
	assert.equal(runs(), 4);
});
