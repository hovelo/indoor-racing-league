// The upload endpoint as a plain (Request) → Response function, with its storage,
// secret, config and build hook passed in. netlify/functions/submit/submit.mjs
// supplies the real ones; tests pass an in-memory store.
const crypto = require('node:crypto');
const { readFit } = require('../fit/parse');
const { authorise, processRide, SubmitError } = require('./process');
const { isDuplicate, recordHash, saveRows } = require('./store');

const MAX_BYTES = 5 * 1024 * 1024;

const json = (status, body) => new Response(JSON.stringify(body), {
	status,
	headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const fail = (status, error) => json(status, { ok: false, error });

/**
 * deps: { config, secret, store, buildHook?, fetch?, log? }
 */
async function handleUpload(request, deps) {
	const { config, secret, store, buildHook, fetch = globalThis.fetch, log = console } = deps;
	if (request.method !== 'POST') {
		return fail(405, 'Upload a file with POST.');
	}
	if (!secret) {
		log.error('[submit] SUBMIT_SECRET is not set');
		return fail(500, 'Uploads aren\'t set up yet. Let the league organiser know.');
	}
	// Multipart overhead is small; refuse anything clearly over the limit before reading it.
	if (Number(request.headers.get('content-length')) > MAX_BYTES + 64 * 1024) {
		return fail(413, 'That file is too big. FIT files from Zwift are well under 5 MB.');
	}

	let form;
	try {
		form = await request.formData();
	} catch {
		return fail(400, 'Expected a file upload.');
	}
	const slug = form.get('league');
	const member = form.get('m');
	const token = form.get('t');
	const file = form.get('file');

	try {
		const league = authorise({ config, slug, member, token, secret });

		if (!file || typeof file === 'string') {
			return fail(400, 'Choose a .fit file to upload.');
		}
		if (form.getAll('file').length > 1) {
			return fail(400, 'Upload one file at a time.');
		}
		if (!/\.fit$/i.test(file.name || '')) {
			return fail(400, 'That isn\'t a .fit file. Zwift saves them in Documents/Zwift/Activities.');
		}
		if (file.size > MAX_BYTES) {
			return fail(413, 'That file is too big. FIT files from Zwift are well under 5 MB.');
		}

		const buffer = Buffer.from(await file.arrayBuffer());
		const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
		if (await isDuplicate(store, sha256)) {
			return fail(409, 'This file has already been uploaded.');
		}

		let ride;
		try {
			ride = await readFit(buffer);
		} catch (err) {
			throw new SubmitError(422, `${err.message}.`);
		}

		const result = processRide({ config, slug, member, token, secret, ride });
		result.warnings.forEach((w) => log.warn(`[submit] ${w}`));

		const saved = await saveRows(store, league.id, result.events.flatMap((e) => e.rows));
		await recordHash(store, sha256, league.id, member);
		const improved = saved.filter((s) => s.improved);

		let rebuild = false;
		if (improved.length && buildHook) {
			try {
				const res = await fetch(buildHook, { method: 'POST', body: '{}' });
				rebuild = res.ok;
				if (!res.ok) {
					log.error(`[submit] build hook returned ${res.status}`);
				}
			} catch (err) {
				log.error(`[submit] build hook failed: ${err.message}`);
			}
		} else if (improved.length) {
			log.warn('[submit] NETLIFY_BUILD_HOOK is not set, so the site won\'t rebuild');
		}
		log.log(`[submit] ${league.id}/${member}: ${ride.date}, ${improved.length} of ${saved.length} segment times improved`);

		const byKey = new Map(saved.map((s) => [`${s.row.event}/${s.row.segment}`, s]));
		return json(200, {
			ok: true,
			date: ride.date,
			rebuild,
			events: result.events.map((e) => ({
				id: e.id,
				type: e.type,
				route: e.route,
				times: e.times.map((x) => {
					const s = byKey.get(`${e.id}/${x.segment}`);
					return { segment: x.segment, name: x.name, time: x.time, improved: s.improved, previous: s.previous };
				}),
			})),
		});
	} catch (err) {
		if (err instanceof SubmitError) {
			return fail(err.status, err.message);
		}
		log.error(`[submit] ${err.stack || err}`);
		return fail(500, 'Something went wrong saving your ride. Try again, or let the league organiser know.');
	}
}

module.exports = { handleUpload, MAX_BYTES };
