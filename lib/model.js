/**
 * Handicap model — implements 02-handicap-model.md.
 *
 * Pure: computeStandings(league, members, routes, events, opts) -> result.
 * opts: { today: 'YYYY-MM-DD' (for drop_worst), debug: true (adds _raw/_blended
 * to results, for tests only), minFinishers }.
 * Work in seconds; round only for display.
 */

const MIN_FINISHERS_FOR_UPDATE = 3;
const COMPONENTS = ['climb', 'flat', 'sprint'];

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
	segment_bonus_mode: 'handicap',
	drop_worst: 0,
	alpha: 0.3,
};

const SEGMENT_BONUS_MODES = ['handicap', 'raw'];

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
	let mode = s.segment_bonus_mode ?? DEFAULT_SETTINGS.segment_bonus_mode;
	if (!SEGMENT_BONUS_MODES.includes(mode)) {
		warn(`settings.segment_bonus_mode "${mode}" should be handicap or raw, using handicap`);
		mode = 'handicap';
	}
	return {
		points: { ...DEFAULT_SETTINGS.points, ...(s.points || {}) },
		// qualifier_bonus is the old name, kept so existing leagues.yml files still work.
		segment_bonus: s.segment_bonus || s.qualifier_bonus || DEFAULT_SETTINGS.segment_bonus,
		// Events and challenges rank bonus segments against each rider's benchmark
		// (handicap) or on raw times (raw). The qualifier is always raw.
		segment_bonus_mode: mode,
		drop_worst: s.drop_worst ?? DEFAULT_SETTINGS.drop_worst,
		// Benchmark update rate, fixed for the whole league.
		alpha: s.alpha ?? DEFAULT_SETTINGS.alpha,
	};
}

/**
 * Which components a league can handicap, decided by its qualifier route:
 * flat always (lap minus the rest), climb and sprint only if the route has
 * a segment of that type.
 */
function leagueComponents(route) {
	const types = new Set(Object.entries((route && route.segments) || {}).map(([key, seg]) => segmentType(key, seg)));
	return COMPONENTS.filter((c) => c === 'flat' || types.has(c));
}

/**
 * Route-type weights for a league. A component missing from the qualifier
 * gets weight 0 on every route type, and the rest are scaled to sum to 1.
 * With all three present the weights are used as they are.
 */
function leagueWeights(components) {
	if (components.length === COMPONENTS.length) {
		return WEIGHTS;
	}
	return Object.fromEntries(Object.entries(WEIGHTS).map(([type, w]) => {
		const sum = components.reduce((a, c) => a + w[c], 0);
		return [type, Object.fromEntries(COMPONENTS.map((c) => [c, components.includes(c) ? w[c] / sum : 0]))];
	}));
}

function blend(weights, r, components) {
	return components.reduce((a, c) => a + weights[c] * r[c], 0);
}

/**
 * Split the league qualifier's rows by date (02-handicap-model.md, "Late
 * qualifiers" and "No re-benchmarking"):
 * - before the window: skipped;
 * - in the window: the reference rows (medians and raw bonus);
 * - after the window, from a member with in-window rows: re-qualification, skipped;
 * - after the window, from anyone else: a late qualifier, benchmarked from the
 *   first event or challenge whose window starts after their first late ride.
 * `later` is the league's other events, in replay order.
 */
function splitQualifier(event, later, warn) {
	const from = isoDate(event.window.from);
	const to = isoDate(event.window.to);
	const lastTo = later.length ? later.map((e) => isoDate(e.window.to)).sort().pop() : null;
	const rows = event.results || [];

	const inWindow = [];
	const after = [];
	for (const r of rows) {
		const date = isoDate(r.date);
		if (date < from) {
			warn(`${event.id}: ${r.member}/${r.segment} — ${date} before window ${from}–${to}, skipped`);
		} else if (date <= to) {
			inWindow.push(r);
		} else {
			after.push(r);
		}
	}

	const qualified = new Set(inWindow.filter((r) => !r.excluded).map((r) => r.member));
	const lateRows = new Map();
	for (const r of after) {
		const date = isoDate(r.date);
		if (qualified.has(r.member)) {
			warn(`${event.id}: ${r.member}/${r.segment} — ${date} after the window, re-qualification ignored`);
			continue;
		}
		if (lastTo && date > lastTo) {
			warn(`${event.id}: ${r.member}/${r.segment} — ${date} after the league's last event window (${lastTo}), skipped`);
			continue;
		}
		if (!lateRows.has(r.member)) {
			lateRows.set(r.member, []);
		}
		lateRows.get(r.member).push(r);
	}

	const late = new Map();
	for (const [id, list] of lateRows) {
		const firstDate = list.map((r) => isoDate(r.date)).sort()[0];
		const effective = later.find((e) => isoDate(e.window.from) > firstDate) || null;
		const kept = list.filter((r) => {
			const date = isoDate(r.date);
			if (effective && date >= isoDate(effective.window.from)) {
				warn(`${event.id}: ${id}/${r.segment} — late row ${date} is on or after ${effective.id} opens, skipped`);
				return false;
			}
			return true;
		});
		late.set(id, { rows: kept, firstDate, effective: effective ? effective.id : null });
	}

	return { inWindow, late };
}

