// Read a FIT file into a track for lib/fit/timing.js. Only time, position and the
// odometer are kept; power, heart rate and everything else are dropped here.
const FitParser = require('fit-file-parser').default;

const londonDate = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(date);

/**
 * Returns { track: [{ t, lat, lon, dist }], date: 'YYYY-MM-DD' } where `date` is the
 * London date of the first record. Throws if the file can't be parsed or has no
 * records with a timestamp.
 */
async function readFit(buffer) {
	let data;
	try {
		data = await new FitParser({ mode: 'list', lengthUnit: 'm', speedUnit: 'm/s' }).parseAsync(buffer);
	} catch (err) {
		throw new Error(`Not a readable FIT file (${err && err.message ? err.message : err})`);
	}
	const records = (data.records || []).filter((r) => r.timestamp instanceof Date);
	if (!records.length) {
		throw new Error('The FIT file has no ride records');
	}
	const track = records.map((r) => ({
		t: r.timestamp.getTime(),
		lat: r.position_lat,
		lon: r.position_long,
		dist: r.distance,
	})).sort((a, b) => a.t - b.t);
	return { track, date: londonDate(new Date(track[0].t)) };
}

module.exports = { readFit, londonDate };
