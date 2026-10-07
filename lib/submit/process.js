// The upload function's logic, without the HTTP, storage or FIT parsing, so it can
// be tested directly. netlify/functions/submit/submit.mjs wraps it.
const { isoDate, formatTime } = require('../model');
const { timeRoute, roundUp } = require('../fit/timing');
const { verifyToken } = require('./token');

class SubmitError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/**
 * What the upload function needs from the league data, built at deploy time by
 * scripts/build-submit-config.js. Member ids only: no names, Strava names or results.
 * Qualifiers are left out: only events and challenges take uploads.
 */
function buildSubmitConfig({ leagues, events, routes }) {
	const usedRoutes = new Set();
	const out = {
		leagues: leagues.map((l) => ({ id: l.id, slug: l.slug, members: l.members || [] })),
		events: events
			.filter((e) => e.type === 'event' || e.type === 'challenge')
			.map((e) => {
				usedRoutes.add(e.route);
				return {
					id: e.id,
					league: e.league,
					type: e.type,
					route: e.route,
					score_segment: e.score_segment || 'lap',
					window: { from: isoDate(e.window.from), to: isoDate(e.window.to) },
				};
			}),
		routes: {},
	};
	for (const r of routes.filter((x) => usedRoutes.has(x.id))) {
		out.routes[r.id] = {
			id: r.id,
			name: r.name,
			segments: Object.fromEntries(Object.entries(r.segments || {}).map(([k, s]) => [k, {
				name: s.name,
				start: s.start || null,
				end: s.end || null,
				length_m: s.length_m ?? null,
			}])),
		};
	}
	return out;
}

/** The league for a valid link, or a SubmitError: a good token, and the member still in the league. */
function authorise({ config, slug, member, token, secret }) {
	const league = config.leagues.find((l) => l.slug === slug);
	if (!league || typeof member !== 'string' || !verifyToken(secret, league.id, member, token)) {
		throw new SubmitError(403, 'This upload link isn\'t valid. Check you used the whole link you were sent.');
	}
	if (!league.members.includes(member)) {
		throw new SubmitError(403, 'This upload link isn\'t valid for this league any more.');
	}
	return league;
}

const describe = (from, to) => `${from} to ${to}`;

/**
 * Check the link, find the events the ride belongs to, and time it.
 * `ride` is { track, date } from lib/fit/parse.js.
 * Returns { league, events: [{ id, type, route, rows, times }], warnings }, where
 * `rows` are results rows for the store and `times` are for showing the rider.
 * Throws SubmitError for anything the rider needs to be told.
 */
function processRide({ config, slug, member, token, secret, ride }) {
	const league = authorise({ config, slug, member, token, secret });

	const open = config.events.filter((e) => e.league === league.id && ride.date >= e.window.from && ride.date <= e.window.to);
	if (!open.length) {
		throw new SubmitError(422, `This ride was on ${ride.date}, which isn't inside any event's window. Events can't be ridden late.`);
	}

	const warnings = [];
	const matched = [];
	const missed = [];
	for (const event of open) {
		const route = config.routes[event.route];
		if (!route) {
			warnings.push(`${event.id}: route ${event.route} isn't in the submit config`);
			continue;
		}
		const timed = timeRoute(ride.track, route);
		warnings.push(...timed.warnings.map((w) => `${event.id}: ${w}`));
		if (timed.times[event.score_segment] === undefined) {
			missed.push(route.name);
			continue;
		}
		const times = Object.entries(timed.times).map(([segment, raw]) => {
			const seconds = roundUp(raw);
			return { segment, name: route.segments[segment].name, seconds, time: formatTime(seconds) };
		});
		matched.push({
			id: event.id,
			type: event.type,
			route: route.name,
			window: event.window,
			times,
			rows: times.map((x) => ({ event: event.id, member, segment: x.segment, time: x.time, date: ride.date, source: 'fit' })),
		});
	}

	if (!matched.length) {
		const routes = [...new Set(missed)].join(' or ');
		const windows = open.map((e) => describe(e.window.from, e.window.to)).join(', ');
		throw new SubmitError(422, routes
			? `No full ride of ${routes} was found in this file (open: ${windows}). It has to be a complete ride of the route.`
			: 'This ride couldn\'t be timed. Let the league organiser know.');
	}
	return { league: league.id, events: matched, warnings };
}

/** The blob key for one stored result. */
const resultKey = (leagueId, row) => `${leagueId}/${row.event}/${row.member}/${row.segment}`;
const hashKey = (sha256) => `hashes/${sha256}`;

module.exports = { buildSubmitConfig, authorise, processRide, SubmitError, resultKey, hashKey };
