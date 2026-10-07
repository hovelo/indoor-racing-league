// Synthetic rides for the FIT timing tests: a path in metres around an origin,
// ridden at a given speed per leg and sampled once a second, like a Zwift FIT file.
const ORIGIN = [-11.64, 166.95]; // Watopia-ish
const R = 6371008.8;

/** Metres east/north of ORIGIN → [lat, lon]. */
function toLatLon(x, y, origin = ORIGIN) {
	const lat = origin[0] + (y / R) * (180 / Math.PI);
	const lon = origin[1] + (x / (R * Math.cos((origin[0] * Math.PI) / 180))) * (180 / Math.PI);
	return [lat, lon];
}

/**
 * Ride a path. `legs` is [{ to: [x, y], v: m/s }, ...] starting from `from`.
 * Returns samples { t, lat, lon, dist } every second from `start` (ms).
 */
function ride(from, legs, { start = Date.parse('2026-10-20T18:00:00Z'), step = 1 } = {}) {
	// Piecewise-linear position as a function of time.
	const pieces = [];
	let pos = from;
	let t = 0;
	let d = 0;
	for (const { to, v } of legs) {
		const len = Math.hypot(to[0] - pos[0], to[1] - pos[1]);
		pieces.push({ from: pos, to, t0: t, t1: t + len / v, d0: d, len });
		t += len / v;
		d += len;
		pos = to;
	}
	const samples = [];
	for (let s = 0; s <= t; s += step) {
		const p = pieces.find((x) => s <= x.t1) || pieces[pieces.length - 1];
		const u = p.t1 > p.t0 ? (s - p.t0) / (p.t1 - p.t0) : 1;
		const x = p.from[0] + u * (p.to[0] - p.from[0]);
		const y = p.from[1] + u * (p.to[1] - p.from[1]);
		const [lat, lon] = toLatLon(x, y);
		samples.push({ t: start + s * 1000, lat, lon, dist: p.d0 + u * p.len });
	}
	return samples;
}

/** A segment between two points in metres, with its length. */
const segment = (start, end, length, extra = {}) => ({ start: toLatLon(...start), end: toLatLon(...end), length_m: length, ...extra });

module.exports = { ORIGIN, toLatLon, ride, segment };
