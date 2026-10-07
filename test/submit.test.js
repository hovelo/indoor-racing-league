// FIT uploads: links, the upload handler (end to end with a synthetic FIT file and an
// in-memory store), and the submissions results source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeToken, verifyToken, submitPath } = require('../lib/submit/token');
const { buildSubmitConfig, processRide, SubmitError } = require('../lib/submit/process');
const { handleUpload, MAX_BYTES } = require('../lib/submit/handler');
const { memoryStore } = require('../lib/submit/store');
const { submissionsSource } = require('../lib/sources/submissions');
const { readFit } = require('../lib/fit/parse');
const { ride, segment } = require('./helpers/track');
const { encodeFit } = require('./helpers/fit');

const SECRET = 'test-secret';

// A 4 km square loop with its lap segment starting and ending mid-way along the first
// side, and a 300 m sprint on the far side.
const routes = [
	{
		id: 'square',
		name: 'Square Route',
		segments: {
			lap: { name: 'Square Lap', ...segment([500, 0], [500, 0], 4000) },
			sprint: { name: 'Square Sprint', ...segment([800, 1000], [500, 1000], 300) },
			kom: { name: 'Unmeasured KOM', start: null, end: null, length_m: null },
		},
	},
	{ id: 'elsewhere', name: 'Elsewhere', segments: { lap: { name: 'Far Lap', ...segment([50000, 0], [51000, 0], 1000) } } },
];
const leagues = [{ id: 'test', slug: 'test-slug-123', members: ['tom-c', 'meg-g'] }];
const events = [
	{ id: 'q', league: 'test', type: 'qualifier', route: 'square', window: { from: '2026-10-05', to: '2026-10-18' } },
	{ id: 'e0', league: 'test', type: 'event', route: 'square', route_type: 'flat', score_segment: 'lap', window: { from: '2026-10-05', to: '2026-10-18' } },
	{ id: 'e1', league: 'test', type: 'event', route: 'square', route_type: 'flat', score_segment: 'lap', window: { from: '2026-10-19', to: '2026-11-01' } },
	{ id: 'c1', league: 'test', type: 'challenge', route: 'elsewhere', route_type: 'punchy', score_segment: 'lap', window: { from: '2026-10-19', to: '2026-11-29' } },
];
const config = buildSubmitConfig({ leagues, events, routes });

const lap = (v) => [{ to: [1000, 0], v }, { to: [1000, 1000], v }, { to: [0, 1000], v }, { to: [0, 0], v }];
// 23:30 UTC on 18 October is 00:30 on the 19th in London (BST): inside e1, not e0.
const START = Date.parse('2026-10-18T23:30:00Z');
const fullRide = (v = 9.7, start = START) => ride([0, 0], [...lap(v), { to: [600, 0], v }], { start });
const partRide = () => ride([0, 0], [{ to: [1000, 0], v: 10 }, { to: [1000, 1000], v: 10 }, { to: [400, 1000], v: 10 }], { start: START });

const tokenFor = (member) => makeToken(SECRET, 'test', member);

function request({ member = 'tom-c', token = tokenFor(member), slug = 'test-slug-123', file, name = 'ride.fit' } = {}) {
	const form = new FormData();
	form.set('league', slug);
	form.set('m', member);
	form.set('t', token);
	if (file) {
		form.set('file', new File([file], name));
	}
	return new Request('https://example.test/api/submit', { method: 'POST', body: form });
}

function deps(overrides = {}) {
	const hooks = [];
	return {
		config,
		secret: SECRET,
		store: memoryStore(),
		buildHook: 'https://hooks.example.test/build',
		fetch: async (url) => {
			hooks.push(url);
			return { ok: true, status: 200 };
		},
		log: { log() {}, warn() {}, error() {} },
		hooks,
		...overrides,
	};
}

// --- Links ---

test('tokens: 16 hex characters, stable, and specific to league and member', () => {
	const t = makeToken(SECRET, 'test', 'tom-c');
	assert.match(t, /^[0-9a-f]{16}$/);
	assert.equal(t, makeToken(SECRET, 'test', 'tom-c'));
	assert.ok(verifyToken(SECRET, 'test', 'tom-c', t));
	assert.ok(!verifyToken(SECRET, 'test', 'meg-g', t), 'another member');
	assert.ok(!verifyToken(SECRET, 'other', 'tom-c', t), 'another league');
	assert.ok(!verifyToken('rotated', 'test', 'tom-c', t), 'rotating the secret invalidates links');
	assert.ok(!verifyToken(SECRET, 'test', 'tom-c', t.slice(0, 15)), 'truncated');
	assert.ok(!verifyToken(SECRET, 'test', 'tom-c', undefined));
	assert.ok(!verifyToken(undefined, 'test', 'tom-c', t), 'no secret configured');
	assert.notEqual(makeToken(SECRET, 'ab', 'c'), makeToken(SECRET, 'a', 'bc'));
	assert.equal(submitPath('test-slug-123', 'tom-c', t), `/l/test-slug-123/submit/?m=tom-c&t=${t}`);
});

