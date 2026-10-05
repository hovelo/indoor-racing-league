// Clubs: the group a league belongs to (name, logo, Strava club).
// Pure, so it can be tested without touching the filesystem.
const STRAVA_CLUB_URL = 'https://www.strava.com/clubs/';

const isUrl = (s) => /^https?:\/\//i.test(s);

// `strava` can be a full club URL or just the club's slug/ID ("hovelo", "123456").
function stravaUrl(value) {
	if (!value) {
		return null;
	}
	const v = String(value).trim();
	return isUrl(v) ? v : `${STRAVA_CLUB_URL}${encodeURIComponent(v)}`;
}

/**
 * @param {object[]} clubs     rows from clubs.yml
 * @param {object}   opts
 * @param {(file: string) => boolean} opts.logoExists  does <data>/clubs/<file> exist?
 * @param {string}   opts.logoUrl  public URL prefix for local logos
 * @returns {{ byId: Map<string, object>, warnings: string[] }}
 */
function loadClubs(clubs, { logoExists = () => true, logoUrl = '/images/clubs/' } = {}) {
	const byId = new Map();
	const warnings = [];
	for (const c of clubs || []) {
		if (!c || !c.id) {
			warnings.push('club without an id in clubs.yml');
			continue;
		}
		if (byId.has(c.id)) {
			warnings.push(`duplicate club "${c.id}" in clubs.yml; keeping the first`);
			continue;
		}
		if (!c.name) {
			warnings.push(`club "${c.id}" has no name`);
		}
		let logo = null;
		if (c.logo) {
			if (isUrl(c.logo)) {
				logo = c.logo;
			} else if (logoExists(c.logo)) {
				logo = logoUrl + c.logo;
			} else {
				warnings.push(`club "${c.id}": logo "${c.logo}" not found in clubs/`);
			}
		}
		const strava = stravaUrl(c.strava);
		if (!strava) {
			warnings.push(`club "${c.id}" has no Strava club; riders won't see where to join`);
		}
		byId.set(c.id, {
			id: c.id,
			name: c.name || c.id,
			logo,
			strava,
			url: c.url || null,
		});
	}
	return { byId, warnings };
}

// A league's club, or null. Warns when the league names a club that doesn't exist.
function clubFor(league, byId) {
	if (!league.club) {
		return { club: null, warning: null };
	}
	const club = byId.get(league.club) || null;
	return {
		club,
		warning: club ? null : `league "${league.id}": club "${league.club}" not in clubs.yml`,
	};
}

module.exports = { loadClubs, clubFor, stravaUrl };
