// Read the league YAML (private data repo, or sample-data/). Shared by standings.js
// and the scripts.
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { dir } = require('./data-dir');

function load(file, base = dir) {
	const p = path.join(base, file);
	return fs.existsSync(p) ? yaml.load(fs.readFileSync(p, 'utf8')) || [] : [];
}

function loadEvents(base = dir) {
	const eventsDir = path.join(base, 'events');
	if (!fs.existsSync(eventsDir)) {
		return [];
	}
	return fs
		.readdirSync(eventsDir)
		.filter((f) => /\.ya?ml$/.test(f))
		.map((f) => yaml.load(fs.readFileSync(path.join(eventsDir, f), 'utf8')));
}

module.exports = { load, loadEvents };
