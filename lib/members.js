// Members: validation of members.yml. Pure, so it can be tested without touching the filesystem.
// strava_id (athlete ID) is the stable identity behind renames; strava_names are what
// screenshot matching uses. Neither ever reaches a template: the model only exposes `display`.

/**
 * @param {object[]} members  rows from members.yml
 * @returns {{ warnings: string[], errors: string[] }}
 *   errors are fatal (the build should fail); warnings are logged only.
 */
function validateMembers(members) {
	const warnings = [];
	const errors = [];
	const ids = new Map(); // strava_id -> member id
	const names = new Map(); // lower-cased Strava name -> member id

	for (const m of members || []) {
		if (!m || !m.id) {
			warnings.push('member without an id in members.yml');
			continue;
		}

		const sid = m.strava_id;
		if (sid === undefined || sid === null || sid === '') {
			warnings.push(`member "${m.id}" has no strava_id`);
		} else if (!/^[1-9]\d*$/.test(String(sid).trim())) {
			warnings.push(`member "${m.id}" has an invalid strava_id "${sid}" (expected a positive integer)`);
		} else {
			const key = String(sid).trim();
			if (ids.has(key)) {
				errors.push(`strava_id ${key} is on both "${ids.get(key)}" and "${m.id}": one person has two member records`);
			} else {
				ids.set(key, m.id);
			}
		}

		for (const name of m.strava_names || []) {
			const key = String(name).trim().toLowerCase();
			const owner = names.get(key);
			if (owner && owner !== m.id) {
				warnings.push(`Strava name "${name}" is on both "${owner}" and "${m.id}": screenshot matching is ambiguous`);
			} else {
				names.set(key, m.id);
			}
		}
	}

	return { warnings, errors };
}

module.exports = { validateMembers };
