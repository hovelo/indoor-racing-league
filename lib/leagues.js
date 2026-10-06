// Leagues: validation of leagues.yml. Pure, so it can be tested without touching the filesystem.
// The slug is the only thing keeping a league page private, so a bad one fails the build.

// Long and unguessable: lower-case letters, digits and hyphens, 10 or more characters.
const SLUG_PATTERN = /^[a-z0-9-]{10,}$/;

/**
 * @param {object[]} leagues  rows from leagues.yml
 * @returns {{ errors: string[] }}  any error should fail the build
 */
function validateLeagues(leagues) {
	const errors = [];
	const ids = new Set();
	const slugs = new Set();

	for (const l of leagues || []) {
		const name = l && l.id ? `league "${l.id}"` : 'a league with no id';
		if (!l || !l.id) {
			errors.push('league without an id in leagues.yml');
		} else if (ids.has(l.id)) {
			errors.push(`duplicate league id "${l.id}"`);
		} else {
			ids.add(l.id);
		}

		const slug = l && l.slug !== undefined && l.slug !== null ? String(l.slug) : '';
		if (!slug) {
			errors.push(`${name} has no slug, so its page would be published at a guessable URL`);
		} else if (!SLUG_PATTERN.test(slug)) {
			errors.push(`${name}: slug "${slug}" should be 10 or more lower-case letters, digits or hyphens`);
		} else if (slugs.has(slug)) {
			errors.push(`${name}: slug "${slug}" is used by another league`);
		} else {
			slugs.add(slug);
		}
	}

	return { errors };
}

module.exports = { validateLeagues, SLUG_PATTERN };
