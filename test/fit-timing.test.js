// Segment timing from a synthetic per-second track (lib/fit/timing.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { timeRoute, segmentEfforts, prepare, roundUp } = require('../lib/fit/timing');
const { ride, segment } = require('./helpers/track');

const near = (actual, expected, tol = 0.01) =>
	assert.ok(Math.abs(actual - expected) <= tol, `${actual} ≈ ${expected}`);

test('a straight segment, interpolated between samples', () => {
	// 9.7 m/s, so the start and end fall between whole-second samples.
	const track = ride([-500, 0], [{ to: [1500, 0], v: 9.7 }]);
	const [t] = segmentEfforts(prepare(track), segment([0, 0], [1000, 0], 1000));
	near(t, 1000 / 9.7);
});

// A figure of eight whose lap segment starts and ends at the origin, and which
// crosses the origin again halfway round (heading south), like Figure 8 does.
const LAP = 8000;
const loop = (v) => [
	{ to: [1000, 0], v }, { to: [1000, 1000], v }, { to: [0, 1000], v },
	{ to: [0, -1000], v }, // through the origin, mid-route
	{ to: [-1000, -1000], v }, { to: [-1000, 0], v }, { to: [0, 0], v },
];
const lapSegment = segment([0, 0], [0, 0], LAP);

test('crossing the start point mid-route is not mistaken for a lap', () => {
	const track = ride([-200, 0], [{ to: [0, 0], v: 9 }, ...loop(9), { to: [300, 0], v: 9 }]);
	const efforts = segmentEfforts(prepare(track), lapSegment);
	assert.equal(efforts.length, 1, 'only the full lap, not the half laps either side of the crossing');
	near(efforts[0], LAP / 9);
});

test('several laps: every lap is timed and the fastest counts', () => {
	const track = ride([-200, 0], [{ to: [0, 0], v: 8 }, ...loop(8), ...loop(10), ...loop(9), { to: [300, 0], v: 9 }]);
	const route = { id: 'fig8', segments: { lap: lapSegment } };
	const { times, warnings } = timeRoute(track, route);
	assert.deepEqual(warnings, []);
	near(times.lap, LAP / 10);
	const efforts = segmentEfforts(prepare(track), lapSegment);
	assert.ok(efforts.length >= 3);
});

test('a reverse climb sharing a summit with the forward climb', () => {
	// Forward climb F→S (900 m) and reverse climb R→S (2500 m) meet at the summit S.
	// Out along y=0 over F, S and R, U-turn, and back along y=10 over R, S and F.
	const F = [0, 0];
	const S = [900, 0];
	const R = [3400, 0];
	const route = {
		id: 'hills',
		segments: {
			kom: segment(F, S, 900, { name: 'Forward' }),
			kom_rev: segment(R, S, 2500, { name: 'Reverse' }),
		},
	};
	const track = ride([-100, 0], [
		// Speeds change away from the segment points, so each pass is at constant speed.
		{ to: [1000, 0], v: 5 }, // forward climb, F to S
		{ to: [4400, 0], v: 14 }, // descend past R
		{ to: [4400, 10], v: 3 }, // U-turn
		{ to: [800, 10], v: 6 }, // reverse climb, R to S
		{ to: [-100, 10], v: 15 }, // descend past F
	]);
	const { times } = timeRoute(track, route);
	near(times.kom, 900 / 5);
	// Passing R on the way out is 4.5 km before the summit pass on the way back, so it's
	// not paired with it: only the climb from R on the return counts.
	near(times.kom_rev, 2500 / 6);
	// Without the length check, the outbound R pass would pair with the return summit.
	const loose = segmentEfforts(prepare(track), route.segments.kom_rev, { minLength: 0, maxLength: 99 });
	assert.ok(loose.length > 1);
});

test('segments without points or length_m are skipped with a warning', () => {
	const track = ride([-500, 0], [{ to: [1500, 0], v: 10 }]);
	const route = {
		id: 'r',
		segments: {
			lap: segment([0, 0], [1000, 0], 1000),
			kom: { ...segment([0, 0], [500, 0], 500), length_m: null },
			sprint: { start: null, end: null, length_m: 300 },
		},
	};
	const { times, warnings } = timeRoute(track, route);
	assert.deepEqual(Object.keys(times), ['lap']);
	assert.deepEqual(warnings, ['r/kom: no length_m, skipped', 'r/sprint: no start/end points, skipped']);
});

test('positions alone are enough when there is no odometer', () => {
	const track = ride([-500, 0], [{ to: [1500, 0], v: 9.7 }]).map(({ dist, ...s }) => s);
	const [t] = segmentEfforts(prepare(track), segment([0, 0], [1000, 0], 1000));
	near(t, 1000 / 9.7);
});

test('rounding up to whole seconds, as Strava does', () => {
	// Mike's verified Figure 8 ride: 54:23.7 → 54:24, 4:58.3 → 4:59, 2:51.0 → 2:51, 28.0 → 28.
	assert.equal(roundUp(54 * 60 + 23.7), 54 * 60 + 24);
	assert.equal(roundUp(4 * 60 + 58.3), 4 * 60 + 59);
	assert.equal(roundUp(171.0), 171);
	assert.equal(roundUp(28.0), 28);
	assert.equal(roundUp(171.0000001), 171, 'interpolation noise doesn\'t tip it up');
	assert.equal(roundUp(171.06), 172);
});
