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

	// Qualifier bonus on the climb and sprint only (not the full route):
	// A fastest on both -> 2 + 6; B -> 2 + 4; C -> 2 + 2
	const qual = Object.fromEntries(out.events[0].results.map((r) => [r.member, r.points]));
	assert.deepEqual(qual, { a: 8, b: 6, c: 4 });

	const table = Object.fromEntries(out.table.map((r) => [r.member, r.total]));
	assert.deepEqual(table, { a: 24, b: 21, c: 21 });
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
	// Two KOMs and two sprints, no full-route bonus.
	// A: 3+1+3+1 = 8; B: 2+2+2+2 = 8; C: 1+3+1+3 = 8
	assert.deepEqual(bonus, { a: 8, b: 8, c: 8 });
	assert.deepEqual(out.events[0].segments.map((x) => x.key), ['kom', 'kom_rev', 'sprint', 'sprint_rev']);

	// An explicit list overrides the default, e.g. to put the full route back in.
	ev[0].bonus_segments = ['lap', 'kom'];
	const out2 = computeStandings(league, members, r, ev);
	const bonus2 = Object.fromEntries(out2.events[0].results.map((x) => [x.member, x.bonus]));
	assert.deepEqual(bonus2, { a: 6, b: 4, c: 2 });
});

test('normal events score their designated segments', () => {
	const r = [{
		id: 'hilly',
		segments: {
			lap: { name: 'Hilly Loop' },
			kom: { name: 'Hilly KOM', strava_segment_id: 12109030 },
			sprint: { name: 'JWB Sprint' },
		},
	}];
	const m = [...members, { id: 'd', display: 'Rider D.' }];
	const l = { ...league, members: ['a', 'b', 'c', 'd'] };
	const ev = structuredClone(events);
	ev[1].bonus_segments = ['kom', 'nope'];
	ev[1].results.push(
		{ member: 'a', segment: 'kom', time: '2:40', date: '2026-10-20' },
		{ member: 'b', segment: 'kom', time: '2:30', date: '2026-10-20' },
		{ member: 'c', segment: 'kom', time: '2:30', date: '2026-10-20' }, // ties B
		{ member: 'c', segment: 'sprint', time: '0:20', date: '2026-10-20' }, // not designated
		{ member: 'd', segment: 'lap', time: '26:00', date: '2026-10-21' }, // unbenchmarked
		{ member: 'd', segment: 'kom', time: '2:35', date: '2026-10-21' }
	);
	const out = computeStandings(l, m, r, ev);
	const e1 = out.events[1];

	assert.equal(e1.segments.length, 1);
	const kom = e1.segments[0];
	assert.equal(kom.name, 'Hilly KOM');
	assert.equal(kom.url, 'https://www.strava.com/segments/12109030');
	// B and C tie for 1st (3 each), D 3rd place (1), A 4th (0)
	assert.deepEqual(kom.results.map((x) => [x.member, x.place, x.points]), [
		['b', 1, 3], ['c', 1, 3], ['d', 3, 1], ['a', 4, 0],
	]);
	assert.ok(!('time' in kom.results[0]));

	const byId = Object.fromEntries(e1.results.map((x) => [x.member, x]));
	assert.equal(byId.c.points, 17 + 3);
	assert.equal(byId.b.points, 15 + 3);
	assert.equal(byId.a.points, 16);
	assert.deepEqual(e1.unbenchmarked.map((x) => [x.member, x.points]), [['d', 3]]);
	assert.ok(out.warnings.some((w) => w.includes('"nope"')));
});

test('a segment effort without a full-route time earns nothing', () => {
	const ev = structuredClone(events);
	ev[1].bonus_segments = ['kom'];
	ev[1].results = ev[1].results.filter((x) => x.member !== 'a');
	ev[1].results.push({ member: 'a', segment: 'kom', time: '1:00', date: '2026-10-20' });
	const out = computeStandings(league, members, routes, ev);
	assert.deepEqual(out.events[1].segments[0].results, []);
});

test('legacy qualifier_bonus setting still applies', () => {
	const l = { ...league, settings: { qualifier_bonus: [5, 0, 0] } };
	const out = computeStandings(l, members, routes, events);
	assert.equal(out.events[0].results.find((x) => x.member === 'a').bonus, 10);
});
