// Reading and writing the `submissions` blob store. `store` is anything with the
// @netlify/blobs store methods used here (get, setJSON, list, delete), so tests can
// pass an in-memory one.
//
// Keys:
//   {league}/{event}/{member}/{segment}  → { event, member, segment, time, date, source: 'fit' }
//                                          (the rider's fastest upload so far)
//   hashes/{sha256}                      → { league, member } (rejects re-uploading a file)
const { parseTime } = require('../model');
const { resultKey, hashKey } = require('./process');

const STORE_NAME = 'submissions';
const ROW_FIELDS = ['event', 'member', 'segment', 'time', 'date', 'source'];
const pickRow = (row) => Object.fromEntries(ROW_FIELDS.map((k) => [k, row[k]]));

async function isDuplicate(store, sha256) {
	return (await store.get(hashKey(sha256), { type: 'json' })) !== null;
}

async function recordHash(store, sha256, leagueId, member) {
	await store.setJSON(hashKey(sha256), { league: leagueId, member });
}

/**
 * Store each row unless an equal or faster one is already there.
 * Returns [{ key, row, improved, previous }], `previous` being the stored time before.
 */
async function saveRows(store, leagueId, rows) {
	const out = [];
	for (const row of rows) {
		const key = resultKey(leagueId, row);
		const existing = await store.get(key, { type: 'json' });
		const improved = !existing || parseTime(row.time) < parseTime(existing.time);
		if (improved) {
			await store.setJSON(key, pickRow(row));
		}
		out.push({ key, row, improved, previous: existing ? existing.time : null });
	}
	return out;
}

/** Every stored result row (not the hashes), with its key. */
async function listRows(store, prefix = '') {
	const { blobs } = await store.list(prefix ? { prefix } : {});
	const rows = [];
	for (const { key } of blobs) {
		if (key.startsWith('hashes/')) {
			continue;
		}
		const value = await store.get(key, { type: 'json' });
		if (value) {
			rows.push({ key, ...value });
		}
	}
	return rows;
}

/** An in-memory store with the same methods, for tests and local runs. */
function memoryStore(initial = {}) {
	const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
	return {
		data,
		get: async (key, { type } = {}) => {
			if (!data.has(key)) {
				return null;
			}
			return type === 'json' ? JSON.parse(data.get(key)) : data.get(key);
		},
		setJSON: async (key, value) => {
			data.set(key, JSON.stringify(value));
		},
		delete: async (key) => {
			data.delete(key);
		},
		list: async ({ prefix = '' } = {}) => ({
			blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })),
			directories: [],
		}),
	};
}

module.exports = { STORE_NAME, isDuplicate, recordHash, saveRows, listRows, memoryStore, pickRow };
