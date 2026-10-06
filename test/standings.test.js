// Worked example from 02-handicap-model.md as a fixture. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStandings, formatTime, median, WEIGHTS } = require('../lib/model');

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
	// Raw-mode coverage: raw ordering, and an unbenchmarked rider can score bonus.
	const l = { ...league, members: ['a', 'b', 'c', 'd'], settings: { segment_bonus_mode: 'raw' } };
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

test('points come from the league, and missing points warn', () => {
	const custom = { ...league, settings: { points: { first: 10, step: 2, min: 3, participation: 1 } } };
	const r = computeStandings(custom, members, routes, events);
	const e1 = r.events.find((e) => e.id === 'e1');
	// Places 1, 2, 3 -> 10, 8, 6 finishing points, plus 1 for finishing.
	assert.deepEqual(e1.results.map((x) => x.points), [11, 9, 7]);
	assert.ok(!r.warnings.some((w) => w.includes('settings.points')));

	const fallback = computeStandings(league, members, routes, events);
	assert.ok(fallback.warnings.some((w) => w.includes('settings.points not set')));
});

test('a challenge is scored after same-day events and never moves benchmarks', () => {
	const challenge = {
		id: 'a-challenge', // sorts before e1 by id, so ordering must come from the type
		league: 'test',
		type: 'challenge',
		route: 'hilly',
		route_type: 'punchy',
		score_segment: 'lap',
		window: { from: '2026-10-19', to: '2026-11-01' },
		results: [
			{ member: 'a', segment: 'lap', time: '14:00', date: '2026-10-21' },
			{ member: 'b', segment: 'lap', time: '15:00', date: '2026-10-28' },
			{ member: 'c', segment: 'lap', time: '16:00', date: '2026-10-25' },
		],
	};
	const base = computeStandings(league, members, routes, events);
	const out = computeStandings(league, members, routes, [...events, challenge]);

	assert.deepEqual(out.events.map((e) => e.id), ['q', 'e1', 'a-challenge']);
	assert.deepEqual(out.benchmarks, base.benchmarks);
	const c = out.events.find((e) => e.id === 'a-challenge');
	assert.equal(c.benchmarksUpdated, false);
	assert.equal(c.results.length, 3);
	// Two-week window is fine; a challenge may span any whole number of weeks.
	assert.ok(!out.warnings.some((w) => w.includes('a-challenge: challenge window')));
	// Challenge points count towards the season total.
	const a = out.table.find((r) => r.member === 'a');
	const aBase = base.table.find((r) => r.member === 'a');
	assert.equal(a.total, aBase.total + c.results.find((r) => r.member === 'a').points);
});

test('events link their score segment to Strava when it has an ID', () => {
	const linked = routes.map((r) => ({
		...r,
		segments: { ...r.segments, lap: { ...r.segments.lap, strava_segment_id: 999 } },
	}));
	const out = computeStandings(league, members, linked, events);
	for (const e of out.events) {
		assert.deepEqual(e.scoreSegment, { key: 'lap', name: linked[0].segments.lap.name || 'lap', url: 'https://www.strava.com/segments/999' });
	}
	const unlinked = computeStandings(league, members, routes, events);
	if (!routes[0].segments.lap.strava_segment_id) {
		assert.equal(unlinked.events[0].scoreSegment.url, null);
	}
});

// --- Late qualifiers, no re-benchmarking, renormalisation, settings.alpha ---

const withD = {
	members: [...members, { id: 'd', display: 'Rider D.' }],
	league: { ...league, members: ['a', 'b', 'c', 'd'] },
};
const qOn = (member, date, lap, kom, sprint) =>
	q(member, lap, kom, sprint).map((r) => ({ ...r, date }));
