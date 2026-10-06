#!/usr/bin/env bash
# Clones the private data repo into src/_data/league using a read-only deploy key.
# DATA_DEPLOY_KEY: base64-encoded ed25519 private key (Netlify env var, Builds scope, Production only).
# The matching public key is a read-only deploy key on mikestreety/indoor-racing-league-data.
set -euo pipefail

if [[ -z "${DATA_DEPLOY_KEY:-}" ]]; then
	# Never publish sample data to production by accident.
	if [[ "${CONTEXT:-}" == "production" ]]; then
		echo "DATA_DEPLOY_KEY not set in production; refusing to build" >&2
		exit 1
	fi
	echo "DATA_DEPLOY_KEY not set; building with sample-data/" >&2
	exit 0
fi

# Key and known_hosts live in a private temp dir, removed however the script exits,
# so a failed clone can't leave the key behind and ~/.ssh is never touched.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
chmod 700 "$tmp"
printf '%s' "$DATA_DEPLOY_KEY" | base64 -d > "$tmp/key"
chmod 600 "$tmp/key"

# GitHub's published ed25519 host key, pinned rather than trusted via ssh-keyscan.
# Verify against https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$tmp/known_hosts"

rm -rf src/_data/league
GIT_SSH_COMMAND="ssh -i '$tmp/key' -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='$tmp/known_hosts'" \
	git clone --depth 1 --quiet git@github.com:mikestreety/indoor-racing-league-data.git src/_data/league

# A clone with no leagues.yml would otherwise fall back to sample data (standings.js also refuses in production).
if [[ ! -f src/_data/league/leagues.yml ]]; then
	echo "Cloned data repo has no leagues.yml; refusing to build" >&2
	exit 1
fi
