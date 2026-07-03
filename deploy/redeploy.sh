#!/usr/bin/env bash
# =============================================================================
# GigaPDF — zero-downtime redeploy (laptop wrapper)
#
# Blue/green release deploy: builds a fresh timestamped release on the VPS
# while the site keeps serving from the current one, then switches nginx
# upstreams gracefully. A curl loop hammering the site during the whole
# deploy must see 0 non-200 responses.
#
#   1. Push HEAD to the production remote (bare repo /opt/gigapdf-repo.git)
#   2. Ship deploy/server-deploy.sh over SSH and run:
#        clone release → pnpm install → migrations → turbo build --force →
#        standalone sync → start inactive color → health gates (NRestarts) →
#        nginx upstream switch (graceful reload) → drain → stop old color →
#        celery/OCR restart → purge old releases (keep 3)
#   3. Smoke-check public endpoints + verify served HEAD == local HEAD
#
# Usage:
#   GIGAPDF_VPS_HOST=1.2.3.4 bash deploy/redeploy.sh            # full deploy
#   bash deploy/redeploy.sh --web-only     # skip celery restart (workers keep old code!)
#   bash deploy/redeploy.sh --skip-push    # assume the bare repo already has HEAD
#   bash deploy/redeploy.sh --strict       # fail on any smoke-check warning
#
# Rollback: bash deploy/rollback.sh   (switches back to the previous release <30s)
# Docs:     deploy/README.md
# =============================================================================

set -euo pipefail

VPS_USER="${GIGAPDF_VPS_USER:-ubuntu}"
VPS_HOST="${GIGAPDF_VPS_HOST:?GIGAPDF_VPS_HOST is required (e.g. 'export GIGAPDF_VPS_HOST=your.vps.example.com')}"
VPS_PATH="${GIGAPDF_VPS_PATH:-/opt/gigapdf}"
REMOTE="${GIGAPDF_REMOTE:-production}"
BRANCH="${GIGAPDF_BRANCH:-main}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SCRIPT="$SCRIPT_DIR/server-deploy.sh"
[ -f "$SERVER_SCRIPT" ] || { echo "[fail] $SERVER_SCRIPT missing" >&2; exit 1; }

WEB_ONLY=false
SKIP_PUSH=false
STRICT=false
for arg in "$@"; do
  case "$arg" in
    --web-only) WEB_ONLY=true ;;
    --skip-push) SKIP_PUSH=true ;;
    --skip-install) echo "[warn] --skip-install is obsolete (each release installs fresh from the pnpm store); ignored" >&2 ;;
    --strict) STRICT=true ;;
    -h|--help)
      sed -n '1,/^# ==/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "[warn] unknown flag: $arg" >&2 ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { printf "${BLUE}[info]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}[ ok ]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[warn]${NC} %s\n" "$*"; }
fail()  { printf "${RED}[fail]${NC} %s\n" "$*" >&2; exit 1; }

# ── 1. Push to production remote (bare repo on the VPS) ─────────────────────
SHA=$(git rev-parse HEAD)
if ! $SKIP_PUSH; then
  info "Pushing ${BRANCH} → ${REMOTE} (sha ${SHA:0:7})"
  git push "$REMOTE" "$BRANCH" 2>&1 | tail -3 || true
else
  info "Skipping push (--skip-push)"
fi

# ── 2. Ship server-deploy.sh and run the deploy in one SSH session ──────────
# The script version always matches this wrapper (both live in deploy/).
DEPLOY_FLAGS="--sha $SHA"
$WEB_ONLY && DEPLOY_FLAGS="$DEPLOY_FLAGS --skip-celery"

info "Connecting to ${VPS_USER}@${VPS_HOST} — release build runs while the site keeps serving"
ssh -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}" \
  "TMP=\$(mktemp /tmp/gigapdf-server-deploy.XXXXXX.sh) && cat > \"\$TMP\" && bash \"\$TMP\" deploy $DEPLOY_FLAGS; rc=\$?; rm -f \"\$TMP\"; exit \$rc" \
  < "$SERVER_SCRIPT" || fail "Remote deploy failed — site is still on the previous release (nothing was switched)"

# ── 3. Smoke checks ──────────────────────────────────────────────────────────
info "Smoke-testing public endpoints"
FAIL=0
# /gigapdf.wasm is the engine blob copied into public/ by apps/web's
# postinstall — a fresh release that missed it would break the editor.
# (The old /pdf-worker/pdf.worker.min.mjs check was a dead legacy artifact.)
for path in "" "/gigapdf.wasm" "/login"; do
  url="https://giga-pdf.com${path}"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo "000")
  if [[ "$code" =~ ^(200|3[0-9]{2})$ ]]; then
    ok "GET $url → $code"
  else
    warn "GET $url → $code"
    FAIL=$((FAIL + 1))
  fi
done

info "Verifying served HEAD"
# .release-sha (written at release creation) instead of git: the release is
# chowned to the service user, so git as ubuntu hits "dubious ownership".
REMOTE_HEAD=$(ssh "${VPS_USER}@${VPS_HOST}" "cat ${VPS_PATH}/current/.release-sha" 2>/dev/null || echo "?")
if [ "$SHA" = "$REMOTE_HEAD" ]; then
  ok "Served release HEAD matches local: ${SHA:0:7}"
else
  warn "Served HEAD (${REMOTE_HEAD:0:7}) differs from local (${SHA:0:7})"
  FAIL=$((FAIL + 1))
fi

if [ "$FAIL" -gt 0 ] && $STRICT; then
  fail "$FAIL check(s) failed (--strict)"
fi

if [ "$FAIL" -eq 0 ]; then
  ok "Deploy complete — all smoke checks passed."
else
  warn "Deploy complete with $FAIL warning(s) (pass --strict to fail)."
fi