const e2 = {
	id: 'e2',
	league: 'test',
	type: 'event',
	route: 'hilly',
	route_type: 'flat',
	score_segment: 'lap',
	window: { from: '2026-11-02', to: '2026-11-15' },
	results: [
		{ member: 'a', segment: 'lap', time: '25:00', date: '2026-11-03' },
		{ member: 'b', segment: 'lap', time: '27:00', date: '2026-11-03' },
		{ member: 'c', segment: 'lap', time: '30:00', date: '2026-11-03' },
		{ member: 'd', segment: 'lap', time: '26:30', date: '2026-11-04' },
	],
};
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

test('late qualifier: participation only, benchmarked from the next event, nobody else changes', () => {
	// One-week reference window, so there's a gap before e1 opens on 2026-10-19.
	const base = structuredClone(events);
	base[0].window = { from: '2026-10-05', to: '2026-10-11' };
	const late = structuredClone(base);
	late[0].results.push(...qOn('d', '2026-10-14', 960, 170, 32));
	late[1].results.push({ member: 'd', segment: 'lap', time: '26:00', date: '2026-10-21' });

	const out = computeStandings(withD.league, withD.members, routes, late);
	const qual = out.events.find((e) => e.id === 'q');
	const d = qual.results.find((r) => r.member === 'd');
	assert.deepEqual(pick(d, ['bonus', 'points', 'late']), { bonus: 0, points: 2, late: true });
	assert.equal(qual.results[qual.results.length - 1].member, 'd', 'late riders listed after in-window riders');
	assert.ok(qual.segments.every((s) => s.results.every((r) => r.member !== 'd')));

	const ev = out.events.find((e) => e.id === 'e1');
	assert.ok(ev.results.some((r) => r.member === 'd'), 'D is ranked');
	assert.equal(ev.unbenchmarked.length, 0);
	assert.ok(out.info.some((m) => m.includes('Late qualifier: d (2026-10-14), benchmarked from e1')));

	// A, B and C's qualifier points and post-qualifier ratios don't move.
	const qOnly = (evs) => [evs[0]];
	const without = computeStandings(withD.league, withD.members, routes, qOnly(base));
	const withLate = computeStandings(withD.league, withD.members, routes, qOnly(late));
	const qualPts = (o) => Object.fromEntries(o.events[0].results.filter((r) => r.member !== 'd').map((r) => [r.member, r.points]));
	assert.deepEqual(qualPts(withLate), qualPts(without));
	assert.deepEqual(qualPts(withLate), { a: 8, b: 6, c: 4 });
	assert.deepEqual(pick(withLate.benchmarks, ['a', 'b', 'c']), pick(without.benchmarks, ['a', 'b', 'c']));
	assert.deepEqual(withLate.medians, without.medians);
	// Not effective yet after the qualifier alone: held until e1.
	assert.equal(withLate.benchmarks.d, undefined);
});

test('late qualifier after an event opens: unbenchmarked there, benchmarked in the next', () => {
	const ev = structuredClone([...events, e2]);
	ev[0].results.push(
		...qOn('d', '2026-10-20', 960, 170, 32),
		{ member: 'd', segment: 'lap', time: '15:00', date: '2026-11-02' }, // on/after e2 opens: ignored
		{ member: 'd', segment: 'kom', time: '2:00', date: '2026-12-01' } // after the last window: ignored
	);
	ev[1].results.push({ member: 'd', segment: 'lap', time: '26:00', date: '2026-10-21' });

	const out = computeStandings(withD.league, withD.members, routes, ev);
	const e1 = out.events.find((e) => e.id === 'e1');
	assert.deepEqual(e1.unbenchmarked.map((r) => [r.member, r.points]), [['d', 2]]);
	const second = out.events.find((e) => e.id === 'e2');
	assert.ok(second.results.some((r) => r.member === 'd'));
	assert.ok(out.info.some((m) => m.includes('benchmarked from e2')));
	assert.ok(out.warnings.some((w) => w.includes('d/lap') && w.includes('on or after e2 opens')));
	assert.ok(out.warnings.some((w) => w.includes('d/kom') && w.includes("after the league's last event window")));
	// The ignored 15:00 lap didn't become D's benchmark: D matches B's qualifier.
	assert.equal(out.table.find((r) => r.member === 'd').qualifier, 2);

	// With no event starting after the ride, D gets participation but no benchmark.
	const only = structuredClone(ev.slice(0, 2));
	const out2 = computeStandings(withD.league, withD.members, routes, only);
	assert.ok(out2.warnings.some((w) => w.includes('late qualifier d') && w.includes('no benchmark')));
	assert.equal(out2.events[0].results.find((r) => r.member === 'd').points, 2);
	assert.equal(out2.benchmarks.d, undefined);
});

