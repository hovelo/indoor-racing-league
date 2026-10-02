// Loads league data (private repo cloned to src/_data/league, or sample-data/
// as a fallback), runs the handicap model and returns template-ready data.
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { computeStandings } = require('../../lib/model');

const PRIVATE_DIR = path.join(__dirname, 'league');
const SAMPLE_DIR = path.join(__dirname, '..', '..', 'sample-data');

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

module.exports = function () {
	const usingSample = !fs.existsSync(path.join(PRIVATE_DIR, 'leagues.yml'));
	const dir = usingSample ? SAMPLE_DIR : PRIVATE_DIR;
	if (usingSample) {
		console.warn('[standings] src/_data/league/ not found — building from sample-data/');
	}

	const leagues = load(dir, 'leagues.yml');
	const members = load(dir, 'members.yml');
	const routes = load(dir, 'routes.yml');
	const events = loadEvents(dir);
	const today = new Date().toISOString().slice(0, 10);

	const out = { usingSample, leagues: [], events: [] };

	for (const league of leagues) {
		const result = computeStandings(league, members, routes, events);
		result.warnings.forEach((w) => console.warn(`[standings] ${w}`));

		const leagueEvents = result.events.map((e, i) => ({
			...e,
			status: status(e.window, today),
			number: e.type === 'qualifier' ? null : result.events.slice(0, i + 1).filter((x) => x.type !== 'qualifier').length,
			league: { slug: league.slug, name: league.name },
			// Strip internal fields so nothing raw can reach a template.
			results: e.results.map(({ _raw, _blended, ...r }) => r),
		}));

		out.leagues.push({
			slug: league.slug,
			name: league.name,
			platform: league.platform,
			target_minutes: league.target_minutes,
			table: result.table,
			events: leagueEvents,
			eventColumns: leagueEvents.filter((e) => e.type !== 'qualifier'),
		});
		out.events.push(...leagueEvents);
	}

	return out;
};
