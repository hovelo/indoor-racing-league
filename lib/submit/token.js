// Personal upload links: /l/{slug}/submit/?m={member}&t={token}, where the token is
// an HMAC of the league and member ids. Nothing is stored; rotating SUBMIT_SECRET
// invalidates every link.
const crypto = require('node:crypto');

const TOKEN_LENGTH = 16; // hex characters

function makeToken(secret, leagueId, memberId) {
	if (!secret) {
		throw new Error('SUBMIT_SECRET is not set');
	}
	// The separator keeps ("ab", "c") and ("a", "bc") from sharing a token.
	return crypto.createHmac('sha256', secret).update(`${leagueId}:${memberId}`).digest('hex').slice(0, TOKEN_LENGTH);
}

function verifyToken(secret, leagueId, memberId, token) {
	if (!secret || typeof token !== 'string' || !/^[0-9a-f]+$/.test(token) || token.length !== TOKEN_LENGTH) {
		return false;
	}
	const expected = Buffer.from(makeToken(secret, leagueId, memberId));
	return crypto.timingSafeEqual(expected, Buffer.from(token));
}

function submitPath(slug, memberId, token) {
	return `/l/${slug}/submit/?m=${encodeURIComponent(memberId)}&t=${token}`;
}

module.exports = { makeToken, verifyToken, submitPath, TOKEN_LENGTH };
