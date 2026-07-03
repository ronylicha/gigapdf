#!/usr/bin/env bash
# =============================================================================
# GigaPDF — rollback to the previous release (laptop wrapper, <30s)
#
# Switches nginx + services back to the INACTIVE color, whose symlink still
# points at the previous release (releases are kept on disk — keep 3).
# The same health gates as a deploy protect the switch: if the previous
# release fails to come up healthy, nothing is switched.
#
# Usage:
#   GIGAPDF_VPS_HOST=1.2.3.4 bash deploy/rollback.sh              # → previous release
#   GIGAPDF_VPS_HOST=1.2.3.4 bash deploy/rollback.sh --to blue    # explicit color
#
# Note: celery/OCR are restarted onto the rolled-back release too. The shared
# Python venv is NOT rolled back (requirements changes are rare; see README).
# =============================================================================

set -euo pipefail

VPS_USER="${GIGAPDF_VPS_USER:-ubuntu}"
VPS_HOST="${GIGAPDF_VPS_HOST:?GIGAPDF_VPS_HOST is required}"
VPS_PATH="${GIGAPDF_VPS_PATH:-/opt/gigapdf}"

TARGET="previous"
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TARGET="$2"; shift 2 ;;
    -h|--help) sed -n '1,/^# ==/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "[warn] unknown flag: $1" >&2; shift ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { printf "${BLUE}[info]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}[ ok ]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[warn]${NC} %s\n" "$*"; }
fail()  { printf "${RED}[fail]${NC} %s\n" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_COPY="$SCRIPT_DIR/server-deploy.sh"

# Prefer the server-cached copy (matches the deployed generation); fall back
# to piping the local copy if the cache is missing.
info "Rolling back on ${VPS_HOST} → ${TARGET}"
if ssh "${VPS_USER}@${VPS_HOST}" "test -x ${VPS_PATH}/shared/bin/server-deploy.sh"; then
  ssh "${VPS_USER}@${VPS_HOST}" "bash ${VPS_PATH}/shared/bin/server-deploy.sh switch --to ${TARGET}" \
    || fail "Rollback failed — check 'server-deploy.sh status' on the VPS"
elif [ -f "$LOCAL_COPY" ]; then
  warn "no cached server-deploy.sh on the VPS — piping local copy"
  ssh "${VPS_USER}@${VPS_HOST}" \
    "TMP=\$(mktemp /tmp/gigapdf-server-deploy.XXXXXX.sh) && cat > \"\$TMP\" && bash \"\$TMP\" switch --to ${TARGET}; rc=\$?; rm -f \"\$TMP\"; exit \$rc" \
    < "$LOCAL_COPY" || fail "Rollback failed"
else
  fail "no server-deploy.sh available (neither cached on VPS nor local)"
fi

info "Smoke-testing public endpoints"
FAIL=0
for path in "" "/login"; do
  url="https://giga-pdf.com${path}"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo "000")
  if [[ "$code" =~ ^(200|3[0-9]{2})$ ]]; then
    ok "GET $url → $code"
  else
    warn "GET $url → $code"
    FAIL=$((FAIL + 1))
  fi
done

SERVED=$(ssh "${VPS_USER}@${VPS_HOST}" "cat ${VPS_PATH}/current/.release-sha 2>/dev/null" || echo "?")
ok "Rollback done — now serving release HEAD ${SERVED}"
[ "$FAIL" -eq 0 ] || fail "$FAIL smoke check(s) failed after rollback"