test('no re-benchmarking: later qualifier rows and a second qualifier are ignored', () => {
	const base = computeStandings(league, members, routes, events);
	const ev = structuredClone(events);
	ev[0].results.push(
		...qOn('a', '2026-10-25', 800, 120, 25), // after the window, A already qualified
		{ member: 'b', segment: 'lap', time: '10:00', date: '2026-10-01' } // before the window
	);
	ev.push({
		id: 'q2', league: 'test', type: 'qualifier', route: 'hilly',
		window: { from: '2026-10-19', to: '2026-11-01' },
		results: qOn('c', '2026-10-20', 700, 100, 20),
	});
	const out = computeStandings(league, members, routes, ev);
	assert.deepEqual(out.benchmarks, base.benchmarks);
	assert.deepEqual(out.events.map((e) => e.id), ['q', 'e1']);
	assert.deepEqual(out.table, base.table);
	assert.ok(out.warnings.some((w) => w.includes('a/lap') && w.includes('re-qualification ignored')));
	assert.ok(out.warnings.some((w) => w.includes('b/lap') && w.includes('before window')));
	assert.ok(out.warnings.some((w) => w.includes('q2') && w.includes('ignored')));
});

test('a qualifier route with no sprint renormalises the weights', () => {
	const r = [{ id: 'nosprint', segments: { lap: {}, kom: {} } }];
	const ev = structuredClone(events);
	ev[0].route = 'nosprint';
	ev[0].results = ev[0].results.filter((x) => x.segment !== 'sprint');
	ev[1].route = 'nosprint';
	const out = computeStandings(league, members, r, ev);

	assert.deepEqual(out.components, ['climb', 'flat']);
	near(out.weights.rolling.climb, 0.4375, 9);
	near(out.weights.rolling.flat, 0.5625, 9);
	assert.equal(out.weights.rolling.sprint, 0);
	for (const [type, w] of Object.entries(out.weights)) {
		near(w.climb + w.flat + w.sprint, 1, 9);
		assert.equal(w.sprint, 0, type);
	}
	assert.equal(out.medians.sprint, null);
	assert.ok(out.warnings.some((w) => w.includes('no sprint segment')));

	// Flat = lap − KOM: A 750, B 790, C 880, median 790. KOM median 170.
	const e1 = out.events.find((e) => e.id === 'e1');
	const a = e1.results.find((x) => x.member === 'a');
	const blended = 0.4375 * (150 / 170) + 0.5625 * (750 / 790);
	near(a._blended, Number(blended.toFixed(6)), 6);
	near(a.adjusted, Number((1500 / blended).toFixed(3)));
	// No sprint ratio, before or after the route update.
	assert.ok(!('sprint' in out.benchmarks.a));
	assert.deepEqual(Object.keys(out.benchmarks.c).sort(), ['climb', 'flat']);
	// Full routes keep the original weights untouched.
	assert.equal(computeStandings(league, members, routes, events).weights.rolling, WEIGHTS.rolling);
});

