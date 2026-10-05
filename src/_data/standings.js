// Loads league data (private repo cloned to src/_data/league, or sample-data/
// as a fallback), runs the handicap model and returns template-ready data.
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { computeStandings, formatTime, WEIGHTS } = require('../../lib/model');
const { loadClubs, clubFor } = require('../../lib/clubs');
const { validateMembers } = require('../../lib/members');
const { usingSample, dir, CLUB_LOGO_DIR, CLUB_LOGO_URL } = require('../../lib/data-dir');

function load(dir, file) {
	const p = path.join(dir, file);
	return fs.existsSync(p) ? yaml.load(fs.readFileSync(p, 'utf8')) || [] : [];
}

function loadEvents(dir) {
	const eventsDir = path.join(dir, 'events');
	if (!fs.existsSync(eventsDir)) {
		return [];
	}
	return fs
		.readdirSync(eventsDir)
		.filter((f) => /\.ya?ml$/.test(f))
		.map((f) => yaml.load(fs.readFileSync(path.join(eventsDir, f), 'utf8')));
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

module.exports = function () {
	if (usingSample) {
		console.warn('[standings] src/_data/league/ not found — building from sample-data/');
	}

	const leagues = load(dir, 'leagues.yml');
	const members = load(dir, 'members.yml');
	const routes = load(dir, 'routes.yml');
	const events = loadEvents(dir);
	const memberCheck = validateMembers(members);
	memberCheck.warnings.forEach((w) => console.warn(`[standings] ${w}`));
	if (memberCheck.errors.length) {
		throw new Error(`[standings] members.yml: ${memberCheck.errors.join('; ')}`);
	}
	const clubs = loadClubs(load(dir, 'clubs.yml'), {
		logoExists: (file) => fs.existsSync(path.join(dir, CLUB_LOGO_DIR, file)),
		logoUrl: CLUB_LOGO_URL,
	});
	clubs.warnings.forEach((w) => console.warn(`[standings] ${w}`));
	const today = new Date().toISOString().slice(0, 10);

	const out = {
		usingSample,
		leagues: [],
		events: [],
		// One public page per club. Leagues are deliberately not listed (their URLs are secret).
		clubs: [...clubs.byId.values()],
	};

	for (const league of leagues) {
		const result = computeStandings(league, members, routes, events);
		result.warnings.forEach((w) => console.warn(`[standings] ${w}`));
		const { club, warning: clubWarning } = clubFor(league, clubs.byId);
		if (clubWarning) {
			console.warn(`[standings] ${clubWarning}`);
		}

		const leagueEvents = result.events.map((e, i) => {
			// Strip internal fields so nothing raw can reach a template.
			const results = markTies(e.results.map(({ _raw, _blended, ...r }) => r));
			const leader = results.length ? results[0].adjusted : null;
			results.forEach((r) => {
				r.gapDisplay = r.adjusted - leader >= 0.5 ? `+${formatTime(r.adjusted - leader)}` : null;
			});
			return {
				...e,
				status: status(e.window, today),
				daysLeft: daysBetween(today, e.window.to) + 1,
				number: e.type === 'event' ? result.events.slice(0, i + 1).filter((x) => x.type === 'event').length : null,
				league: { slug: league.slug, name: league.name, club },
				participation: result.settings.points.participation,
				segmentBonus: result.settings.segment_bonus,
				weights: e.route_type ? WEIGHTS[e.route_type] : null,
				results,
				segments: e.segments.map((s) => ({ ...s, results: markTies(s.results) })),
			};
		});

		const normal = leagueEvents.filter((e) => e.type !== 'qualifier');
		const closed = normal.filter((e) => e.status === 'closed');
		const qualifier = leagueEvents.find((e) => e.id === league.qualifier) || null;
		const pts = result.settings.points;
		out.leagues.push({
			slug: league.slug,
			name: league.name,
			platform: league.platform,
			club,
			target_minutes: league.target_minutes,
			riders: (league.members || []).length,
			table: markTies(result.table),
			events: leagueEvents,
			eventColumns: normal,
			eventsDone: closed.length,
			lastClosed: closed.length ? closed[closed.length - 1] : null,
			current: leagueEvents.find((e) => e.status === 'open') || null,
			next: leagueEvents.find((e) => e.status === 'upcoming') || null,
			// League-specific settings, shown in the Rules section of the league page.
			rules: {
				points: pts,
				// Place at which finishing points bottom out at the minimum.
				floorPlace: pts.step > 0 ? Math.ceil((pts.first - pts.min) / pts.step) + 1 : null,
				segmentBonus: result.settings.segment_bonus,
				dropWorst: result.settings.drop_worst,
				targetMinutes: league.target_minutes || null,
				qualifier: qualifier ? { id: qualifier.id, route: qualifier.route, window: qualifier.window } : null,
				challenge: (() => {
					const c = leagueEvents.find((e) => e.type === 'challenge');
					return c ? { id: c.id, route: c.route, window: c.window } : null;
				})(),
			},
		});
		out.events.push(...leagueEvents);
	}

	return out;
};
