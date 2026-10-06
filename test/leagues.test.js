const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLeagues } = require('../lib/leagues');

test('a valid league passes', () => {
	assert.deepEqual(validateLeagues([{ id: 'a', slug: 'k7f3q9x2m4' }]).errors, []);
});

test('a missing slug fails, rather than publishing /l/undefined/', () => {
	const { errors } = validateLeagues([{ id: 'a' }]);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /no slug/);
});

test('short, upper-case or odd-character slugs fail', () => {
	for (const slug of ['abc123', 'K7F3Q9X2M4', 'k7f3q9x2m4/x', 'k7f3 q9x2m4']) {
		assert.equal(validateLeagues([{ id: 'a', slug }]).errors.length, 1, slug);
	}
});

test('duplicate ids and slugs fail', () => {
	const { errors } = validateLeagues([
		{ id: 'a', slug: 'k7f3q9x2m4' },
		{ id: 'a', slug: 'k7f3q9x2m4' },
	]);
	assert.equal(errors.length, 2);
});
