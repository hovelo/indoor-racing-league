#!/usr/bin/env bash
# Clones the private data repo into src/_data/league using a read-only deploy key.
# DATA_DEPLOY_KEY: base64-encoded ed25519 private key (Netlify env var, Builds scope, Production only).
# The matching public key is a read-only deploy key on hovelo/indoor-racing-league-data.
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

mkdir -p ~/.ssh && chmod 700 ~/.ssh
printf '%s' "$DATA_DEPLOY_KEY" | base64 -d > ~/.ssh/irl_data
chmod 600 ~/.ssh/irl_data

# GitHub's published ed25519 host key, pinned rather than trusted via ssh-keyscan.
# Verify against https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' >> ~/.ssh/known_hosts

rm -rf src/_data/league
GIT_SSH_COMMAND='ssh -i ~/.ssh/irl_data -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes' \
	git clone --depth 1 --quiet git@github.com:hovelo/indoor-racing-league-data.git src/_data/league

rm -f ~/.ssh/irl_data
