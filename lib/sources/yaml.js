// The `results` rows in each event YAML file in the data repo (screenshots and
// manual entries). A row with no `source` is a screenshot row.
module.exports = {
	name: 'yaml',
	load: ({ events }) => events.flatMap((e) => (e.results || []).map((r) => ({
		...r,
		event: e.id,
		source: r.source || 'screenshot',
	}))),
};
