// Segment timing from a ride's per-second track, using each segment's start and
// end points (see "How the FIT fallback uses the points" in 06-data-formats.md).
//
// A track is an array of samples in time order:
//   { t: milliseconds since epoch, lat, lon, dist?: metres ridden so far }
// `dist` is the device's own odometer (Zwift writes it to every FIT record). If any
// sample lacks it, distance is worked out from the positions instead.

const EARTH_RADIUS_M = 6371008.8;
const DEFAULTS = {
	radiusM: 25, // a pass of a point is an approach within this distance
	minLength: 0.9, // the end must be 90–110% of the segment's length after the start
	maxLength: 1.1,
};

const rad = (deg) => (deg * Math.PI) / 180;

/** Equirectangular projection around `origin` ([lat, lon]), in metres. Fine at segment scale. */
function projector([lat0, lon0]) {
	const k = Math.cos(rad(lat0));
	return (lat, lon) => ({
		x: rad(lon - lon0) * k * EARTH_RADIUS_M,
		y: rad(lat - lat0) * EARTH_RADIUS_M,
	});
}

function haversine(a, b) {
	const dLat = rad(b.lat - a.lat);
	const dLon = rad(b.lon - a.lon);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Samples with a usable position, plus an odometer on each (`d`). */
function prepare(track) {
	const samples = track.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && Number.isFinite(s.t));
	const useOdometer = samples.length > 0 && samples.every((s) => Number.isFinite(s.dist));
	let d = 0;
	return samples.map((s, i) => {
		if (useOdometer) {
			d = s.dist;
		} else if (i > 0) {
			d += haversine(samples[i - 1], s);
		}
		return { t: s.t, lat: s.lat, lon: s.lon, d };
	});
}

/**
 * Every pass of `point`: each run of consecutive track steps that come within
 * `radiusM`, reduced to its closest approach. Time and odometer are interpolated
 * along the step at the closest point, so passes aren't limited to whole seconds.
 */
function passes(samples, point, radiusM) {
	const project = projector(point);
	const out = [];
	let best = null; // closest approach in the current run
	for (let i = 0; i + 1 < samples.length; i++) {
		const a = samples[i];
		const b = samples[i + 1];
		const pa = project(a.lat, a.lon);
		const pb = project(b.lat, b.lon);
		const dx = pb.x - pa.x;
		const dy = pb.y - pa.y;
		const len2 = dx * dx + dy * dy;
		// Point is the origin of the projection, so project (0, 0) onto the step.
		const u = len2 > 0 ? Math.min(1, Math.max(0, -(pa.x * dx + pa.y * dy) / len2)) : 0;
		const gap = Math.hypot(pa.x + u * dx, pa.y + u * dy);
		if (gap <= radiusM) {
			if (!best || gap < best.gap) {
				best = { gap, t: a.t + u * (b.t - a.t), d: a.d + u * (b.d - a.d) };
			}
		} else if (best) {
			out.push(best);
			best = null;
		}
	}
	if (best) {
		out.push(best);
	}
	return out;
}

/**
 * Efforts on one segment: for each pass of the start, the first pass of the end
 * that is 90–110% of the segment's length further on. The length check stops a
 * route that crosses its own start line mid-route, or a reverse climb sharing a
 * summit with the forward climb, from producing a false effort.
 * Returns every effort's time in seconds (unrounded), fastest first.
 */
function segmentEfforts(samples, segment, opts = {}) {
	const { radiusM, minLength, maxLength } = { ...DEFAULTS, ...opts };
	const starts = passes(samples, segment.start, radiusM);
	const ends = passes(samples, segment.end, radiusM);
	const efforts = [];
	for (const s of starts) {
		const e = ends.find((x) => x.t > s.t
			&& x.d - s.d >= minLength * segment.length_m
			&& x.d - s.d <= maxLength * segment.length_m);
		if (e) {
			efforts.push((e.t - s.t) / 1000);
		}
	}
	return efforts.sort((a, b) => a - b);
}

const point = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

/**
 * Time every segment on a route. Each segment needs `start`, `end` and `length_m`;
 * a segment missing any of them is skipped with a warning. The fastest valid
 * effort counts, so on a lapped route it's the fastest lap.
 * Returns { times: { key: seconds }, warnings: [...] }.
 */
function timeRoute(track, route, opts = {}) {
	const samples = prepare(track);
	const times = {};
	const warnings = [];
	for (const [key, seg] of Object.entries(route.segments || {})) {
		if (!point(seg.start) || !point(seg.end)) {
			warnings.push(`${route.id}/${key}: no start/end points, skipped`);
			continue;
		}
		if (!(seg.length_m > 0)) {
			warnings.push(`${route.id}/${key}: no length_m, skipped`);
			continue;
		}
		const efforts = segmentEfforts(samples, seg, opts);
		if (efforts.length) {
			times[key] = efforts[0];
		}
	}
	return { times, warnings };
}

// Strava gives whole seconds and appears to round up: 54:23.7 → 54:24, 4:58.3 → 4:59,
// but 2:51.0 → 2:51 and 28.0 → 28. A 0.05 s allowance stops interpolation noise
// (171.0000001) from tipping an exact second up to the next one.
const ROUND_ALLOWANCE = 0.05;
const roundUp = (seconds) => Math.max(0, Math.ceil(seconds - ROUND_ALLOWANCE));

module.exports = { timeRoute, segmentEfforts, passes, prepare, roundUp, haversine };