test('settings.alpha sets the update rate; absent behaves as 0.3', () => {
	const at = (alpha) => computeStandings({ ...league, settings: alpha === undefined ? {} : { alpha } }, members, routes, events);
	assert.deepEqual(at(undefined).benchmarks, at(0.3).benchmarks);
	assert.equal(at(undefined).settings.alpha, 0.3);

	// A: pre-event climb 150/170, blended 0.9238 (worked example), event median 1640.
	const half = at(0.5);
	const blendedA = half.events[1].results.find((x) => x.member === 'a')._blended;
	const error = (1500 / 1640) / blendedA;
	near(half.benchmarks.a.climb, Number(((150 / 170) * (1 + 0.5 * 0.35 * (error - 1))).toFixed(6)), 6);
	near(half.benchmarks.a.flat, Number(((720 / 758) * (1 + 0.5 * 0.45 * (error - 1))).toFixed(6)), 6);
	assert.notDeepEqual(half.benchmarks, at(0.3).benchmarks);
});

// --- Handicapped bonus segments (Step 4b) and the bonus segment update (Step 5) ---

/** The spec's worked example with the sprint bonus: e1 rolling, bonus_segments [sprint]. */
const withSprint = (sprints = { a: '0:30', b: '0:29', c: '0:33' }) => {
	const ev = structuredClone(events);
	ev[1].bonus_segments = ['sprint'];
	for (const [member, time] of Object.entries(sprints)) {
		ev[1].results.push({ member, segment: 'sprint', time, date: '2026-10-20' });
	}
	return ev;
};
const segPlaces = (seg) => seg.results.map((x) => [x.member, x.place, x.points]);
const byMember = (rows) => Object.fromEntries(rows.map((x) => [x.member, x]));

test('worked example with the sprint bonus (handicap)', () => {
	const out = computeStandings(league, members, routes, withSprint());
	const e1 = out.events.find((e) => e.id === 'e1');
	assert.equal(out.settings.segment_bonus_mode, 'handicap');

	const sprint = e1.segments[0];
	assert.equal(sprint.mode, 'handicap');
	// Adjusted: A 30/0.9375 = 32.0, B 29/1 = 29.0, C 33/1.125 = 29.33.
	// The spec's table puts C 2nd, but ties are compared to the nearest second,
	// so C's 29.33 rounds to 29 and ties B: both share 1st (3 points each).
	assert.deepEqual(segPlaces(sprint), [['b', 1, 3], ['c', 1, 3], ['a', 3, 1]]);
	assert.ok(sprint.results.every((x) => !('time' in x) && !('adjusted' in x)));

	// Spec says A 17, B 18, C 19; with the tie C gets 3 bonus, not 2.
	const pts = Object.fromEntries(e1.results.map((x) => [x.member, x.points]));
	assert.deepEqual(pts, { a: 17, b: 18, c: 20 });

	const expected = {
		a: [0.8814, 0.9486, 0.9557],
		b: [1.0000, 1.0000, 0.9900],
		c: [1.1741, 1.1106, 1.1162],
	};
	for (const [id, [climb, flat, sprintR]] of Object.entries(expected)) {
		near(out.benchmarks[id].climb, climb, 4);
		near(out.benchmarks[id].flat, flat, 4);
		near(out.benchmarks[id].sprint, sprintR, 4);
	}
	assert.equal(sprint.benchmarksUpdated, true);
});

test('raw mode: same event ranks B, A, C and r_sprint gets the route update only', () => {
	const l = { ...league, settings: { segment_bonus_mode: 'raw' } };
	const out = computeStandings(l, members, routes, withSprint());
	const sprint = out.events[1].segments[0];
	assert.equal(sprint.mode, 'raw');
	assert.deepEqual(segPlaces(sprint), [['b', 1, 3], ['a', 2, 2], ['c', 3, 1]]);
	near(out.benchmarks.a.sprint, 0.9369, 4);
	near(out.benchmarks.c.sprint, 1.1237, 4);
	assert.equal(out.benchmarks.b.sprint, 1);
	// Climb and flat match the plain worked example.
	const plain = computeStandings(league, members, routes, events);
	for (const id of ['a', 'b', 'c']) {
		assert.equal(out.benchmarks[id].climb, plain.benchmarks[id].climb);
		assert.equal(out.benchmarks[id].flat, plain.benchmarks[id].flat);
	}
});

