#!/usr/bin/env node
// Inspect or remove FIT upload results in the `submissions` blob store.
//
//   node scripts/submissions.js list [--league <id>] [--event <id>] [--hashes]
//   node scripts/submissions.js delete <key>
//
// Needs NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN (a personal access token). After a
// delete it triggers a rebuild if NETLIFY_BUILD_HOOK is set.
//
// Keys are {league}/{event}/{member}/{segment}. Deleting a result doesn't delete the
// uploaded file's hash (hashes/{sha256}), so the same file can't simply be uploaded
// again; delete the hash too if you want the rider to re-upload it.
const { getStore } = require('@netlify/blobs');
const { STORE_NAME, listRows } = require('../lib/submit/store');

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
	const [command, key] = process.argv.slice(2);
	const { NETLIFY_SITE_ID: siteID, NETLIFY_AUTH_TOKEN: token, NETLIFY_BUILD_HOOK: hook } = process.env;
	if (!['list', 'delete'].includes(command) || (command === 'delete' && !key)) {
		console.error('Usage: submissions.js list [--league <id>] [--event <id>] [--hashes] | delete <key>');
		process.exit(1);
	}
	if (!siteID || !token) {
		console.error('Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN.');
		process.exit(1);
	}
	const store = getStore({ name: STORE_NAME, siteID, token, consistency: 'strong' });

	if (command === 'list') {
		const league = arg('league');
		const event = arg('event');
		if (process.argv.includes('--hashes')) {
			const { blobs } = await store.list({ prefix: 'hashes/' });
			for (const { key: k } of blobs) {
				const v = await store.get(k, { type: 'json' });
				console.log(`${k}\t${v ? `${v.league}/${v.member}` : ''}`);
			}
			return;
		}
		const rows = (await listRows(store, league ? `${league}/` : ''))
			.filter((r) => !event || r.event === event);
		for (const r of rows) {
			console.log(`${r.key}\t${r.time}\t${r.date}`);
		}
		console.log(`${rows.length} row(s)`);
		return;
	}

	if ((await store.get(key)) === null) {
		console.error(`No such key: ${key}`);
		process.exit(1);
	}
	await store.delete(key);
	console.log(`Deleted ${key}`);
	if (hook) {
		const res = await fetch(hook, { method: 'POST', body: '{}' });
		console.log(res.ok ? 'Rebuild triggered.' : `Build hook returned ${res.status}.`);
	} else {
		console.log('Set NETLIFY_BUILD_HOOK to rebuild automatically, or trigger a deploy so the standings update.');
	}
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
