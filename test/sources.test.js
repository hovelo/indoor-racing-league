// Results sources: gathering rows from several sources and merging them before the model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { gatherResults, mergeRows } = require('../lib/sources');
const yamlSource = require('../lib/sources/yaml');
const { computeStandings } = require('../lib/model');

const source = (name, rows) => ({ name, load: () => rows });
const empty = source('submissions', []);

const event = {
	id: 'e1',
	league: 'test',
	type: 'event',
	route: 'hilly',
	route_type: 'rolling',
	score_segment: 'lap',
	window: { from: '2026-10-19', to: '2026-11-01' },
	results: [
		{ member: 'a', segment: 'lap', time: '25:00', date: '2026-10-20' },
		{ member: 'b', segment: 'lap', time: '27:20', date: '2026-10-21' },
	],
};

test('yaml rows default to source: screenshot and keep an explicit source', async () => {
	const ev = { ...event, results: [...event.results, { member: 'c', segment: 'lap', time: '30:30', date: '2026-10-22', source: 'manual' }] };
	const [out] = await gatherResults([ev], [yamlSource]);
	assert.deepEqual(out.results.map((r) => r.source), ['screenshot', 'screenshot', 'manual']);
	assert.ok(out.results.every((r) => !('event' in r)), 'routing field is stripped');
});

test('merging across sources keeps the fastest row and warns', async () => {
	const warnings = [];
	const fit = source('submissions', [
		{ event: 'e1', member: 'a', segment: 'lap', time: '24:58', date: '2026-10-27', source: 'fit' }, // faster
		{ event: 'e1', member: 'b', segment: 'lap', time: '27:30', date: '2026-10-28', source: 'fit' }, // slower
		{ event: 'e1', member: 'c', segment: 'lap', time: '30:30', date: '2026-10-22', source: 'fit' }, // new
	]);
	const [out] = await gatherResults([event], [yamlSource, fit], {}, (w) => warnings.push(w));
	const byMember = Object.fromEntries(out.results.map((r) => [r.member, r]));
	assert.equal(out.results.length, 3);
	assert.deepEqual([byMember.a.time, byMember.a.source], ['24:58', 'fit']);
	assert.deepEqual([byMember.b.time, byMember.b.source], ['27:20', 'screenshot']);
	assert.equal(byMember.c.source, 'fit');
	assert.equal(warnings.length, 2);
	assert.match(warnings[0], /^\[test\] e1: a\/lap — duplicate row \(screenshot and fit\), keeping fastest \(fit 24:58\)/);
	assert.match(warnings[1], /b\/lap — duplicate row \(screenshot and fit\), keeping fastest \(screenshot 27:20\)/);
});

test('merging never lets an out-of-window or excluded row hide a valid one', () => {
	const rows = [
		{ member: 'a', segment: 'lap', time: '20:00', date: '2026-10-18', source: 'fit' }, // before window
		{ member: 'a', segment: 'lap', time: '21:00', date: '2026-10-20', source: 'fit', excluded: true },
		{ member: 'a', segment: 'lap', time: '25:00', date: '2026-10-20', source: 'screenshot' },
	];
	const out = mergeRows(event, rows);
	assert.equal(out.length, 3, 'all kept for the model to skip or score');
});

test('late qualifier rows only merge on the same date', () => {
	const qualifier = { id: 'q', type: 'qualifier', window: { from: '2026-10-05', to: '2026-10-18' } };
	const rows = [
		{ member: 'd', segment: 'lap', time: '17:00', date: '2026-10-21', source: 'screenshot' },
		{ member: 'd', segment: 'lap', time: '16:00', date: '2026-10-25', source: 'fit' },
		{ member: 'd', segment: 'lap', time: '16:30', date: '2026-10-21', source: 'fit' },
	];
	const out = mergeRows(qualifier, rows);
	assert.deepEqual(out.map((r) => [r.date, r.time]), [['2026-10-21', '16:30'], ['2026-10-25', '16:00']]);
});

test('rows for unknown events or with an unknown source are dropped with a warning', async () => {
	const warnings = [];
	const bad = source('submissions', [
		{ event: 'nope', member: 'a', segment: 'lap', time: '1:00', date: '2026-10-20', source: 'fit' },
		{ event: 'e1', member: 'a', segment: 'lap', time: '1:00', date: '2026-10-20', source: 'api' },
	]);
	const [out] = await gatherResults([event], [yamlSource, bad], {}, (w) => warnings.push(w));
	assert.equal(out.results.length, 2);
	assert.equal(warnings.length, 2);
});

test('the merged fastest row is what the model scores', async () => {
	const fit = source('submissions', [{ event: 'e1', member: 'b', segment: 'lap', time: '26:00', date: '2026-10-27', source: 'fit' }]);
	const [merged] = await gatherResults([event], [yamlSource, fit]);
	assert.equal(merged.results.find((r) => r.member === 'b').time, '26:00');
});

// The sample league, scored with and without an empty submissions source: identical output.
test('an empty submissions source behaves exactly like today', async () => {
	const dir = path.join(__dirname, '..', 'sample-data');
	const load = (f) => yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
	const leagues = load('leagues.yml');
	const members = load('members.yml');
	const routes = load('routes.yml');
	const events = fs.readdirSync(path.join(dir, 'events')).map((f) => load(path.join('events', f)));

	const before = leagues.map((l) => computeStandings(l, members, routes, events, { today: '2026-10-07', debug: true }));
	const yamlOnly = await gatherResults(events, [yamlSource]);
	const withEmpty = await gatherResults(events, [yamlSource, empty]);
	assert.deepEqual(withEmpty, yamlOnly);
	const after = leagues.map((l) => computeStandings(l, members, routes, withEmpty, { today: '2026-10-07', debug: true }));
	assert.deepEqual(after, before);
});
