// Public pages show places, points and vs prediction (a percentage), but no times, raw or
// adjusted (decided 7 October 2026). The model still calculates adjusted times; this checks
// none of them reach template data.
//
// Two runs:
// - sample-data/, always, with checks that there's something to look at (so it can't pass
//   on empty data);
// - the build's own data (the private repo on Netlify), when it's there, with no such checks:
//   a real league can legitimately have no results yet, early in its qualifier window.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR_MODULE = require.resolve('../lib/data-dir');
const STANDINGS_MODULE = require.resolve('../src/_data/standings.js');

const TIME_KEY = /time|adjusted|raw/i;
// "m:ss" or "h:mm:ss", optionally signed (a gap such as "+0:16").
const TIME_VALUE = /^[+-]?\d+:\d{2}(:\d{2})?(\.\d+)?$/;

function quietly(fn) {
	const { log, warn } = console;
	console.log = () => {};
	console.warn = () => {};
	try {
		return fn();
	} finally {
		console.log = log;
		console.warn = warn;
	}
}

// Fresh copies of data-dir and standings, so each run picks its own data directory.
function freshStandings(dataDirOverride) {
	delete require.cache[STANDINGS_MODULE];
	delete require.cache[DATA_DIR_MODULE];
	if (dataDirOverride) {
		const real = require(DATA_DIR_MODULE);
		require.cache[DATA_DIR_MODULE].exports = { ...real, ...dataDirOverride };
	}
	const standings = require(STANDINGS_MODULE);
	delete require.cache[STANDINGS_MODULE];
	delete require.cache[DATA_DIR_MODULE];
	return standings;
}

function sampleStandings() {
	const build = freshStandings({ usingSample: true, dir: path.join(ROOT, 'sample-data') });
	// standings.js refuses sample data in a production build. This is a test, not a build.
	const context = process.env.CONTEXT;
	delete process.env.CONTEXT;
	try {
		return quietly(build);
	} finally {
		if (context !== undefined) {
			process.env.CONTEXT = context;
		}
	}
}

// Every key in a row, at any depth, must not look like a time, and no value may be time-shaped.
function assertNoTimes(row, where) {
	const walk = (value, at) => {
		if (Array.isArray(value)) {
			value.forEach((v, i) => walk(v, `${at}[${i}]`));
			return;
		}
		if (value && typeof value === 'object') {
			for (const [k, v] of Object.entries(value)) {
				assert.ok(!TIME_KEY.test(k), `${where}: time-shaped key "${k}" at ${at || 'top level'}`);
				walk(v, `${at}.${k}`);
			}
			return;
		}
		if (typeof value === 'string') {
			assert.ok(!TIME_VALUE.test(value), `${where}: time-shaped value "${value}" at ${at}`);
		}
	};
	walk(row, '');
}

// Checks results, unbenchmarked rows, bonus segments and the standings table; returns counts.
function checkNoTimes(standings) {
	const counts = { results: 0, tableRows: 0, segmentRows: 0 };
	const checkEvent = (e, prefix) => {
		for (const r of e.results) {
			assertNoTimes(r, `${prefix}${e.id} result`);
			counts.results++;
		}
		for (const r of e.unbenchmarked) {
			assertNoTimes(r, `${prefix}${e.id} unbenchmarked`);
		}
		for (const s of e.segments) {
			assertNoTimes(s, `${prefix}${e.id} segment ${s.key}`);
			counts.segmentRows += s.results.length;
		}
	};
	standings.events.forEach((e) => checkEvent(e, ''));
	for (const league of standings.leagues) {
		for (const row of league.table) {
			assertNoTimes(row, `${league.slug} table`);
			counts.tableRows++;
		}
	}
	return counts;
}

test('sample data: no time-shaped fields in results, standings or bonus segments', () => {
	const counts = checkNoTimes(sampleStandings());
	assert.ok(counts.results > 0, 'expected some event results in sample-data');
	assert.ok(counts.tableRows > 0, 'expected some standings rows in sample-data');
	assert.ok(counts.segmentRows > 0, 'expected some bonus segment results in sample-data');
});

test('sample data: places still come through, with ties marked', () => {
	const standings = sampleStandings();
	const ranked = standings.events.flatMap((e) => e.results).filter((r) => r.place !== undefined);
	assert.ok(ranked.length > 0);
	ranked.forEach((r) => {
		assert.equal(typeof r.place, 'number');
		assert.equal(typeof r.tied, 'boolean');
	});
});

test('sample data: ranked results and handicapped segment rows carry vs prediction, as a percentage', () => {
	const standings = sampleStandings();
	const VS = /^(\u2212|\+)?\d+\.\d%$/;
	const ranked = standings.events.flatMap((e) => e.results).filter((r) => r.place !== undefined);
	ranked.forEach((r) => {
		assert.match(r.vsDisplay, VS);
		assert.equal(typeof r.vsPrediction, 'number');
	});
	const segRows = standings.events.flatMap((e) => e.segments).filter((s) => s.mode === 'handicap').flatMap((s) => s.results);
	assert.ok(segRows.length > 0, 'expected handicapped segment rows in sample-data');
	segRows.forEach((r) => assert.match(r.vsDisplay, VS));
	// Qualifier rows have no prediction.
	standings.events.filter((e) => e.type === 'qualifier').flatMap((e) => e.results).forEach((r) => assert.equal(r.vsDisplay, undefined));
});

test('build data: no time-shaped fields (may have no results yet)', (t) => {
	delete require.cache[DATA_DIR_MODULE];
	const { usingSample } = require(DATA_DIR_MODULE);
	delete require.cache[DATA_DIR_MODULE];
	if (usingSample) {
		t.skip('no private data checked out; covered by the sample-data test');
		return;
	}
	checkNoTimes(quietly(freshStandings()));
});
