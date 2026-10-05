const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClubs, clubFor, stravaUrl } = require('../lib/clubs');

test('strava club accepts a slug, an ID or a URL', () => {
	assert.equal(stravaUrl('hovelo'), 'https://www.strava.com/clubs/hovelo');
	assert.equal(stravaUrl(123456), 'https://www.strava.com/clubs/123456');
	assert.equal(stravaUrl('https://www.strava.com/clubs/hovelo'), 'https://www.strava.com/clubs/hovelo');
	assert.equal(stravaUrl(null), null);
});

test('clubs load, resolve logos and warn on problems', () => {
	const { byId, warnings } = loadClubs(
		[
			{ id: 'a', name: 'Club A', logo: 'a.svg', strava: 'club-a' },
			{ id: 'b', name: 'Club B', logo: 'https://cdn.example/b.png' },
			{ id: 'c', name: 'Club C', logo: 'missing.svg', strava: 'c' },
			{ id: 'a', name: 'Dupe' },
		],
		{ logoExists: (f) => f === 'a.svg', logoUrl: '/images/clubs/' }
	);
	assert.deepEqual(byId.get('a'), { id: 'a', name: 'Club A', logo: '/images/clubs/a.svg', strava: 'https://www.strava.com/clubs/club-a', url: null });
	assert.equal(byId.get('b').logo, 'https://cdn.example/b.png');
	assert.equal(byId.get('c').logo, null);
	assert.ok(warnings.some((w) => w.includes('"b" has no Strava club')));
	assert.ok(warnings.some((w) => w.includes('missing.svg')));
	assert.ok(warnings.some((w) => w.includes('duplicate club "a"')));
});

test('a league finds its club, and an unknown club warns', () => {
	const { byId } = loadClubs([{ id: 'a', name: 'Club A', strava: 'a' }]);
	assert.equal(clubFor({ id: 'l', club: 'a' }, byId).club.name, 'Club A');
	assert.deepEqual(clubFor({ id: 'l' }, byId), { club: null, warning: null });
	const missing = clubFor({ id: 'l', club: 'zzz' }, byId);
	assert.equal(missing.club, null);
	assert.match(missing.warning, /club "zzz" not in clubs\.yml/);
});