/**
 * Validate and clean an event's results: membership, segment, window,
 * exclusions, and duplicate rows (keep fastest).
 * `rows` and `window` default to the event's own; the qualifier passes
 * subsets it has already split by date.
 * Returns Map(memberId -> { segmentKey -> seconds }).
 */
function cleanResults(event, route, leagueMemberIds, memberIndex, warn, rows = event.results, window = event.window) {
	const best = new Map();
	const from = isoDate(window.from);
	const to = isoDate(window.to);

	for (const r of rows || []) {
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

function segmentUrl(seg) {
	return seg && seg.strava_segment_id ? `${STRAVA_SEGMENT_URL}${seg.strava_segment_id}` : null;
}

/**
 * Award segment bonus points: top N per segment get settings.segment_bonus.
 * Only riders in `eligible` (those with a full route time) can score.
 * `divisor(id, type)` turns a raw segment time into the time that's ranked:
 * omitted for raw ranking, or the rider's ratio for that segment's type when
 * handicapped (Step 4b).
 * Returns { bonus: Map(id -> points), segments: [...] } for templates.
 */
function scoreSegments(keys, route, best, eligible, settings, display, divisor = null) {
	const bonus = new Map();
	const mode = divisor ? 'handicap' : 'raw';
	const segments = keys.map((key) => {
		const seg = route.segments[key] || {};
		const type = segmentType(key, seg);
		const rows = [...eligible]
			.filter((id) => best.get(id)[key] !== undefined)
			.map((id) => {
				const raw = best.get(id)[key];
				return { id, t: divisor ? raw / divisor(id, type) : raw };
			})
			.sort((a, b) => a.t - b.t || display(a.id).localeCompare(display(b.id)));
		assignPlaces(rows, 't');
		const results = rows.map((row) => {
			const points = settings.segment_bonus[row.place - 1] || 0;
			if (points) {
				bonus.set(row.id, (bonus.get(row.id) || 0) + points);
			}
			// No times here, raw or adjusted: the public site shows places and points only.
			return { member: row.id, display: display(row.id), place: row.place, points };
		});
		return {
			key,
			type,
			name: seg.name || key,
			url: segmentUrl(seg),
			mode,
			results,
		};
	});
	return { bonus, segments };
}

function computeStandings(league, members, routes, events, opts = {}) {
	const warnings = [];
	const info = [];
	const warn = (msg) => warnings.push(`[${league.id}] ${msg}`);
	const note = (msg) => info.push(`[${league.id}] ${msg}`);
	const minFinishers = opts.minFinishers ?? MIN_FINISHERS_FOR_UPDATE;
	const settings = mergeSettings(league, warn);
	const alpha = settings.alpha;
	const mode = settings.segment_bonus_mode;
	const pts = settings.points;

	const memberIndex = new Map(members.map((m) => [m.id, m]));
	const leagueMemberIds = new Set(league.members || []);
	const routeIndex = new Map(routes.map((r) => [r.id, r]));
	const display = (id) => (memberIndex.get(id) || {}).display || id;

	const leagueEvents = events
		.filter((e) => e.league === league.id)
		.filter((e) => {
			// One qualifier per league: no second qualifier, so no re-benchmarking.
			if (e.type === 'qualifier' && e.id !== league.qualifier) {
				warn(`${e.id}: league qualifier is "${league.qualifier}", so this qualifier is ignored`);
				return false;
			}
			return true;
		})
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

	// The qualifier route decides which components this league can handicap.
	const qualifierRoute = mainQualifier && routeIndex.get(mainQualifier.route);
	const components = qualifierRoute ? leagueComponents(qualifierRoute) : COMPONENTS;
	const weightsByType = leagueWeights(components);
	for (const c of COMPONENTS.filter((x) => !components.includes(x))) {
		warn(`qualifier route ${qualifierRoute.id} has no ${c} segment, so ${c} weights are 0 and the rest are renormalised`);
	}

	let medians = null; // frozen reference medians
	const ratios = new Map(); // memberId -> { climb?, flat, sprint? } (only the league's components)
	const pending = new Map(); // eventId -> [[memberId, ratios]]: late benchmarks waiting for that event

	/** Ratios from a rider's qualifier component times, against the frozen medians. */
	const qualifierRatios = (eventId, id, c) => {
		if (!c.complete) {
			const r = c.lap / medians.lap;
			warn(`${eventId}: ${id} missing climb/sprint segment, using lap ratio ${r.toFixed(3)}`);
			return Object.fromEntries(components.map((x) => [x, r]));
		}
		const flat = c.lap - (c.climb ?? 0) - (c.sprint ?? 0);
		const out = { flat: flat / medians.flat };
		for (const x of ['climb', 'sprint']) {
			if (components.includes(x)) {
				out[x] = c[x] / medians[x];
			}
		}
		return out;
	};
	const eventPoints = new Map(); // memberId -> [{ eventId, points, qualifier }]
	const addPoints = (id, eventId, points, qualifier) => {
		if (!eventPoints.has(id)) {
			eventPoints.set(id, []);
		}
		eventPoints.get(id).push({ eventId, points, qualifier });
	};

	const scored = [];
	const checkedRoutes = new Set();

	for (const event of leagueEvents) {
		// A late qualifier's benchmark enters the replay just before the event it's effective from.
		for (const [id, r] of pending.get(event.id) || []) {
			ratios.set(id, r);
		}

		const route = routeIndex.get(event.route);
		if (!route) {
			warn(`${event.id}: unknown route ${event.route}`);
			continue;
		}
		checkWindow(event, warn);
		if (!checkedRoutes.has(route.id)) {
			checkedRoutes.add(route.id);
			checkRoute(route, warn);
		}

		const scoreSegment = event.score_segment || 'lap';

		if (event.type === 'qualifier') {
			const later = leagueEvents.filter((e) => e.type !== 'qualifier');
			const split = splitQualifier(event, later, warn);
			const best = cleanResults(event, route, leagueMemberIds, memberIndex, warn, split.inWindow);
			const toComps = (bestMap) => {
				const comps = new Map();
				for (const [id, segTimes] of bestMap) {
					const c = componentTimes(segTimes, route, scoreSegment);
					if (c.lap === null) {
						warn(`${event.id}: ${id} has no ${scoreSegment} time, ignored`);
						continue;
					}
					comps.set(id, c);
				}
				return comps;
			};
			const comps = toComps(best);

			// Reference medians from in-window rides only, frozen for the league.
			const full = [...comps.values()].filter((c) => c.complete);
			medians = {
				lap: median([...comps.values()].map((c) => c.lap)),
				climb: components.includes('climb') ? median(full.map((c) => c.climb)) : null,
				sprint: components.includes('sprint') ? median(full.map((c) => c.sprint)) : null,
				flat: median(full.map((c) => c.lap - (c.climb ?? 0) - (c.sprint ?? 0))),
			};

			for (const [id, c] of comps) {
				ratios.set(id, qualifierRatios(event.id, id, c));
			}

			// Points: participation + raw bonus on the designated segments (in-window riders only).
			// Always raw, whatever segment_bonus_mode says: there's no benchmark yet.
			const { bonus, segments } = scoreSegments(
				bonusSegmentKeys(event, route, warn), route, best, [...comps.keys()], settings, display
			);

			const results = [...comps.keys()]
				.map((id) => {
					const b = bonus.get(id) || 0;
					const total = pts.participation + b;
					addPoints(id, event.id, total, true);
					return { member: id, display: display(id), bonus: b, points: total, late: false };
				})
				.sort((a, b) => b.points - a.points || a.display.localeCompare(b.display));

			// Late qualifiers: participation only, against the frozen medians, and
			// held back until the event their benchmark takes effect from.
			const lateResults = [];
			for (const [id, late] of split.late) {
				const lateBest = cleanResults(event, route, leagueMemberIds, memberIndex, warn, late.rows, {
					from: late.firstDate,
					to: '9999-12-31',
				});
				const c = toComps(lateBest).get(id);
				if (!c) {
					continue;
				}
				addPoints(id, event.id, pts.participation, true);
				lateResults.push({ member: id, display: display(id), bonus: 0, points: pts.participation, late: true });
				if (!late.effective) {
					warn(`${event.id}: late qualifier ${id} (${late.firstDate}) — no event starts after their ride, so no benchmark is used`);
					continue;
				}
				if (!medians.lap) {
					warn(`${event.id}: late qualifier ${id} — no in-window riders, so no reference medians to benchmark against`);
					continue;
				}
				if (!pending.has(late.effective)) {
					pending.set(late.effective, []);
				}
				pending.get(late.effective).push([id, qualifierRatios(event.id, id, c)]);
				note(`Late qualifier: ${id} (${late.firstDate}), benchmarked from ${late.effective}`);
			}
			lateResults.sort((a, b) => a.display.localeCompare(b.display));

			scored.push({ ...baseEvent(event, route), results: [...results, ...lateResults], segments });
			continue;
		}

		const best = cleanResults(event, route, leagueMemberIds, memberIndex, warn);

		// Normal event, or a challenge (scored the same, but never moves benchmarks)
		const isChallenge = event.type === 'challenge';
		const weights = weightsByType[event.route_type];
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

		const benchmarked = [];
		const unbenchmarked = [];
		for (const f of finishers) {
			const r = ratios.get(f.id);
			if (!r) {
				unbenchmarked.push(f);
				continue;
			}
			const blended = blend(weights, r, components);
			benchmarked.push({ ...f, blended, adjusted: f.raw / blended });
		}

		// Bonus segments (Step 4b). Handicapped: benchmarked riders only, each
		// segment adjusted by the pre-update ratio for its type. Raw: anyone
		// with a full route time, on raw times.
		const handicap = mode === 'handicap';
		let bonusKeys = bonusSegmentKeys(event, route, warn);
		if (handicap) {
			bonusKeys = bonusKeys.filter((key) => {
				const type = segmentType(key, route.segments[key]);
				if (!type) {
					warn(`${event.id}: bonus segment "${key}" has no type (lap, climb or sprint), so it can't be handicapped; not scored`);
					return false;
				}
				if (type !== 'lap' && !components.includes(type)) {
					warn(`${event.id}: bonus segment "${key}" is a ${type}, but the league's qualifier has no ${type} segment, so it can't be handicapped; not scored`);
					return false;
				}
				return true;
			});
		}
		const blendedById = new Map(benchmarked.map((row) => [row.id, row.blended]));
		const { bonus, segments } = handicap
			? scoreSegments(bonusKeys, route, best, benchmarked.map((row) => row.id), settings, display,
				(id, type) => (type === 'lap' ? blendedById.get(id) : ratios.get(id)[type]))
			: scoreSegments(bonusKeys, route, best, finishers.map((f) => f.id), settings, display);

		benchmarked.sort((a, b) => a.adjusted - b.adjusted);
		assignPlaces(benchmarked, 'adjusted');
		for (const row of benchmarked) {
			row.finishPoints = Math.max(pts.first - pts.step * (row.place - 1), pts.min);
			row.bonus = bonus.get(row.id) || 0;
			row.points = row.finishPoints + pts.participation + row.bonus;
			addPoints(row.id, event.id, row.points, false);
		}

		// Listed by name, never by raw time: their order would give away who was faster on the road.
		unbenchmarked.sort((a, b) => display(a.id).localeCompare(display(b.id)));
		// Unbenchmarked riders can't be ranked, but still get participation points.
		// In raw mode they can also score segment bonus (no benchmark needed); in
		// handicap mode they aren't in the segment rankings, so their bonus is 0.
		for (const row of unbenchmarked) {
			row.bonus = bonus.get(row.id) || 0;
			row.points = pts.participation + row.bonus;
			addPoints(row.id, event.id, row.points, false);
		}

		// Benchmark update (Step 5). Every factor is worked out from the
		// pre-event ratios first, then applied once, so the order doesn't matter.
		// Challenges are short efforts ridden many times, so they don't update hour-long benchmarks.
		const factors = new Map(benchmarked.map((row) => [row.id, Object.fromEntries(components.map((x) => [x, 1]))]));

		// Route update: each component moves in proportion to its weight; a missing component isn't touched.
		const updated = !isChallenge && finishers.length >= minFinishers;
		if (updated) {
			const eventMedian = median(finishers.map((f) => f.raw));
			for (const row of benchmarked) {
				const error = (row.raw / eventMedian) / row.blended;
				const f = factors.get(row.id);
				for (const x of components) {
					f[x] *= 1 + alpha * weights[x] * (error - 1);
				}
				row.error = error;
			}
		}

		// Bonus segment update: climb and sprint segments only (the route update
		// covers lap), full weight on that one component. The median is over
		// finishers (riders with a score segment time), as the route median is,
		// unbenchmarked finishers included.
		if (!isChallenge && handicap) {
			for (const segment of segments) {
				const { key, type } = segment;
				segment.benchmarksUpdated = false;
				if (type !== 'climb' && type !== 'sprint') {
					continue;
				}
				const times = finishers.map((f) => best.get(f.id)[key]).filter((t) => t !== undefined);
				if (times.length < minFinishers) {
					continue;
				}
				const segMedian = median(times);
				for (const row of benchmarked) {
					const raw = best.get(row.id)[key];
					if (raw === undefined) {
						continue;
					}
					const error = (raw / segMedian) / ratios.get(row.id)[type];
					factors.get(row.id)[type] *= 1 + alpha * (error - 1);
				}
				segment.benchmarksUpdated = true;
			}
		}

		for (const [id, f] of factors) {
			const r = ratios.get(id);
			ratios.set(id, Object.fromEntries(components.map((x) => [x, r[x] * f[x]])));
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
				// Raw and blended only with opts.debug (tests), so they can never reach a template.
				...(opts.debug ? { _raw: r.raw, _blended: r.blended } : {}),
			})),
			unbenchmarked: unbenchmarked.map((r) => ({
				member: r.id,
				display: display(r.id),
				bonus: r.bonus,
				points: r.points,
			})),
			segments,
		});
	}

	const table = buildTable(league, scored, eventPoints, settings, display, opts.today || null);

	return {
		events: scored,
		table,
		benchmarks: Object.fromEntries(ratios),
		medians,
		settings,
		components,
		weights: weightsByType,
		warnings,
		info,
	};
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