test('the submit config holds ids, windows and segment points only', () => {
	assert.deepEqual(config.leagues, [{ id: 'test', slug: 'test-slug-123', members: ['tom-c', 'meg-g'] }]);
	assert.deepEqual(config.events.map((e) => e.id), ['e0', 'e1', 'c1'], 'no qualifier');
	assert.deepEqual(Object.keys(config.routes.square.segments.lap).sort(), ['end', 'length_m', 'name', 'start']);
});

// --- Processing a ride ---

test('the ride date is the London date of the first record', async () => {
	const { date } = await readFit(encodeFit(fullRide()));
	assert.equal(date, '2026-10-19');
});

test('rejects a bad link or a member not in the league', () => {
	const r = { track: fullRide(), date: '2026-10-19' };
	const call = (o) => () => processRide({ config, slug: 'test-slug-123', member: 'tom-c', token: tokenFor('tom-c'), secret: SECRET, ride: r, ...o });
	assert.throws(call({ token: tokenFor('meg-g') }), (e) => e instanceof SubmitError && e.status === 403);
	assert.throws(call({ slug: 'nope' }), (e) => e.status === 403);
	const leftLeague = { ...config, leagues: [{ ...config.leagues[0], members: ['meg-g'] }] };
	assert.throws(call({ config: leftLeague }), /isn't valid for this league any more/);
});

test('rejects a ride outside every event window', () => {
	const r = { track: fullRide(), date: '2026-12-01' };
	assert.throws(
		() => processRide({ config, slug: 'test-slug-123', member: 'tom-c', token: tokenFor('tom-c'), secret: SECRET, ride: r }),
		(e) => e.status === 422 && /2026-12-01.*can't be ridden late/.test(e.message),
	);
});

test('rejects a ride with no time on the score segment', () => {
	const r = { track: partRide(), date: '2026-10-19' };
	assert.throws(
		() => processRide({ config, slug: 'test-slug-123', member: 'tom-c', token: tokenFor('tom-c'), secret: SECRET, ride: r }),
		(e) => e.status === 422 && /No full ride of Square Route or Elsewhere/.test(e.message),
	);
});

test('times every measured segment, rounds up, and skips unmeasured ones with a warning', () => {
	const r = { track: fullRide(9.7), date: '2026-10-19' };
	const out = processRide({ config, slug: 'test-slug-123', member: 'tom-c', token: tokenFor('tom-c'), secret: SECRET, ride: r });
	assert.equal(out.events.length, 1, 'the challenge on another route isn\'t matched');
	const [e1] = out.events;
	assert.equal(e1.id, 'e1');
	// 4000 m and 300 m at 9.7 m/s: 412.37 s and 30.93 s, rounded up.
	assert.deepEqual(e1.rows, [
		{ event: 'e1', member: 'tom-c', segment: 'lap', time: '6:53', date: '2026-10-19', source: 'fit' },
		{ event: 'e1', member: 'tom-c', segment: 'sprint', time: '0:31', date: '2026-10-19', source: 'fit' },
	]);
	assert.ok(out.warnings.some((w) => /e1: square\/kom: no start\/end points/.test(w)));
});

// --- The upload handler, end to end ---

test('upload: stores the derived rows and the file hash, rebuilds, and shows the rider their times', async () => {
	const d = deps();
	const res = await handleUpload(request({ file: encodeFit(fullRide()) }), d);
	const body = await res.json();
	assert.equal(res.status, 200, body.error);
	assert.equal(body.date, '2026-10-19');
	assert.equal(body.rebuild, true);
	assert.deepEqual(body.events[0].times.map((x) => [x.name, x.time, x.improved]), [['Square Lap', '6:53', true], ['Square Sprint', '0:31', true]]);
	assert.deepEqual(d.hooks, ['https://hooks.example.test/build']);

	const keys = [...d.store.data.keys()].sort();
	assert.equal(keys.length, 3);
	assert.deepEqual(keys.slice(1), ['test/e1/tom-c/lap', 'test/e1/tom-c/sprint']);
	assert.match(keys[0], /^hashes\/[0-9a-f]{64}$/);
	// Only the derived row: no positions, power, heart rate or file.
	assert.deepEqual(JSON.parse(d.store.data.get('test/e1/tom-c/lap')),
		{ event: 'e1', member: 'tom-c', segment: 'lap', time: '6:53', date: '2026-10-19', source: 'fit' });
	assert.deepEqual(JSON.parse(d.store.data.get(keys[0])), { league: 'test', member: 'tom-c' });
});

test('upload: the same file twice is rejected', async () => {
	const d = deps();
	const file = encodeFit(fullRide());
	assert.equal((await handleUpload(request({ file }), d)).status, 200);
	const res = await handleUpload(request({ file }), d);
	assert.equal(res.status, 409);
});

test('upload: keeps the fastest per segment, and only rebuilds when something improved', async () => {
	const d = deps();
	await handleUpload(request({ file: encodeFit(fullRide(10)) }), d); // 6:40
	const slower = await (await handleUpload(request({ file: encodeFit(fullRide(9, START + 3600e3)) }), d)).json();
	assert.deepEqual(slower.events[0].times.map((x) => [x.time, x.improved, x.previous]), [['7:25', false, '6:40'], ['0:34', false, '0:30']]);
	assert.equal(slower.rebuild, false);
	assert.equal(d.hooks.length, 1);
	const faster = await (await handleUpload(request({ file: encodeFit(fullRide(11, START + 7200e3)) }), d)).json();
	assert.equal(faster.events[0].times[0].improved, true);
	assert.equal(JSON.parse(d.store.data.get('test/e1/tom-c/lap')).time, '6:04');
	assert.equal(d.hooks.length, 2);
});

test('upload: rejections', async () => {
	const d = deps();
	const status = async (r) => (await handleUpload(r, d)).status;
	assert.equal(await status(request({ file: encodeFit(fullRide()), token: '0000000000000000' })), 403);
	assert.equal(await status(request({ file: encodeFit(fullRide()), member: 'stranger', token: tokenFor('stranger') })), 403);
	assert.equal(await status(request({})), 400, 'no file');
	assert.equal(await status(request({ file: encodeFit(fullRide()), name: 'ride.gpx' })), 400);
	assert.equal(await status(request({ file: Buffer.alloc(MAX_BYTES + 1) })), 413);
	assert.equal(await status(request({ file: Buffer.from('not a fit file at all') })), 422);
	assert.equal(await status(request({ file: encodeFit(partRide()) })), 422, 'no full ride of the route');
	assert.equal(await status(request({ file: encodeFit(fullRide(10, Date.parse('2026-12-01T10:00:00Z'))) })), 422, 'outside every window');
	assert.equal(await status(new Request('https://example.test/api/submit')), 405);
	assert.equal(d.store.data.size, 0, 'nothing stored for a rejected upload');
	assert.equal((await handleUpload(request({ file: encodeFit(fullRide()) }), { ...d, secret: undefined })).status, 500);
});

// --- The submissions results source ---

test('submissions source: reads the rows file, and is empty (or required) when missing', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irl-'));
	const file = path.join(dir, 'submissions.json');
	const infos = [];
	assert.deepEqual(await submissionsSource(file, { info: (m) => infos.push(m) }).load(), []);
	assert.equal(infos.length, 1);
	assert.throws(() => submissionsSource(file, { required: true }).load(), /should have written it/);

	fs.writeFileSync(file, JSON.stringify([{ event: 'e1', member: 'tom-c', segment: 'lap', time: '6:53', date: '2026-10-19', source: 'fit', extra: 'dropped' }]));
	assert.deepEqual(await submissionsSource(file).load(), [{ event: 'e1', member: 'tom-c', segment: 'lap', time: '6:53', date: '2026-10-19', source: 'fit' }]);
	fs.rmSync(dir, { recursive: true });
});

