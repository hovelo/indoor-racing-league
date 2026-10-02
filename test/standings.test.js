// Worked example from 02-handicap-model.md as a fixture. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStandings, formatTime } = require('../lib/model');

const members = [
	{ id: 'a', display: 'Rider A.' },
	{ id: 'b', display: 'Rider B.' },
	{ id: 'c', display: 'Rider C.' },
];

const routes = [
	{
		id: 'hilly',
		name: 'Hilly Route',
		world: 'Watopia',
		segments: { lap: {}, kom: {}, sprint: {} },
	},
];

const league = { id: 'test', slug: 'test', qualifier: 'q', members: ['a', 'b', 'c'] };

const q = (member, lap, kom, sprint) => [
	{ member, segment: 'lap', time: lap, date: '2026-10-07' },
	{ member, segment: 'kom', time: kom, date: '2026-10-07' },
	{ member, segment: 'sprint', time: sprint, date: '2026-10-07' },
];

const events = [
	{
		id: 'q',
		league: 'test',
		type: 'qualifier',
		route: 'hilly',
		window: { from: '2026-10-05', to: '2026-10-18' },
		results: [...q('a', 900, 150, 30), ...q('b', 960, 170, 32), ...q('c', 1080, 200, 36)],
	},
	{
		id: 'e1',
		league: 'test',
		type: 'event',
		route: 'hilly',
		route_type: 'rolling',
		score_segment: 'lap',
		window: { from: '2026-10-19', to: '2026-11-01' },
		results: [
			{ member: 'a', segment: 'lap', time: '25:00', date: '2026-10-20' },
			{ member: 'b', segment: 'lap', time: '27:20', date: '2026-10-20' },
			{ member: 'c', segment: 'lap', time: '30:30', date: '2026-10-20' },
		],
	},
];

const near = (actual, expected, dp = 3) =>
	assert.equal(Number(actual.toFixed(dp)), expected, `${actual} ≈ ${expected}`);

test('worked example', () => {
	const out = computeStandings(league, members, routes, events);

	assert.deepEqual(
		{ climb: out.medians.climb, sprint: out.medians.sprint, flat: out.medians.flat },
		{ climb: 170, sprint: 32, flat: 758 }
	);

	const ev = out.events.find((e) => e.id === 'e1');
	const byId = Object.fromEntries(ev.results.map((r) => [r.member, r]));

	near(byId.a._blended, 0.9238, 4);
	near(byId.c._blended, 1.1378, 4);
	assert.equal(byId.c.place, 1);
	assert.equal(byId.a.place, 2);
	assert.equal(byId.b.place, 3);
	assert.equal(formatTime(byId.a.adjusted), '27:04');
	assert.equal(formatTime(byId.c.adjusted), '26:48');

	// Points: 15/14/13 + 2 participation
	assert.equal(byId.c.points, 17);
	assert.equal(byId.a.points, 16);
	assert.equal(byId.b.points, 15);

	// Benchmark updates
	near(out.benchmarks.a.climb, 0.8814, 4);
	near(out.benchmarks.a.flat, 0.9486, 4);
	near(out.benchmarks.a.sprint, 0.9369, 4);
	near(out.benchmarks.c.climb, 1.1741, 4);
	near(out.benchmarks.c.flat, 1.1106, 4);
	near(out.benchmarks.c.sprint, 1.1237, 4);

	// Qualifier: A fastest everywhere -> 2 + 9; B -> 2 + 6; C -> 2 + 3
	const qual = Object.fromEntries(out.events[0].results.map((r) => [r.member, r.points]));
	assert.deepEqual(qual, { a: 11, b: 8, c: 5 });

	const table = Object.fromEntries(out.table.map((r) => [r.member, r.total]));
	assert.deepEqual(table, { a: 27, b: 23, c: 22 });
});

test('window and duplicates', () => {
	const ev = structuredClone(events);
	ev[1].results.push(
		{ member: 'a', segment: 'lap', time: '24:50', date: '2026-10-27' }, // faster, kept
		{ member: 'b', segment: 'lap', time: '20:00', date: '2026-11-05' } // outside window
	);
	const out = computeStandings(league, members, routes, ev);
	const a = out.events[1].results.find((r) => r.member === 'a');
	assert.equal(a._raw, 1490);
	assert.ok(out.warnings.some((w) => w.includes('outside window')));
	assert.ok(out.warnings.some((w) => w.includes('duplicate')));
});

test('unbenchmarked riders get participation points only', () => {
	const m = [...members, { id: 'd', display: 'Rider D.' }];
	const l = { ...league, members: ['a', 'b', 'c', 'd'] };
	const ev = structuredClone(events);
	ev[1].results.push({ member: 'd', segment: 'lap', time: '26:00', date: '2026-10-21' });
	const out = computeStandings(l, m, routes, ev);
	const e1 = out.events[1];
	assert.equal(e1.results.length, 3);
	assert.deepEqual(e1.unbenchmarked.map((r) => [r.member, r.points]), [['d', 2]]);
	assert.equal(out.table.find((r) => r.member === 'd').total, 2);
	// Ranked riders unaffected
	assert.equal(e1.results.find((r) => r.member === 'c').points, 17);
});

test('qualifier bonus is per climb and sprint segment', () => {
	const r = [{ id: 'f8', segments: { lap: {}, kom: {}, kom_rev: { type: 'climb' }, sprint: {}, sprint_rev: { type: 'sprint' } } }];
	const row = (member, lap, kom, komRev, sprint, sprintRev) => [
		{ member, segment: 'lap', time: lap, date: '2026-10-07' },
		{ member, segment: 'kom', time: kom, date: '2026-10-07' },
		{ member, segment: 'kom_rev', time: komRev, date: '2026-10-07' },
		{ member, segment: 'sprint', time: sprint, date: '2026-10-07' },
		{ member, segment: 'sprint_rev', time: sprintRev, date: '2026-10-07' },
	];
	const ev = [{
		id: 'q', league: 'test', type: 'qualifier', route: 'f8',
		window: { from: '2026-10-05', to: '2026-10-18' },
		// A wins lap, kom, sprint; C wins kom_rev and sprint_rev
		results: [...row('a', 2800, 150, 400, 30, 20), ...row('b', 2900, 160, 390, 32, 19), ...row('c', 3000, 170, 380, 34, 18)],
	}];
	const out = computeStandings(league, members, r, ev);
	const bonus = Object.fromEntries(out.events[0].results.map((x) => [x.member, x.bonus]));
	// A: 3+3+1+3+1 = 11; B: 2+2+2+2+2 = 10; C: 1+1+3+1+3 = 9
	assert.deepEqual(bonus, { a: 11, b: 10, c: 9 });
});
