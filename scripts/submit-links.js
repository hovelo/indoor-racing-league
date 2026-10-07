#!/usr/bin/env node
// Prints each league member's personal FIT upload link, to send out by hand.
//
//   SUBMIT_SECRET=… node scripts/submit-links.js --base https://example.netlify.app [--league <id>]
//
// Reads leagues.yml and members.yml from the data repo clone (src/_data/league/), or
// sample-data/. SUBMIT_SECRET must match the one set in Netlify, or the links won't work.
const { load } = require('../lib/load-data');
const { usingSample } = require('../lib/data-dir');
const { makeToken, submitPath } = require('../lib/submit/token');

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : undefined;
}

const secret = process.env.SUBMIT_SECRET;
const base = (arg('base') || process.env.IRL_SITE_URL || '').replace(/\/$/, '');
const only = arg('league');
if (!secret) {
	console.error('Set SUBMIT_SECRET (the same value as in Netlify).');
	process.exit(1);
}
if (!base) {
	console.error('Pass --base https://your-site (or set IRL_SITE_URL).');
	process.exit(1);
}
if (usingSample) {
	console.warn('Note: using sample-data/, not the private data repo.\n');
}

const members = new Map(load('members.yml').map((m) => [m.id, m]));
const leagues = load('leagues.yml').filter((l) => !only || l.id === only);
if (!leagues.length) {
	console.error(only ? `No league with id "${only}".` : 'No leagues found.');
	process.exit(1);
}
for (const league of leagues) {
	console.log(`# ${league.name} (${league.id})`);
	for (const id of league.members || []) {
		const name = (members.get(id) || {}).display || `${id} (not in members.yml)`;
		console.log(`${name}\t${base}${submitPath(league.slug, id, makeToken(secret, league.id, id))}`);
	}
	console.log('');
}
