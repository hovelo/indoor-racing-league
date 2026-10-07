// Encode a synthetic track as a FIT file (file_id plus one record per sample), so the
// upload handler can be tested end to end with fit-file-parser reading it back.
const { FitEncoder, FitBaseType } = require('fit-file-parser');

const semicircles = (deg) => Math.round((deg * 2 ** 31) / 180);

function encodeFit(track) {
	const enc = new FitEncoder();
	enc.writeMessage(0, [ // file_id
		{ number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 }, // type: activity
		{ number: 4, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(track[0].t)) },
	]);
	for (const s of track) {
		enc.writeMessage(20, [ // record
			{ number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(s.t)) },
			{ number: 0, size: 4, baseType: FitBaseType.Sint32, value: semicircles(s.lat) },
			{ number: 1, size: 4, baseType: FitBaseType.Sint32, value: semicircles(s.lon) },
			{ number: 5, size: 4, baseType: FitBaseType.Uint32, value: Math.round(s.dist * 100) }, // cm
		], 1);
	}
	return Buffer.from(enc.close());
}

module.exports = { encodeFit };