test('an unrecognised segment_bonus_mode warns and falls back to handicap', () => {
	const out = computeStandings({ ...league, settings: { segment_bonus_mode: 'fastest' } }, members, routes, withSprint());
	assert.equal(out.settings.segment_bonus_mode, 'handicap');
	assert.ok(out.warnings.some((w) => w.includes('segment_bonus_mode "fastest"')));
	assert.ok(!computeStandings(league, members, routes, events).warnings.some((w) => w.includes('segment_bonus_mode')));
});

test('the qualifier bonus is raw whatever the mode', () => {
	for (const m of ['handicap', 'raw']) {
		const out = computeStandings({ ...league, settings: { segment_bonus_mode: m } }, members, routes, events);
		const qual = out.events[0];
		assert.deepEqual(Object.fromEntries(qual.results.map((r) => [r.member, r.points])), { a: 8, b: 6, c: 4 });
		assert.ok(qual.segments.every((s) => s.mode === 'raw'));
	}
});

test('unbenchmarked riders: no bonus in handicap mode but count towards the segment median; bonus in raw mode', () => {
	// D fastest on the road sprint, but unbenchmarked.
	const ev = withSprint({ a: '0:30', b: '0:29', c: '0:33', d: '0:25' });
	ev[1].results.push({ member: 'd', segment: 'lap', time: '26:00', date: '2026-10-21' });

	const h = computeStandings(withD.league, withD.members, routes, ev);
	const hs = h.events[1].segments[0];
	assert.ok(hs.results.every((x) => x.member !== 'd'));
	assert.deepEqual(segPlaces(hs), [['b', 1, 3], ['c', 1, 3], ['a', 3, 1]]);
	assert.deepEqual(h.events[1].unbenchmarked.map((x) => [x.member, x.bonus, x.points]), [['d', 0, 2]]);
	// Segment median of 25, 29, 30, 33 is 29.5 (D included), not 30.
	const route = h.events[1].results.find((x) => x.member === 'a');
	const eventMedian = median([1500, 1640, 1830, 1560]);
	const routeError = (1500 / eventMedian) / route._blended;
	const seg = 1 + 0.3 * ((30 / 29.5) / (30 / 32) - 1);
	const expected = (30 / 32) * (1 + 0.3 * 0.2 * (routeError - 1)) * seg;
	near(h.benchmarks.a.sprint, Number(expected.toFixed(6)), 6);

	const r = computeStandings({ ...withD.league, settings: { segment_bonus_mode: 'raw' } }, withD.members, routes, ev);
	assert.deepEqual(segPlaces(r.events[1].segments[0])[0], ['d', 1, 3]);
	assert.deepEqual(r.events[1].unbenchmarked.map((x) => [x.member, x.points]), [['d', 5]]);
});

test('a challenge ranks its bonus segment handicapped but never moves benchmarks', () => {
	const challenge = {
		id: 'ch', league: 'test', type: 'challenge', route: 'hilly', route_type: 'punchy',
		score_segment: 'lap', bonus_segments: ['sprint'],
		window: { from: '2026-10-19', to: '2026-11-01' },
		results: [
			{ member: 'a', segment: 'lap', time: '14:00', date: '2026-10-21' },
			{ member: 'b', segment: 'lap', time: '15:00', date: '2026-10-21' },
			{ member: 'c', segment: 'lap', time: '16:00', date: '2026-10-21' },
			{ member: 'a', segment: 'sprint', time: '0:30', date: '2026-10-21' },
			{ member: 'b', segment: 'sprint', time: '0:29', date: '2026-10-21' },
			{ member: 'c', segment: 'sprint', time: '0:33', date: '2026-10-21' },
		],
	};
	const base = computeStandings(league, members, routes, events);
	const out = computeStandings(league, members, routes, [...events, challenge]);
	const seg = out.events.find((e) => e.id === 'ch').segments[0];
	assert.equal(seg.mode, 'handicap');
	// Ratios after e1 (route update only): B 29.0, C 33/1.124 = 29.4 (rounds to 29, a tie), A 30/0.937 = 32.
	assert.deepEqual(segPlaces(seg), [['b', 1, 3], ['c', 1, 3], ['a', 3, 1]]);
	assert.ok(!seg.benchmarksUpdated);
	assert.deepEqual(out.benchmarks, base.benchmarks);
});

