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
	// Club logos sit in <data>/clubs/ and are published here.
	CLUB_LOGO_DIR: 'clubs',
	CLUB_LOGO_URL: '/images/clubs/',
};
