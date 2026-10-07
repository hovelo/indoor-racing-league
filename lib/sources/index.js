// Results sources. Each source produces result rows for events; standings.js
// gathers rows from every source, merges them, and hands the model events whose
// `results` hold the merged rows. The model never sees where a row came from.
//
// A source is an object:
//
//   {
//     name: 'yaml',
//     // ctx: { events, leagues, members, routes, dir, usingSample }
//     // Returns (or resolves to) an array of rows:
//     //   { event, member, segment, time, date, source, excluded?, reason? }
//     load: async (ctx) => [...],
//   }
//
// `event` is the event id the row belongs to. `source` is screenshot | fit | manual.
// Everything else has the same shape as a `results` row in an event YAML file.
const { isoDate, parseTime } = require('../model');

const SOURCES = ['screenshot', 'fit', 'manual'];

/**
 * Bucket a row for merging, so that merging never changes what the model would
 * do with the same rows unmerged (the model also keeps the fastest per member
 * and segment, but only after splitting rows by window):
 * - excluded rows are kept as they are (they're never scored);
 * - rows inside the event window merge per member and segment;
 * - rows after a qualifier's window are late-qualifier rows, whose dates matter
 *   (the first one decides which event the benchmark takes effect from), so they
 *   only merge with rows on the same date;
 * - anything else (before the window, after an event's window) is passed through
 *   for the model to warn about and skip.
 */
function mergeKey(row, event) {
	if (row.excluded) {
		return null;
	}
	const date = isoDate(row.date);
	const from = event.window ? isoDate(event.window.from) : null;
	const to = event.window ? isoDate(event.window.to) : null;
	const base = `${row.member}|${row.segment}`;
	if (from && date >= from && date <= to) {
		return `${base}|in`;
	}
	if (event.type === 'qualifier' && to && date > to) {
		return `${base}|${date}`;
	}
	return null;
}

/**
 * Merge rows for one event: for each member and segment keep the fastest row,
 * whatever its source, and warn on duplicates. Row order is kept (a replaced row
 * keeps the position of the first row for that key).
 */
function mergeRows(event, rows, warn = () => {}) {
	const out = [];
	const index = new Map(); // key -> position in out
	for (const row of rows) {
		const key = mergeKey(row, event);
		if (key === null) {
			out.push(row);
			continue;
		}
		if (!index.has(key)) {
			index.set(key, out.length);
			out.push(row);
			continue;
		}
		const i = index.get(key);
		const kept = out[i];
		const faster = parseTime(row.time) < parseTime(kept.time) ? row : kept;
		const sources = kept.source === row.source ? kept.source : `${kept.source} and ${row.source}`;
		warn(`${event.id}: ${row.member}/${row.segment} — duplicate row (${sources}), keeping fastest (${faster.source} ${faster.time})`);
		out[i] = faster;
	}
	return out;
}

/** Strip the routing field, so rows reaching the model look exactly like YAML rows (plus `source`). */
function toResultRow(row) {
	const { event, ...rest } = row;
	return rest;
}

/**
 * Gather rows from every source and return a copy of `events` with each event's
 * `results` replaced by its merged rows. Rows for unknown events, or with an
 * unknown `source`, are warned about and dropped.
 */
async function gatherResults(events, sources, ctx = {}, warn = () => {}) {
	const byEvent = new Map(events.map((e) => [e.id, []]));
	const eventIndex = new Map(events.map((e) => [e.id, e]));
	const leagueOf = (id) => (eventIndex.get(id) || {}).league;
	const prefixed = (id, msg) => warn(leagueOf(id) ? `[${leagueOf(id)}] ${msg}` : msg);

	for (const source of sources) {
		const rows = (await source.load({ ...ctx, events })) || [];
		for (const row of rows) {
			if (!byEvent.has(row.event)) {
				warn(`${source.name}: ${row.member}/${row.segment} — unknown event "${row.event}", skipped`);
				continue;
			}
			if (!SOURCES.includes(row.source)) {
				prefixed(row.event, `${row.event}: ${row.member}/${row.segment} — unknown source "${row.source}" from ${source.name}, skipped`);
				continue;
			}
			byEvent.get(row.event).push(row);
		}
	}

	return events.map((event) => ({
		...event,
		results: mergeRows(event, byEvent.get(event.id), (msg) => prefixed(event.id, msg)).map(toResultRow),
	}));
}

module.exports = { gatherResults, mergeRows, SOURCES };
