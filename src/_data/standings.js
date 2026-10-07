// Loads league data (private repo cloned to src/_data/league, or sample-data/
// as a fallback), runs the handicap model and returns template-ready data.
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { computeStandings, formatTime } = require('../../lib/model');
const { loadClubs, clubFor } = require('../../lib/clubs');
const { validateMembers } = require('../../lib/members');
const { validateLeagues } = require('../../lib/leagues');
const { usingSample, dir, CLUB_LOGO_DIR, CLUB_LOGO_URL } = require('../../lib/data-dir');
const { gatherResults } = require('../../lib/sources');
const yamlSource = require('../../lib/sources/yaml');

// Where results rows come from. Every source returns rows of the same shape; they're
// merged (fastest per member, event and segment) before the model sees them.
const SOURCES = [yamlSource];

function load(file) {
	const p = path.join(dir, file);
	return fs.existsSync(p) ? yaml.load(fs.readFileSync(p, 'utf8')) || [] : [];
}

function loadEvents() {
	const eventsDir = path.join(dir, 'events');
	if (!fs.existsSync(eventsDir)) {
		return [];
	}
	return fs
		.readdirSync(eventsDir)
		.filter((f) => /\.ya?ml$/.test(f))
		.map((f) => yaml.load(fs.readFileSync(path.join(eventsDir, f), 'utf8')));
}

