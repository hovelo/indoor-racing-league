/**
 * Handicap model — implements 02-handicap-model.md.
 *
 * Pure: computeStandings(league, members, routes, events, opts) -> result.
 * Work in seconds; round only for display.
 */

const ALPHA = 0.3;
const MIN_FINISHERS_FOR_UPDATE = 3;

const WEIGHTS = {
	flat: { climb: 0.10, flat: 0.80, sprint: 0.10 },
	rolling: { climb: 0.35, flat: 0.45, sprint: 0.20 },
	climbing: { climb: 0.90, flat: 0.05, sprint: 0.05 },
	// Short loops with a sharp hill, ridden repeatedly (challenges).
	punchy: { climb: 0.35, flat: 0.35, sprint: 0.30 },
};

const DEFAULT_SETTINGS = {
	points: { first: 15, step: 1, min: 1, participation: 2 },
	segment_bonus: [3, 2, 1],
	drop_worst: 0,
};

const STRAVA_SEGMENT_URL = 'https://www.strava.com/segments/';

function parseTime(t) {
	if (typeof t === 'number') {
		return t;
	}
	const parts = String(t).trim().split(':').map(Number);
	if (parts.some(Number.isNaN)) {
		throw new Error(`Bad time "${t}"`);
	}
	return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function formatTime(seconds) {
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** js-yaml turns bare YYYY-MM-DD into Date objects; normalise to ISO strings. */
function isoDate(d) {
	if (d instanceof Date) {
		return d.toISOString().slice(0, 10);
	}
	return String(d);
}

function median(values) {
	const v = [...values].sort((a, b) => a - b);
	if (!v.length) {
		return null;
	}
	const mid = Math.floor(v.length / 2);
	return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Segment key -> lap | climb | sprint */
function segmentType(key, seg) {
	const t = (seg && seg.type) || key;
	if (t === 'kom' || t === 'climb') {
		return 'climb';
	}
	if (t === 'lap' || t === 'sprint') {
		return t;
	}
	return null;
}

/**
 * Award places (ties share the higher place) for rows sorted ascending by `key`.
 * Values compared after rounding to the nearest second.
 */
function assignPlaces(rows, key) {
	let place = 0;
	let prev = null;
	rows.forEach((row, i) => {
		const v = Math.round(row[key]);
		if (v !== prev) {
			place = i + 1;
			prev = v;
		}
		row.place = place;
	});
	return rows;
}

/**
 * Points are a per-league decision, so each league should set them in
 * leagues.yml. The defaults are only a fallback, and using them warns.
 */
function mergeSettings(league, warn = () => {}) {
	const s = league.settings || {};
	if (!s.points) {
		warn('settings.points not set in leagues.yml, using defaults');
	}
	return {
		points: { ...DEFAULT_SETTINGS.points, ...(s.points || {}) },
		// qualifier_bonus is the old name, kept so existing leagues.yml files still work.
		segment_bonus: s.segment_bonus || s.qualifier_bonus || DEFAULT_SETTINGS.segment_bonus,
		drop_worst: s.drop_worst ?? DEFAULT_SETTINGS.drop_worst,
	};
}

/**
 * Validate and clean an event's results: membership, segment, window,
 * exclusions, and duplicate rows (keep fastest).
 * Returns Map(memberId -> { segmentKey -> seconds }).
 */
function cleanResults(event, route, leagueMemberIds, memberIndex, warn) {
	const best = new Map();
	const from = isoDate(event.window.from);
	const to = isoDate(event.window.to);

	for (const r of event.results || []) {
		const where = `${event.id}: ${r.member}/${r.segment}`;
		if (!memberIndex.has(r.member)) {
			warn(`${where} — unknown member`);
			continue;
		}
		if (!leagueMemberIds.has(r.member)) {
			warn(`${where} — member not in league ${event.league}`);
			continue;
		}
		if (!route.segments || !route.segments[r.segment]) {
			warn(`${where} — segment not on route ${route.id}`);
			continue;
		}
		const date = isoDate(r.date);
		if (date < from || date > to) {
			warn(`${where} — ${date} outside window ${from}–${to}, skipped`);
			continue;
		}
		if (r.excluded) {
			continue;
		}
		const secs = parseTime(r.time);
		const m = best.get(r.member) || {};
		if (m[r.segment] !== undefined) {
			warn(`${where} — duplicate row, keeping fastest`);
			m[r.segment] = Math.min(m[r.segment], secs);
		} else {
			m[r.segment] = secs;
		}
		best.set(r.member, m);
	}
	return best;
}

/** Collapse a rider's segment times into { lap, climb, sprint } (sums per type). */
function componentTimes(segTimes, route, scoreSegment) {
	const out = { lap: null, climb: null, sprint: null, complete: true };
	const counts = { climb: 0, sprint: 0 };
	const totals = { climb: 0, sprint: 0 };
	const needed = { climb: 0, sprint: 0 };

	for (const [key, seg] of Object.entries(route.segments || {})) {
		const type = segmentType(key, seg);
		if (type === 'climb' || type === 'sprint') {
			needed[type]++;
			if (segTimes[key] !== undefined) {
				counts[type]++;
				totals[type] += segTimes[key];
			}
		}
	}
	out.lap = segTimes[scoreSegment] ?? null;
	for (const t of ['climb', 'sprint']) {
		if (needed[t] && counts[t] === needed[t]) {
			out[t] = totals[t];
		} else if (needed[t]) {
			out.complete = false;
		}
	}
	return out;
}

/**
 * Which segments earn bonus points in an event. An explicit `bonus_segments`
 * list wins; otherwise a qualifier uses every climb and sprint segment on the
 * route, and a normal event has none. Route order is kept.
 */
function bonusSegmentKeys(event, route, warn) {
	const segs = route.segments || {};
	if (Array.isArray(event.bonus_segments)) {
		const keys = [];
		for (const key of event.bonus_segments) {
			if (segs[key]) {
				keys.push(key);
			} else {
				warn(`${event.id}: bonus segment "${key}" not on route ${route.id}`);
			}
		}
		return keys;
	}
	if (event.type !== 'qualifier') {
		return [];
	}
	return Object.entries(segs)
		.filter(([key, seg]) => ['climb', 'sprint'].includes(segmentType(key, seg)))
		.map(([key]) => key);
}

/**
 * Award segment bonus points on raw times: top N per segment get
 * settings.segment_bonus. Only riders in `eligible` (those with a full
 * route time) can score.
 * Returns { bonus: Map(id -> points), segments: [...] } for templates.
 */
function segmentUrl(seg) {
	return seg && seg.strava_segment_id ? `${STRAVA_SEGMENT_URL}${seg.strava_segment_id}` : null;
}

function scoreSegments(keys, route, best, eligible, settings, display) {
	const bonus = new Map();
	const segments = keys.map((key) => {
		const seg = route.segments[key] || {};
		const rows = [...eligible]
			.filter((id) => best.get(id)[key] !== undefined)
			.map((id) => ({ id, t: best.get(id)[key] }))
			.sort((a, b) => a.t - b.t || display(a.id).localeCompare(display(b.id)));
		assignPlaces(rows, 't');
		const results = rows.map((row) => {
			const points = settings.segment_bonus[row.place - 1] || 0;
			if (points) {
				bonus.set(row.id, (bonus.get(row.id) || 0) + points);
			}
			// No times here: segment times are raw, and the public site shows none.
			return { member: row.id, display: display(row.id), place: row.place, points };
		});
		return {
			key,
			type: segmentType(key, seg),
			name: seg.name || key,
			url: segmentUrl(seg),
			results,
		};
	});
	return { bonus, segments };
}

function computeStandings(league, members, routes, events, opts = {}) {
	const warnings = [];
	const warn = (msg) => warnings.push(`[${league.id}] ${msg}`);
	const alpha = opts.alpha ?? ALPHA;
	const minFinishers = opts.minFinishers ?? MIN_FINISHERS_FOR_UPDATE;
	const settings = mergeSettings(league, warn);
	const pts = settings.points;

	const memberIndex = new Map(members.map((m) => [m.id, m]));
	const leagueMemberIds = new Set(league.members || []);
	const routeIndex = new Map(routes.map((r) => [r.id, r]));
	const display = (id) => (memberIndex.get(id) || {}).display || id;

	const leagueEvents = events
		.filter((e) => e.league === league.id)
		.sort((a, b) => {
			const d = isoDate(a.window.to).localeCompare(isoDate(b.window.to));
			// A challenge spans several events, so score it after any event that closes the same day.
			const c = (a.type === 'challenge') - (b.type === 'challenge');
			return d || c || a.id.localeCompare(b.id);
		});

	const mainQualifier = leagueEvents.find((e) => e.id === league.qualifier);
	if (!mainQualifier || mainQualifier.type !== 'qualifier') {
		warn(`qualifier "${league.qualifier}" is not an existing event of type: qualifier`);
	}

	let medians = null; // frozen reference medians
	const ratios = new Map(); // memberId -> { climb, flat, sprint }
	const eventPoints = new Map(); // memberId -> [{ eventId, points, qualifier }]
	const addPoints = (id, eventId, points, qualifier) => {
		if (!eventPoints.has(id)) {
			eventPoints.set(id, []);
		}
		eventPoints.get(id).push({ eventId, points, qualifier });
	};

	const scored = [];

	for (const event of leagueEvents) {
		const route = routeIndex.get(event.route);
		if (!route) {
			warn(`${event.id}: unknown route ${event.route}`);
			continue;
		}
		checkWindow(event, warn);

		const scoreSegment = event.score_segment || 'lap';
		const best = cleanResults(event, route, leagueMemberIds, memberIndex, warn);

		if (event.type === 'qualifier') {
			const comps = new Map();
			for (const [id, segTimes] of best) {
				const c = componentTimes(segTimes, route, scoreSegment);
				if (c.lap === null) {
					warn(`${event.id}: ${id} has no ${scoreSegment} time, ignored`);
					continue;
				}
				comps.set(id, c);
			}

			// Freeze medians from the league's main qualifier only.
			if (event.id === league.qualifier && !medians) {
				const full = [...comps.values()].filter((c) => c.complete);
				medians = {
					lap: median([...comps.values()].map((c) => c.lap)),
					climb: median(full.map((c) => c.climb ?? 0)),
					sprint: median(full.map((c) => c.sprint ?? 0)),
					flat: median(full.map((c) => c.lap - (c.climb ?? 0) - (c.sprint ?? 0))),
				};
			}
			if (!medians) {
				warn(`${event.id}: qualifier before reference medians exist, skipped`);
				continue;
			}

			for (const [id, c] of comps) {
				if (!c.complete) {
					const r = c.lap / medians.lap;
					warn(`${event.id}: ${id} missing climb/sprint segment, using lap ratio ${r.toFixed(3)}`);
					ratios.set(id, { climb: r, flat: r, sprint: r });
					continue;
				}
				const flat = c.lap - (c.climb ?? 0) - (c.sprint ?? 0);
				ratios.set(id, {
					climb: c.climb !== null && medians.climb ? c.climb / medians.climb : flat / medians.flat,
					flat: flat / medians.flat,
					sprint: c.sprint !== null && medians.sprint ? c.sprint / medians.sprint : flat / medians.flat,
				});
			}

			// Points: participation + bonus on the designated segments.
			const { bonus, segments } = scoreSegments(
				bonusSegmentKeys(event, route, warn), route, best, [...comps.keys()], settings, display
			);

			const results = [...comps.keys()]
				.map((id) => {
					const b = bonus.get(id) || 0;
					const total = pts.participation + b;
					addPoints(id, event.id, total, true);
					return { member: id, display: display(id), bonus: b, points: total };
				})
				.sort((a, b) => b.points - a.points || a.display.localeCompare(b.display));

			scored.push({ ...baseEvent(event, route), results, segments });
			continue;
		}

		// Normal event, or a challenge (scored the same, but never moves benchmarks)
		const isChallenge = event.type === 'challenge';
		const weights = WEIGHTS[event.route_type];
		if (!weights) {
			warn(`${event.id}: route_type "${event.route_type}" missing or unknown, skipped`);
			continue;
		}

		const finishers = [];
		for (const [id, segTimes] of best) {
			const raw = segTimes[scoreSegment];
			if (raw === undefined) {
				warn(`${event.id}: ${id} has no ${scoreSegment} time`);
				continue;
			}
			finishers.push({ id, raw });
		}

		const { bonus, segments } = scoreSegments(
			bonusSegmentKeys(event, route, warn), route, best, finishers.map((f) => f.id), settings, display
		);

		const benchmarked = [];
		const unbenchmarked = [];
		for (const f of finishers) {
			const r = ratios.get(f.id);
			if (!r) {
				unbenchmarked.push(f);
				continue;
			}
			const blended = weights.climb * r.climb + weights.flat * r.flat + weights.sprint * r.sprint;
			benchmarked.push({ ...f, blended, adjusted: f.raw / blended });
		}

		benchmarked.sort((a, b) => a.adjusted - b.adjusted);
		assignPlaces(benchmarked, 'adjusted');
		for (const row of benchmarked) {
			row.finishPoints = Math.max(pts.first - pts.step * (row.place - 1), pts.min);
			row.bonus = bonus.get(row.id) || 0;
			row.points = row.finishPoints + pts.participation + row.bonus;
			addPoints(row.id, event.id, row.points, false);
		}

		unbenchmarked.sort((a, b) => a.raw - b.raw);
		assignPlaces(unbenchmarked, 'raw');
		// Unbenchmarked riders can't be ranked, but still get participation points,
		// plus any segment bonus (that's on raw times, so no benchmark needed).
		for (const row of unbenchmarked) {
			row.bonus = bonus.get(row.id) || 0;
			row.points = pts.participation + row.bonus;
			addPoints(row.id, event.id, row.points, false);
		}

		// Benchmark update
		// Challenges are short efforts ridden many times, so they don't update hour-long benchmarks.
		const updated = !isChallenge && finishers.length >= minFinishers;
		if (updated) {
			const eventMedian = median(finishers.map((f) => f.raw));
			for (const row of benchmarked) {
				const observed = row.raw / eventMedian;
				const error = observed / row.blended;
				const r = ratios.get(row.id);
				ratios.set(row.id, {
					climb: r.climb * (1 + alpha * weights.climb * (error - 1)),
					flat: r.flat * (1 + alpha * weights.flat * (error - 1)),
					sprint: r.sprint * (1 + alpha * weights.sprint * (error - 1)),
				});
				row.error = error;
			}
		}

		scored.push({
			...baseEvent(event, route),
			benchmarksUpdated: updated,
			results: benchmarked.map((r) => ({
				member: r.id,
				display: display(r.id),
				place: r.place,
				adjusted: r.adjusted,
				adjustedDisplay: formatTime(r.adjusted),
				finishPoints: r.finishPoints,
				bonus: r.bonus,
				points: r.points,
				// raw/blended kept for tests and build logs; templates must not render them
				_raw: r.raw,
				_blended: r.blended,
			})),
			unbenchmarked: unbenchmarked.map((r) => ({
				member: r.id,
				display: display(r.id),
				place: r.place,
				bonus: r.bonus,
				points: r.points,
			})),
			segments,
		});
	}

	const table = buildTable(league, scored, eventPoints, settings, display);

	return { events: scored, table, benchmarks: Object.fromEntries(ratios), medians, settings, warnings };
}

function baseEvent(event, route) {
	const scoreKey = event.score_segment || 'lap';
	const scoreSeg = (route.segments || {})[scoreKey];
	return {
		id: event.id,
		type: event.type,
		route: {
			id: route.id,
			name: route.name,
			world: route.world,
			platform: route.platform,
			info: route.info || null,
			distance_km: route.distance_km ?? null,
			elevation_m: route.elevation_m ?? null,
		},
		// The segment whose time is scored, linked so riders can see raw times on Strava.
		scoreSegment: scoreSeg ? { key: scoreKey, name: scoreSeg.name || scoreKey, url: segmentUrl(scoreSeg) } : null,
		laps: event.laps || null,
		route_type: event.route_type || null,
		window: { from: isoDate(event.window.from), to: isoDate(event.window.to) },
		notes: event.notes || null,
	};
}

function checkWindow(event, warn) {
	const from = new Date(`${isoDate(event.window.from)}T00:00:00Z`);
	const to = new Date(`${isoDate(event.window.to)}T00:00:00Z`);
	const days = Math.round((to - from) / 86400000);
	if (event.type === 'challenge') {
		// Any number of whole Monday–Sunday weeks (one "This week" screenshot per week).
		if (from.getUTCDay() !== 1 || to.getUTCDay() !== 0 || days < 6 || (days + 1) % 7) {
			warn(`${event.id}: challenge window should run Monday to Sunday over whole weeks`);
		}
		return;
	}
	if (from.getUTCDay() !== 1 || to.getUTCDay() !== 0 || days !== 13) {
		warn(`${event.id}: window should run Monday to the Sunday 13 days later`);
	}
}

function buildTable(league, scored, eventPoints, settings, display) {
	const normalIds = scored.filter((e) => e.type !== 'qualifier').map((e) => e.id);
	const ids = new Set([...(league.members || []), ...eventPoints.keys()]);

	const rows = [...ids].map((id) => {
		const entries = eventPoints.get(id) || [];
		const qualifierPts = entries.filter((e) => e.qualifier).reduce((a, e) => a + e.points, 0);
		const byEvent = Object.fromEntries(entries.filter((e) => !e.qualifier).map((e) => [e.eventId, e.points]));
		const eventScores = normalIds.map((eid) => byEvent[eid] || 0);
		const dropped = [...eventScores].sort((a, b) => a - b).slice(0, settings.drop_worst);
		const eventTotal = eventScores.reduce((a, b) => a + b, 0) - dropped.reduce((a, b) => a + b, 0);
		return {
			member: id,
			display: display(id),
			qualifier: qualifierPts,
			events: normalIds.map((eid) => byEvent[eid] ?? null),
			rides: eventScores.filter(Boolean).length,
			total: qualifierPts + eventTotal,
		};
	});

	rows.sort((a, b) => b.total - a.total || a.display.localeCompare(b.display));
	let place = 0;
	let prev = null;
	rows.forEach((row, i) => {
		if (row.total !== prev) {
			place = i + 1;
			prev = row.total;
		}
		row.place = place;
	});
	return rows;
}

module.exports = { computeStandings, parseTime, formatTime, median, WEIGHTS, isoDate };
