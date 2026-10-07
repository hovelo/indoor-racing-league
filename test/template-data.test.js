// Public pages show places and points only: no times, raw or adjusted (decided 7 October 2026).
// The model still calculates adjusted times to decide places; this checks none of them
// reach template data. Runs against whatever data the build would use (sample-data/ locally).
const test = require('node:test');
const assert = require('node:assert/strict');

const TIME_KEY = /time|adjusted|raw/i;
// "m:ss" or "h:mm:ss", optionally signed (a gap such as "+0:16").
const TIME_VALUE = /^[+-]?\d+:\d{2}(:\d{2})?(\.\d+)?$/;

function loadStandings() {
	const log = console.log;
	const warn = console.warn;
	console.log = () => {};
	console.warn = () => {};
	try {
		return require('../src/_data/standings.js')();
	} finally {
		console.log = log;
		console.warn = warn;
	}
}

// Every key in a row, at any depth, must not look like a time, and no value may be time-shaped.
function assertNoTimes(row, where) {
	const walk = (value, path) => {
		if (Array.isArray(value)) {
			value.forEach((v, i) => walk(v, `${path}[${i}]`));
			return;
		}
		if (value && typeof value === 'object') {
			for (const [k, v] of Object.entries(value)) {
				assert.ok(!TIME_KEY.test(k), `${where}: time-shaped key "${k}" at ${path}`);
				walk(v, `${path}.${k}`);
			}
			return;
		}
		if (typeof value === 'string') {
			assert.ok(!TIME_VALUE.test(value), `${where}: time-shaped value "${value}" at ${path}`);
		}
	};
	walk(row, '');
}

test('template data has no time-shaped fields in results, standings or bonus segments', () => {
	const standings = loadStandings();
	let results = 0;
	let tableRows = 0;
	let segmentRows = 0;

	for (const e of standings.events) {
		for (const r of e.results) {
			assertNoTimes(r, `${e.id} result`);
			results++;
		}
		for (const r of e.unbenchmarked) {
			assertNoTimes(r, `${e.id} unbenchmarked`);
		}
		for (const s of e.segments) {
			assertNoTimes(s, `${e.id} segment ${s.key}`);
			segmentRows += s.results.length;
		}
	}
	for (const league of standings.leagues) {
		for (const row of league.table) {
			assertNoTimes(row, `${league.slug} table`);
			tableRows++;
		}
		// Events are also reachable through the league; same objects, but check anyway.
		for (const e of league.events) {
			e.results.forEach((r) => assertNoTimes(r, `${league.slug}/${e.id} result`));
			e.segments.forEach((s) => assertNoTimes(s, `${league.slug}/${e.id} segment ${s.key}`));
		}
	}

	// Guard against passing vacuously on empty data.
	assert.ok(results > 0, 'expected some event results');
	assert.ok(tableRows > 0, 'expected some standings rows');
	assert.ok(segmentRows > 0, 'expected some bonus segment results');
});

test('places still come through, with ties marked', () => {
	const standings = loadStandings();
	const ranked = standings.events.flatMap((e) => e.results).filter((r) => r.place !== undefined);
	assert.ok(ranked.length > 0);
	ranked.forEach((r) => {
		assert.equal(typeof r.place, 'number');
		assert.equal(typeof r.tied, 'boolean');
	});
});
