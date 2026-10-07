// FIT upload endpoint. The logic is in lib/submit/handler.js; this wires in the
// blob store, the secret, the build hook and the generated league config.
import { getStore } from '@netlify/blobs';
import handler from '../../../lib/submit/handler.js';
import store from '../../../lib/submit/store.js';
import submitConfig from './submit-config.generated.mjs';

export default async (request) => handler.handleUpload(request, {
	config: submitConfig,
	secret: process.env.SUBMIT_SECRET,
	// Strong consistency: "fastest so far" and the duplicate-file check read what was just written.
	store: getStore({ name: store.STORE_NAME, consistency: 'strong' }),
	buildHook: process.env.NETLIFY_BUILD_HOOK,
});

export const config = {
	path: '/api/submit',
	method: 'POST',
};
