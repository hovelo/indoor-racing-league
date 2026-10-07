// Results from FIT uploads. At deploy time the submissions build plugin
// (netlify/plugins/submissions) reads the `submissions` blob store and writes
// .submissions/submissions.json; with sample data, sample-data/submissions.json is
// used instead. Each entry is a stored row: { event, member, segment, time, date, source }.
const fs = require('node:fs');
const { pickRow } = require('../submit/store');

function submissionsSource(file, { required = false, info = () => {} } = {}) {
	return {
		name: 'submissions',
		load: () => {
			if (!fs.existsSync(file)) {
				if (required) {
					throw new Error(`[submissions] ${file} not found: the submissions build plugin should have written it`);
				}
				info(`no FIT submissions file (${file}), so no uploaded results`);
				return [];
			}
			const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
			if (!Array.isArray(rows)) {
				throw new Error(`[submissions] ${file} should hold an array of rows`);
			}
			return rows.map((r) => ({ ...pickRow(r), source: r.source || 'fit' }));
		},
	};
}

module.exports = { submissionsSource };
