// Reads the `submissions` blob store before the build and writes the stored rows to
// .submissions/submissions.json for standings.js (lib/sources/submissions.js).
// Blobs credentials are set automatically in build plugins (not in the build command
// itself), which is why this is a plugin. Build plugins can read any of the site's stores.
const fs = require('node:fs');
const path = require('node:path');
const { getStore } = require('@netlify/blobs');
const { STORE_NAME, listRows } = require('../../../lib/submit/store');

const OUT = path.join(__dirname, '..', '..', '..', '.submissions', 'submissions.json');

module.exports = {
	async onPreBuild({ utils }) {
		try {
			const rows = await listRows(getStore({ name: STORE_NAME, consistency: 'strong' }));
			fs.mkdirSync(path.dirname(OUT), { recursive: true });
			fs.writeFileSync(OUT, JSON.stringify(rows.map(({ key, ...row }) => row), null, '\t'));
			console.log(`[submissions] ${rows.length} uploaded result row(s)`);
		} catch (err) {
			// standings.js refuses a production build without the file, so riders' uploads
			// can't silently drop out of the standings.
			const msg = `Couldn't read the submissions blob store: ${err.message}`;
			if (process.env.CONTEXT === 'production') {
				utils.build.failBuild(msg, { error: err });
			} else {
				console.warn(`[submissions] ${msg}`);
			}
		}
	},
};