// --- Optional: a real Zwift FIT file ---

const REAL_FIT = path.join(__dirname, 'fixtures', 'figure-8.fit');
test('real Figure 8 ride matches Strava (needs test/fixtures/figure-8.fit and length_m)', { skip: !fs.existsSync(REAL_FIT) && 'no test/fixtures/figure-8.fit' }, async (t) => {
	const { timeRoute, roundUp } = require('../lib/fit/timing');
	const yaml = require('js-yaml');
	// Use the real routes.yml if the data repo is cloned, so length_m is filled in.
	const { dir } = require('../lib/data-dir');
	const route = yaml.load(fs.readFileSync(path.join(dir, 'routes.yml'), 'utf8')).find((r) => r.id === 'watopia-figure-8');
	const unmeasured = Object.entries(route.segments).filter(([, s]) => !(s.length_m > 0)).map(([k]) => k);
	if (unmeasured.length) {
		t.skip(`watopia-figure-8 has no length_m on ${unmeasured.join(', ')}`);
		return;
	}
	const { track } = await readFit(fs.readFileSync(REAL_FIT));
	const { times } = timeRoute(track, route);
	const got = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, roundUp(v)]));
	assert.deepEqual(got, { lap: 54 * 60 + 24, kom_rev: 4 * 60 + 59, kom: 2 * 60 + 51, sprint: 28 });
});