test('a bonus segment with fewer than 3 times is scored but not used to update', () => {
	const ev = withSprint({ a: '0:30', b: '0:29' });
	const out = computeStandings(league, members, routes, ev);
	const seg = out.events[1].segments[0];
	assert.deepEqual(segPlaces(seg), [['b', 1, 3], ['a', 2, 2]]);
	assert.equal(seg.benchmarksUpdated, false);
	// Route update still runs (3 finishers), so ratios match the plain worked example.
	assert.deepEqual(out.benchmarks, computeStandings(league, members, routes, events).benchmarks);
});

test('renormalised league: a sprint bonus segment can only be scored raw', () => {
	const r = [{ id: 'nosprint', segments: { lap: {}, kom: {} } }, { id: 'hilly', segments: { lap: {}, kom: {}, sprint: {} } }];
	const ev = structuredClone(events);
	ev[0].route = 'nosprint';
	ev[0].results = ev[0].results.filter((x) => x.segment !== 'sprint');
	ev[1].bonus_segments = ['kom', 'sprint'];
	ev[1].results.push(
		{ member: 'a', segment: 'kom', time: '2:20', date: '2026-10-20' },
		{ member: 'b', segment: 'kom', time: '2:50', date: '2026-10-20' },
		{ member: 'c', segment: 'kom', time: '3:20', date: '2026-10-20' },
		{ member: 'a', segment: 'sprint', time: '0:30', date: '2026-10-20' },
		{ member: 'b', segment: 'sprint', time: '0:29', date: '2026-10-20' },
		{ member: 'c', segment: 'sprint', time: '0:33', date: '2026-10-20' }
	);

	const h = computeStandings(league, members, r, ev);
	const e1 = h.events[1];
	assert.ok(h.warnings.some((w) => w.includes('"sprint"') && w.includes('no sprint segment')));
	assert.deepEqual(e1.segments.map((s) => s.key), ['kom']);
	// KOM updates r_climb: compare with the same event without the KOM bonus.
	const noBonus = structuredClone(ev);
	noBonus[1].bonus_segments = [];
	const plain = computeStandings(league, members, r, noBonus);
	assert.notEqual(h.benchmarks.a.climb, plain.benchmarks.a.climb);
	assert.equal(h.benchmarks.a.flat, plain.benchmarks.a.flat);
	for (const id of ['a', 'b', 'c']) {
		assert.ok(!('sprint' in h.benchmarks[id]));
	}

	const raw = computeStandings({ ...league, settings: { segment_bonus_mode: 'raw' } }, members, r, ev);
	const sprint = raw.events[1].segments.find((s) => s.key === 'sprint');
	assert.deepEqual(segPlaces(sprint), [['b', 1, 3], ['a', 2, 2], ['c', 3, 1]]);
	assert.ok(!raw.warnings.some((w) => w.includes('"sprint"')));
	assert.ok(!('sprint' in raw.benchmarks.a));
});

