const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClubs, clubFor, stravaUrl, stravaClubId, clubSegmentUrl } = require('../lib/clubs');

test('strava club accepts a slug, an ID or a URL', () => {
	assert.equal(stravaUrl('sample-cc'), 'https://www.strava.com/clubs/sample-cc');
	assert.equal(stravaUrl(123456), 'https://www.strava.com/clubs/123456');
	assert.equal(stravaUrl('https://www.strava.com/clubs/sample-cc'), 'https://www.strava.com/clubs/sample-cc');
	assert.equal(stravaUrl(null), null);
});

test('clubs load, resolve logos and warn on problems', () => {
	const { byId, warnings } = loadClubs(
		[
			{ id: 'a', name: 'Club A', logo: 'a.svg', strava: 'club-a', strava_id: 94708 },
			{ id: 'b', name: 'Club B', logo: 'https://cdn.example/b.png' },
			{ id: 'c', name: 'Club C', logo: 'missing.svg', strava: 'c' },
			{ id: 'a', name: 'Dupe' },
		],
		{ logoExists: (f) => f === 'a.svg', logoUrl: '/images/clubs/' }
	);
	assert.deepEqual(byId.get('a'), { id: 'a', name: 'Club A', description: null, logo: '/images/clubs/a.svg', strava: 'https://www.strava.com/clubs/club-a', stravaId: 94708, url: null, page: '/clubs/a/' });
	assert.equal(byId.get('b').logo, 'https://cdn.example/b.png');
	assert.equal(byId.get('c').logo, null);
	assert.ok(warnings.some((w) => w.includes('"b" has no Strava club')));
	assert.ok(warnings.some((w) => w.includes('missing.svg')));
	assert.ok(warnings.some((w) => w.includes('duplicate club "a"')));
	assert.ok(warnings.some((w) => w.includes('"c" has no strava_id')));
	assert.ok(!warnings.some((w) => w.includes('"a" has no strava_id')));
});

test('strava club ID comes from strava_id, or a numeric strava', () => {
	assert.equal(stravaClubId({ strava: 'hovelo', strava_id: 94708 }), 94708);
	assert.equal(stravaClubId({ strava: '94708' }), 94708);
	assert.equal(stravaClubId({ strava: 'hovelo' }), null);
	assert.equal(stravaClubId({ strava: 'hovelo', strava_id: 'abc' }), null);
});

test('segment links filter to the club when it has a Strava ID', () => {
	const url = 'https://www.strava.com/segments/12118421';
	assert.equal(clubSegmentUrl(url, { stravaId: 94708 }), `${url}?filter=club&club_id=94708`);
	assert.equal(clubSegmentUrl(url, { stravaId: null }), url);
	assert.equal(clubSegmentUrl(url, null), url);
	assert.equal(clubSegmentUrl(null, { stravaId: 94708 }), null);
});

test('a league finds its club, and an unknown club warns', () => {
	const { byId } = loadClubs([{ id: 'a', name: 'Club A', strava: 'a' }]);
	assert.equal(clubFor({ id: 'l', club: 'a' }, byId).club.name, 'Club A');
	assert.deepEqual(clubFor({ id: 'l' }, byId), { club: null, warning: null });
	const missing = clubFor({ id: 'l', club: 'zzz' }, byId);
	assert.equal(missing.club, null);
	assert.match(missing.warning, /club "zzz" not in clubs\.yml/);
});
