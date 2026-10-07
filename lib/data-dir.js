// Where the league data lives: the private repo cloned into src/_data/league,
// or sample-data/ when it isn't there. Shared by standings.js and .eleventy.js.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PRIVATE_DIR = path.join(ROOT, 'src', '_data', 'league');
const SAMPLE_DIR = path.join(ROOT, 'sample-data');

const usingSample = !fs.existsSync(path.join(PRIVATE_DIR, 'leagues.yml'));

module.exports = {
	usingSample,
	dir: usingSample ? SAMPLE_DIR : PRIVATE_DIR,
	// FIT-upload results: written by the submissions build plugin from the `submissions`
	// blob store; with sample data, a fixture in sample-data/ instead.
	SUBMISSIONS_FILE: usingSample
		? path.join(SAMPLE_DIR, 'submissions.json')
		: path.join(ROOT, '.submissions', 'submissions.json'),
	// Club logos sit in <data>/clubs/ and are published here.
	CLUB_LOGO_DIR: 'clubs',
	CLUB_LOGO_URL: '/images/clubs/',
};