test('two bonus segments of the same type both multiply into r_climb', () => {
	const r = [{ id: 'f8', segments: { lap: {}, kom_rev: { type: 'climb' }, kom: {}, sprint: {} } }];
	const row = (member, lap, komRev, kom, sprint, date = '2026-10-07') => [
		{ member, segment: 'lap', time: lap, date },
		{ member, segment: 'kom_rev', time: komRev, date },
		{ member, segment: 'kom', time: kom, date },
		{ member, segment: 'sprint', time: sprint, date },
	];
	const ev = [
		{
			id: 'q', league: 'test', type: 'qualifier', route: 'f8',
			window: { from: '2026-10-05', to: '2026-10-18' },
			results: [...row('a', 2800, 300, 150, 30), ...row('b', 2900, 320, 160, 32), ...row('c', 3000, 340, 170, 34)],
		},
		{
			id: 'e1', league: 'test', type: 'event', route: 'f8', route_type: 'rolling', score_segment: 'lap',
			bonus_segments: ['kom_rev', 'kom'],
			window: { from: '2026-10-19', to: '2026-11-01' },
			results: [...row('a', 2850, 290, 160, 30, '2026-10-20'), ...row('b', 2880, 330, 150, 31, '2026-10-20'), ...row('c', 2950, 335, 172, 35, '2026-10-20')],
		},
	];
	const only = (keys) => {
		const e = structuredClone(ev);
		e[1].bonus_segments = keys;
		return computeStandings(league, members, r, e);
	};
	const none = only([]);
	const both = only(['kom_rev', 'kom']);
	const swapped = only(['kom', 'kom_rev']);
	const komRev = only(['kom_rev']);
	const kom = only(['kom']);
	for (const id of ['a', 'b', 'c']) {
		// Each factor is relative to the route-only result; together they multiply.
		const fRev = komRev.benchmarks[id].climb / none.benchmarks[id].climb;
		const fKom = kom.benchmarks[id].climb / none.benchmarks[id].climb;
		near(both.benchmarks[id].climb, Number((none.benchmarks[id].climb * fRev * fKom).toFixed(9)), 9);
		near(swapped.benchmarks[id].climb, Number(both.benchmarks[id].climb.toFixed(9)), 9);
		assert.equal(both.benchmarks[id].flat, none.benchmarks[id].flat);
		assert.equal(both.benchmarks[id].sprint, none.benchmarks[id].sprint);
	}
	assert.notEqual(both.benchmarks.a.climb, none.benchmarks.a.climb);
});

test('a lap bonus segment is handicapped by blended and does not add a segment update', () => {
	const ev = structuredClone(events);
	ev[1].bonus_segments = ['lap'];
	const out = computeStandings(league, members, routes, ev);
	const seg = out.events[1].segments[0];
	// Same ordering as the adjusted results: C, A, B.
	assert.deepEqual(segPlaces(seg), [['c', 1, 3], ['a', 2, 2], ['b', 3, 1]]);
	assert.deepEqual(out.benchmarks, computeStandings(league, members, routes, events).benchmarks);
});

test('the lap-ratio fallback rider is adjusted by that ratio on a bonus segment', () => {
	// C has no qualifier sprint: every ratio = lap ratio 1080/960 = 1.125.
	// Sprint median is now A and B only (31), so r_sprint A 30/31, B 32/31.
	const run = (cSprint) => {
		const ev = withSprint({ a: '0:30', b: '0:29', c: cSprint });
		ev[0].results = ev[0].results.filter((x) => !(x.member === 'c' && x.segment === 'sprint'));
		return computeStandings(league, members, routes, ev);
	};
	const out = run('0:33');
	assert.ok(out.warnings.some((w) => w.includes('c missing climb/sprint')));
	// Adjusted: B 29/(32/31) = 28.1, C 33/1.125 = 29.3, A 30/(30/31) = 31.0.
	assert.deepEqual(segPlaces(out.events[1].segments[0]), [['b', 1, 3], ['c', 2, 2], ['a', 3, 1]]);
	// C on 0:35: 35/1.125 = 31.1, which rounds to A's 31 and shares 2nd.
	assert.deepEqual(segPlaces(run('0:35').events[1].segments[0]), [['b', 1, 3], ['a', 2, 2], ['c', 2, 2]]);
});