/** A segment whose type isn't recognised is silently left out of every sum, so say so. */
function checkRoute(route, warn) {
	for (const [key, seg] of Object.entries(route.segments || {})) {
		if (!segmentType(key, seg)) {
			warn(`route ${route.id}: segment "${key}" has ${seg && seg.type ? `unknown type "${seg.type}"` : 'no type'} (lap, climb or sprint), so it's ignored`);
		}
	}
}

function checkWindow(event, warn) {
	const from = new Date(`${isoDate(event.window.from)}T00:00:00Z`);
	const to = new Date(`${isoDate(event.window.to)}T00:00:00Z`);
	const days = Math.round((to - from) / 86400000);
	if (event.type === 'challenge' || event.type === 'qualifier') {
		// Any number of whole Monday–Sunday weeks (one "This week" screenshot per week).
		if (from.getUTCDay() !== 1 || to.getUTCDay() !== 0 || days < 6 || (days + 1) % 7) {
			warn(`${event.id}: ${event.type} window should run Monday to Sunday over whole weeks`);
		}
		return;
	}
	if (from.getUTCDay() !== 1 || to.getUTCDay() !== 0 || days !== 13) {
		warn(`${event.id}: window should run Monday to the Sunday 13 days later`);
	}
}

/**
 * Season table. drop_worst only considers events that have opened by `today`
 * (all of them when `today` isn't given): an upcoming event is a 0 for
 * everyone, so dropping it would hide the drop until the season's last event.
 */