// Event windows are UK Monday–Sunday weeks, so "today" is the date in London, not UTC.
// IRL_TODAY=YYYY-MM-DD overrides it, for checking statuses locally.
function ukToday() {
	return process.env.IRL_TODAY
		|| new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

function status(window, today) {
	if (today < window.from) {
		return 'upcoming';
	}
	if (today > window.to) {
		return 'closed';
	}
	return 'open';
}

function daysBetween(fromIso, toIso) {
	return Math.round((new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86400000);
}

// Flag rows that share a place with another row, so templates can show "=2".
function markTies(rows) {
	const counts = new Map();
	rows.forEach((r) => counts.set(r.place, (counts.get(r.place) || 0) + 1));
	return rows.map((r) => ({ ...r, tied: counts.get(r.place) > 1 }));
}

// "Qualifier", "Challenge", "Event 02"; short forms for the events list ("Q", "C", "02")
// and the standings table header ("Q", "C", "E2").
function labels(type, number) {
	if (type === 'qualifier') {
		return { label: 'Qualifier', num: 'Q', column: 'Q' };
	}
	if (type === 'challenge') {
		return { label: 'Challenge', num: 'C', column: 'C' };
	}
	const padded = String(number).padStart(2, '0');
	return { label: `Event ${padded}`, num: padded, column: `E${number}` };
}

// Only these fields of a scored result reach a template. An allowlist, so a raw
// time added to the model later can't leak onto the public site by accident.
const pickResult = (r) => ({
	member: r.member,
	display: r.display,
	place: r.place,
	adjusted: r.adjusted,
	adjustedDisplay: r.adjustedDisplay,
	finishPoints: r.finishPoints,
	bonus: r.bonus,
	points: r.points,
	late: r.late,
});
const pickUnbenchmarked = (r) => ({ member: r.member, display: r.display, bonus: r.bonus, points: r.points });
const pickSegment = (s) => ({
	key: s.key,
	type: s.type,
	name: s.name,
	url: s.url,
	mode: s.mode,
	benchmarksUpdated: s.benchmarksUpdated,
	results: markTies(s.results.map((r) => ({ member: r.member, display: r.display, place: r.place, points: r.points }))),
});

module.exports = async function () {
	if (usingSample) {
		// fetch-data.sh refuses to build without the key, but a clone with no leagues.yml
		// (renamed, or a bad commit) would also land here. Never publish sample data.
		if (process.env.CONTEXT === 'production') {
			throw new Error('[standings] no leagues.yml in src/_data/league/ in a production build; refusing to publish sample data');
		}
		console.warn('[standings] src/_data/league/ not found — building from sample-data/');
	}

	const leagues = load('leagues.yml');
	const members = load('members.yml');
	const routes = load('routes.yml');
	const events = await gatherResults(loadEvents(), SOURCES, { leagues, members, routes, dir, usingSample },
		(w) => console.warn(`[standings] ${w}`));

	const leagueCheck = validateLeagues(leagues);
	if (leagueCheck.errors.length) {
		throw new Error(`[standings] leagues.yml: ${leagueCheck.errors.join('; ')}`);
	}
	const memberCheck = validateMembers(members);
	memberCheck.warnings.forEach((w) => console.warn(`[standings] ${w}`));
	if (memberCheck.errors.length) {
		throw new Error(`[standings] members.yml: ${memberCheck.errors.join('; ')}`);
	}
	const clubs = loadClubs(load('clubs.yml'), {
		logoExists: (file) => fs.existsSync(path.join(dir, CLUB_LOGO_DIR, file)),
		logoUrl: CLUB_LOGO_URL,
	});
	clubs.warnings.forEach((w) => console.warn(`[standings] ${w}`));
	const today = ukToday();

	const out = {
		usingSample,
		builtOn: today,
		leagues: [],
		events: [],
		// One public page per club. Leagues are deliberately not listed (their URLs are secret).
		clubs: [...clubs.byId.values()],
	};

	for (const league of leagues) {
		const result = computeStandings(league, members, routes, events, { today });
		result.warnings.forEach((w) => console.warn(`[standings] ${w}`));
		result.info.forEach((m) => console.log(`[standings] ${m}`));
		const { club, warning: clubWarning } = clubFor(league, clubs.byId);
		if (clubWarning) {
			console.warn(`[standings] ${clubWarning}`);
		}

		let eventNumber = 0;
		const leagueEvents = result.events.map((e) => {
			const number = e.type === 'event' ? ++eventNumber : null;
			const results = markTies(e.results.map(pickResult));
			const leader = results.length ? results[0].adjusted : null;
			results.forEach((r) => {
				r.gapDisplay = r.adjusted - leader >= 0.5 ? `+${formatTime(r.adjusted - leader)}` : null;
			});
			return {
				id: e.id,
				type: e.type,
				number,
				...labels(e.type, number),
				route: e.route,
				scoreSegment: e.scoreSegment,
				laps: e.laps,
				route_type: e.route_type,
				window: e.window,
				notes: e.notes,
				benchmarksUpdated: e.benchmarksUpdated || false,
				status: status(e.window, today),
				daysLeft: daysBetween(today, e.window.to) + 1,
				league: { slug: league.slug, name: league.name, club },
				participation: result.settings.points.participation,
				segmentBonus: result.settings.segment_bonus,
				// The league's weights: renormalised if its qualifier route lacks a climb or sprint.
				weights: e.route_type ? result.weights[e.route_type] || null : null,
				results,
				unbenchmarked: (e.unbenchmarked || []).map(pickUnbenchmarked),
				segments: e.segments.map(pickSegment),
			};
		});

		// Scoring order is chronological (a challenge scores after same-day events), but for
		// display the qualifier comes first, then any challenge, then the numbered events.
		const DISPLAY_RANK = { qualifier: 0, challenge: 1, event: 2 };
		const byDisplay = (list) => list
			.map((e, i) => ({ e, i }))
			.sort((a, b) => (DISPLAY_RANK[a.e.type] ?? 2) - (DISPLAY_RANK[b.e.type] ?? 2) || a.i - b.i)
			.map(({ e }) => e);
		const chronological = leagueEvents.filter((e) => e.type !== 'qualifier');
		const normal = byDisplay(chronological);
		const columnOrder = normal.map((e) => chronological.indexOf(e));
		const table = markTies(result.table).map((row) => ({ ...row, events: columnOrder.map((i) => row.events[i]) }));
		const closed = chronological.filter((e) => e.status === 'closed');
		// Feature the numbered event over a challenge open at the same time.
		const pick = (st) => leagueEvents.find((e) => e.status === st && e.type !== 'challenge')
			|| leagueEvents.find((e) => e.status === st) || null;
		const qualifier = leagueEvents.find((e) => e.id === league.qualifier) || null;
		const challenge = leagueEvents.find((e) => e.type === 'challenge') || null;
		const pts = result.settings.points;
		out.leagues.push({
			slug: league.slug,
			name: league.name,
			platform: league.platform,
			club,
			target_minutes: league.target_minutes,
			riders: (league.members || []).length,
			table,
			events: byDisplay(leagueEvents),
			eventColumns: normal,
			eventsDone: closed.length,
			lastClosed: closed.length ? closed[closed.length - 1] : null,
			current: pick('open'),
			next: pick('upcoming'),
			// League-specific settings, shown in the Rules section of the league page.
			rules: {
				points: pts,
				// Place at which finishing points bottom out at the minimum.
				floorPlace: pts.step > 0 ? Math.ceil((pts.first - pts.min) / pts.step) + 1 : null,
				segmentBonus: result.settings.segment_bonus,
				// handicap | raw: how event and challenge bonus segments are ranked (the qualifier is always raw).
				segmentBonusMode: result.settings.segment_bonus_mode,
				dropWorst: result.settings.drop_worst,
				targetMinutes: league.target_minutes || null,
				qualifier: qualifier ? { id: qualifier.id, route: qualifier.route, window: qualifier.window } : null,
				challenge: challenge ? { id: challenge.id, route: challenge.route, window: challenge.window } : null,
				// Any event ridden over several laps, where the fastest single lap is scored.
				lapped: leagueEvents.some((e) => e.laps > 1),
			},
		});
		out.events.push(...leagueEvents);
	}

	return out;
};
