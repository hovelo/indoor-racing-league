const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMembers } = require('../lib/members');

test('valid members pass cleanly', () => {
	const out = validateMembers([
		{ id: 'a', strava_id: 101, strava_names: ['Ann Example'] },
		{ id: 'b', strava_id: '102', strava_names: ['Bob Example', 'Bobby E'] },
	]);
	assert.deepEqual(out, { warnings: [], errors: [] });
});

test('missing or invalid strava_id warns', () => {
	const { warnings, errors } = validateMembers([
		{ id: 'a', strava_names: ['A'] },
		{ id: 'b', strava_id: null },
		{ id: 'c', strava_id: 'abc' },
		{ id: 'd', strava_id: 0 },
	]);
	assert.equal(errors.length, 0);
	assert.equal(warnings.length, 4);
	assert.match(warnings[0], /"a" has no strava_id/);
	assert.match(warnings[2], /"c" has an invalid strava_id/);
});

test('duplicate strava_id is an error', () => {
	const { errors } = validateMembers([
		{ id: 'tom-c', strava_id: 555 },
		{ id: 'tom-c2', strava_id: '555' },
	]);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /555 is on both "tom-c" and "tom-c2"/);
});

test('a Strava name on two members warns', () => {
	const { warnings, errors } = validateMembers([
		{ id: 'a', strava_id: 1, strava_names: ['Sam Smith'] },
		{ id: 'b', strava_id: 2, strava_names: ['sam smith'] },
	]);
	assert.equal(errors.length, 0);
	assert.match(warnings[0], /ambiguous/);
});