function buildTable(league, scored, eventPoints, settings, display, today = null) {
	const normal = scored.filter((e) => e.type !== 'qualifier');
	const normalIds = normal.map((e) => e.id);
	const startedIds = normal.filter((e) => !today || e.window.from <= today).map((e) => e.id);
	const ids = new Set([...(league.members || []), ...eventPoints.keys()]);

	const rows = [...ids].map((id) => {
		const entries = eventPoints.get(id) || [];
		const qualifierPts = entries.filter((e) => e.qualifier).reduce((a, e) => a + e.points, 0);
		const byEvent = Object.fromEntries(entries.filter((e) => !e.qualifier).map((e) => [e.eventId, e.points]));
		const sum = (list) => list.reduce((a, b) => a + b, 0);
		// Missed events count as 0, so they're dropped first.
		const dropped = startedIds.map((eid) => byEvent[eid] || 0).sort((a, b) => a - b).slice(0, settings.drop_worst);
		return {
			member: id,
			display: display(id),
			qualifier: qualifierPts,
			events: normalIds.map((eid) => byEvent[eid] ?? null),
			total: qualifierPts + sum(normalIds.map((eid) => byEvent[eid] || 0)) - sum(dropped),
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

module.exports = { computeStandings, parseTime, formatTime, median, WEIGHTS, leagueWeights, isoDate };
