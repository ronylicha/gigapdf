#!/usr/bin/env bash
# Forced-command target for the gigapdf CI deploy SSH key (auto-deploy on green main).
#
# INSTALL (this file is the source of truth → prod VPS):
#   sudo install -m 0755 deploy/gigapdf-ci-deploy.sh /usr/local/bin/gigapdf-ci-deploy.sh
# (deploy/server-deploy.sh re-installs it automatically on every deploy.)
# The prod deploy key's authorized_keys pins:
#   command="/usr/local/bin/gigapdf-ci-deploy.sh",no-port-forwarding,... <key>
# so a CI push can ONLY run this script.
#
# Blue/green generation: fetches github/main into the bare repo
# (/opt/gigapdf-repo.git, fast-forward only — never rewinds a laptop push),
# then runs deploy/server-deploy.sh from that exact commit. Zero-502 switch,
# health gates, automatic release purge. NO chown of /opt/gigapdf, NO restart
# of the legacy flat-clone units.
set -euo pipefail

BARE="/opt/gigapdf-repo.git"
SHARED_COPY="/opt/gigapdf/shared/bin/server-deploy.sh"
GITHUB_URL="https://github.com/QrCommunication/gigapdf.git"

echo "[ci-deploy] fetch github/main → bare repo (ff-only)"
git --git-dir="$BARE" remote get-url github >/dev/null 2>&1 || \
  git --git-dir="$BARE" remote add github "$GITHUB_URL"
# Non-forced refspec: refuses a non-fast-forward (bare ahead of GitHub) and
# aborts the deploy instead of silently deploying older code.
git --git-dir="$BARE" fetch github "refs/heads/main:refs/heads/main"

SHA=$(git --git-dir="$BARE" rev-parse refs/heads/main)
echo "[ci-deploy] deploying $SHA"

# Run the deploy logic from the commit being deployed; fall back to the
# server-cached copy for commits that predate deploy/server-deploy.sh.
TMP=$(mktemp /tmp/gigapdf-server-deploy.XXXXXX.sh)
trap 'rm -f "$TMP"' EXIT
if git --git-dir="$BARE" show "$SHA:deploy/server-deploy.sh" > "$TMP" 2>/dev/null; then
  echo "[ci-deploy] using deploy/server-deploy.sh from $SHA"
elif [ -x "$SHARED_COPY" ]; then
  echo "[ci-deploy] commit predates server-deploy.sh — using cached $SHARED_COPY"
  cp "$SHARED_COPY" "$TMP"
else
  echo "[ci-deploy] FATAL: no server-deploy.sh available (commit + cache both missing)" >&2
  exit 1
fi
bash "$TMP" deploy --sha "$SHA"
