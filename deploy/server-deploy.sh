#!/usr/bin/env bash
# =============================================================================
# GigaPDF — server-side blue/green release deploy (zero-502)
#
# Runs ON the VPS (as ubuntu, sudo NOPASSWD). Never run from a laptop.
# Invoked by:
#   - deploy/redeploy.sh   (laptop wrapper — pipes this file over SSH)
#   - /usr/local/bin/gigapdf-ci-deploy.sh (CI forced-command)
#   - deploy/rollback.sh   (laptop wrapper — uses the cached copy in shared/bin)
#
# Layout it manages under /opt/gigapdf:
#   releases/<ts>-<sha7>/   full git clone, built (keeps 3)
#   shared/env/gigapdf.env  single source of env (ubuntu:gigapdf 640)
#   shared/venv/            Python venv (uvicorn/celery/alembic)
#   shared/bin/             ocr_serve + cached copy of this script
#   shared/state/           active-color, history, hashes
#   blue -> releases/X      color slot (ports web 3000 / admin 3001 / api 8000)
#   green -> releases/Y     color slot (ports web 3010 / admin 3011 / api 8010)
#   current -> releases/Z   ACTIVE release (celery/ocr WorkingDirectory)
#
# The legacy flat clone files at /opt/gigapdf root are FROZEN (emergency
# fallback only — see deploy/README.md). This script never touches them.
#
# Usage:
#   server-deploy.sh deploy --sha <sha> [--from-github] [--skip-celery]
#   server-deploy.sh switch --to {blue|green|previous|legacy}
#   server-deploy.sh status
# =============================================================================

set -euo pipefail

ROOT="/opt/gigapdf"
BARE="/opt/gigapdf-repo.git"
SHARED="$ROOT/shared"
RELEASES="$ROOT/releases"
STATE="$SHARED/state"
ENV_FILE="$SHARED/env/gigapdf.env"
VENV="$SHARED/venv"
NGX_UPSTREAMS="/etc/nginx/gigapdf-upstreams.conf"
NGX_SITE="/etc/nginx/sites-available/gigapdf"
APP_USER="gigapdf"
APP_GROUP="gigapdf"
KEEP_RELEASES=3
MIN_FREE_GB=10
LOCK_FILE="/tmp/gigapdf-deploy.lock"
GITHUB_URL="https://github.com/QrCommunication/gigapdf.git"

BLUE_WEB=3000;  BLUE_ADMIN=3001;  BLUE_API=8000
GREEN_WEB=3010; GREEN_ADMIN=3011; GREEN_API=8010

RED='\033[0;31m'; GREEN_C='\033[0;32m'; YELLOW='\033[1;33m'; BLUE_C='\033[0;34m'; NC='\033[0m'
info() { printf "${BLUE_C}[info]${NC} %s\n" "$*"; }
ok()   { printf "${GREEN_C}[ ok ]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*"; }
die()  { printf "${RED}[fail]${NC} %s\n" "$*" >&2; exit 1; }
section() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }

port_of() { # $1=web|admin|api  $2=blue|green
  case "$1-$2" in
    web-blue)    echo "$BLUE_WEB" ;;
    admin-blue)  echo "$BLUE_ADMIN" ;;
    api-blue)    echo "$BLUE_API" ;;
    web-green)   echo "$GREEN_WEB" ;;
    admin-green) echo "$GREEN_ADMIN" ;;
    api-green)   echo "$GREEN_API" ;;
    *) die "port_of: bad args $1 $2" ;;
  esac
}
other_color() { [ "$1" = "blue" ] && echo green || echo blue; }
active_color() { cat "$STATE/active-color" 2>/dev/null || echo legacy; }
color_units() { echo "gigapdf-api-$1 gigapdf-web-$1 gigapdf-admin-$1"; }
LEGACY_UNITS="gigapdf-api gigapdf-web gigapdf-admin"

# ── Locking (flock on fd — auto-released on exit/crash) ─────────────────────
acquire_lock() {
  exec 200>"$LOCK_FILE"
  flock -n 200 || die "another deploy/switch is already running (lock: $LOCK_FILE)"
}

# ── Layout ───────────────────────────────────────────────────────────────────
ensure_layout() {
  mkdir -p "$RELEASES" "$SHARED/env" "$SHARED/bin" "$STATE"
  sudo mkdir -p /var/log/gigapdf /var/lib/gigapdf
}

self_install() {
  # Cache this script for rollback.sh + CI fallback (pre-commit transition).
  if ! cmp -s "$0" "$SHARED/bin/server-deploy.sh" 2>/dev/null; then
    install -m 0755 "$0" "$SHARED/bin/server-deploy.sh"
  fi
}

ensure_shared_env() {
  if [ ! -f "$ENV_FILE" ]; then
    [ -f "$ROOT/.env" ] || die "no $ROOT/.env to bootstrap $ENV_FILE from"
    cp "$ROOT/.env" "$ENV_FILE"
    ok "bootstrapped $ENV_FILE from legacy $ROOT/.env"
  fi
  # OCR keys (idempotent upsert — same policy as the legacy script)
  for kv in "OCR_MODELS_DIR=/var/lib/gigapdf/rten-models/models" \
            "OCR_BIND=127.0.0.1:8077" \
            "OCR_SERVICE_URL=http://127.0.0.1:8077"; do
    k="${kv%%=*}"
    grep -q "^$k=" "$ENV_FILE" || echo "$kv" >> "$ENV_FILE"
  done
  # A bare PORT= key would override the per-color Environment=PORT in the
  # systemd units (EnvironmentFile always wins) → both colors would bind the
  # same port. Refuse it outright.
  if grep -qE '^PORT=' "$ENV_FILE"; then
    die "$ENV_FILE contains a PORT= key — remove it (ports are per-color, set by systemd units)"
  fi
  sudo chown ubuntu:"$APP_GROUP" "$ENV_FILE"
  sudo chmod 640 "$ENV_FILE"
}

guard_disk() {
  local free_gb
  free_gb=$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc '0-9')
  [ "$free_gb" -ge "$MIN_FREE_GB" ] || die "only ${free_gb}G free on $ROOT (need ${MIN_FREE_GB}G) — purge releases first"
}

# ── Source / release creation ────────────────────────────────────────────────
fetch_github_into_bare() {
  git --git-dir="$BARE" remote get-url github >/dev/null 2>&1 || \
    git --git-dir="$BARE" remote add github "$GITHUB_URL"
  # Fast-forward only: refuses to rewind main if the bare repo is ahead
  # (a laptop push not yet on GitHub). A refused fetch aborts the CI deploy —
  # by design, never silently deploy older code.
  git --git-dir="$BARE" fetch github "refs/heads/main:refs/heads/main"
}

make_release() { # $1=sha → echoes release dir
  local sha="$1" ts rel
  git --git-dir="$BARE" rev-parse --verify --quiet "${sha}^{commit}" >/dev/null || \
    die "sha $sha not found in $BARE — did the push succeed?"
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  rel="$RELEASES/${ts}-${sha:0:7}"
  git clone --quiet "$BARE" "$rel"
  git -C "$rel" reset --hard --quiet "$sha"
  # Plain-file sha marker: once the release is chowned to the service user,
  # git refuses to read it as ubuntu ("dubious ownership") — every HEAD
  # verification (report, smoke checks, rollback) reads this file instead.
  echo "$sha" > "$rel/.release-sha"
  echo "$rel"
}

link_env() { # $1=release dir — MUST run before the build (NEXT_PUBLIC_* inlining)
  local rel="$1"
  ln -sfn "$ENV_FILE" "$rel/.env"
  ln -sfn "$ENV_FILE" "$rel/apps/web/.env"
  ln -sfn "$ENV_FILE" "$rel/apps/admin/.env"
}

ensure_venv() { # $1=release dir
  local rel="$1" req_sha
  if [ ! -x "$VENV/bin/python" ]; then
    section "Creating shared Python venv (first run)"
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --quiet --upgrade pip wheel
  fi
  req_sha=$(sha256sum "$rel/requirements.txt" | cut -d' ' -f1)
  if [ "$(cat "$STATE/venv-req-sha" 2>/dev/null)" != "$req_sha" ]; then
    section "Syncing shared venv with requirements.txt (hash changed)"
    "$VENV/bin/pip" install --quiet -r "$rel/requirements.txt"
    echo "$req_sha" > "$STATE/venv-req-sha"
  fi
}

build_release() { # $1=release dir
  local rel="$1"
  cd "$rel"

  section "Installing pnpm deps (forcing latest gigapdf-lib)"
  pnpm install --no-frozen-lockfile
  # --no-frozen-lockfile does NOT bump an already-resolved "latest" spec:
  # explicitly update the lib every deploy (build below is the gate — a
  # breaking lib change fails the build and the site stays on the old release).
  pnpm update "@qrcommunication/gigapdf-lib@latest" --recursive

  section "Building workspace packages (--force)"
  NODE_OPTIONS='--max-old-space-size=1536' pnpm turbo run build \
    --filter='./packages/*' --concurrency=1 --force

  section "Building apps/web"
  NODE_OPTIONS='--max-old-space-size=1536' pnpm --filter=web build

  section "Building apps/admin"
  # Contrary to the legacy flow, an admin build failure is FATAL: blue/green
  # switches all three upstreams together, so a broken admin would otherwise
  # go live. Failing here keeps the site 100% on the old release.
  NODE_OPTIONS='--max-old-space-size=1536' pnpm --filter=admin build

  section "Verifying fresh BUILD_IDs + syncing standalone"
  local app standalone bid
  for app in web admin; do
    bid="$rel/apps/$app/.next/BUILD_ID"
    [ -f "$bid" ] || die "apps/$app: BUILD_ID missing — build failed?"
    printf "  apps/%s: BUILD_ID=%s\n" "$app" "$(cat "$bid")"
    standalone="$rel/apps/$app/.next/standalone/apps/$app"
    [ -d "$rel/apps/$app/.next/standalone" ] || die "apps/$app: no standalone output"
    mkdir -p "$standalone/.next"
    rsync -a --delete "$rel/apps/$app/.next/static/" "$standalone/.next/static/"
    if [ -d "$rel/apps/$app/public" ]; then
      rsync -a --delete "$rel/apps/$app/public/" "$standalone/public/"
    fi
  done
}

run_migrations() { # $1=release dir — BEFORE the switch (schema must be forward-compatible)
  local rel="$1"
  section "Applying manual SQL migrations"
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
  local mig_dir="$rel/apps/web/prisma/manual-migrations" sql
  if [ -d "$mig_dir" ] && [ -n "${DATABASE_URL:-}" ]; then
    for sql in "$mig_dir"/*.sql; do
      [ -f "$sql" ] || continue
      echo "  applying $(basename "$sql")"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$sql" 2>&1 | tail -3 || \
        warn "$(basename "$sql") failed — check schema drift"
    done
  else
    echo "  no migrations dir or DATABASE_URL not set, skipping"
  fi

  section "Applying alembic migrations (Python backend)"
  if [ -x "$VENV/bin/alembic" ]; then
    ( cd "$rel" && "$VENV/bin/alembic" upgrade head 2>&1 | tail -3 ) || \
      warn "alembic upgrade failed — backend schema may be stale"
    echo "  alembic current: $(cd "$rel" && "$VENV/bin/alembic" current 2>/dev/null | tail -1)"
  else
    warn "alembic not found in $VENV — apply migrations manually!"
  fi
}

OCR_CHANGED=0
fetch_ocr() {
  section "Fetching OCR engine (gigapdf-ocr-rten) into shared/bin"
  local rel_url="https://github.com/QrCommunication/gigapdf-lib/releases/download/ocr-rten-v1"
  local ocr_bin="$SHARED/bin/ocr_serve"
  local models_root="/var/lib/gigapdf/rten-models"
  sudo mkdir -p "$models_root"
  local tmp; tmp=$(mktemp -d)
  if curl -fsSL -o "$tmp/gigapdf-ocr.sha256" "$rel_url/gigapdf-ocr.sha256"; then
    local newsha marker
    newsha=$(grep "gigapdf-ocr-models.tar.gz" "$tmp/gigapdf-ocr.sha256" | awk '{print $1}')
    marker="$models_root/.asset-sha"
    if [ ! -x "$ocr_bin" ] || [ ! -d "$models_root/models" ] || [ "$(cat "$marker" 2>/dev/null)" != "$newsha" ]; then
      echo "  fetching OCR binary + models (~250MB) …"
      curl -fsSL -o "$tmp/ocr_serve" "$rel_url/ocr_serve"
      curl -fsSL -o "$tmp/gigapdf-ocr-models.tar.gz" "$rel_url/gigapdf-ocr-models.tar.gz"
      ( cd "$tmp" && sha256sum -c gigapdf-ocr.sha256 )
      sudo install -m 0755 -o "$APP_USER" -g "$APP_GROUP" "$tmp/ocr_serve" "$ocr_bin"
      sudo rm -rf "$models_root/models"
      sudo tar xzf "$tmp/gigapdf-ocr-models.tar.gz" -C "$models_root"
      sudo chown -R "$APP_USER":"$APP_GROUP" "$models_root"
      echo "$newsha" | sudo tee "$marker" >/dev/null
      OCR_CHANGED=1
      ok "OCR engine updated"
    else
      ok "OCR engine up-to-date — skipping fetch"
    fi
  else
    warn "could not reach OCR release asset — keeping existing OCR engine"
  fi
  rm -rf "$tmp"
}

# ── systemd units (single source of truth: this function) ───────────────────
UNITS_CHANGED=0
write_unit() { # $1=name, content on stdin
  local name="$1" tmp
  tmp=$(mktemp)
  cat > "$tmp"
  if ! sudo cmp -s "$tmp" "/etc/systemd/system/$name" 2>/dev/null; then
    sudo install -m 0644 "$tmp" "/etc/systemd/system/$name"
    UNITS_CHANGED=1
    echo "  installed $name"
  fi
  rm -f "$tmp"
}

ensure_units() {
  section "Ensuring systemd units"
  local color p_web p_admin p_api
  for color in blue green; do
    p_web=$(port_of web "$color"); p_admin=$(port_of admin "$color"); p_api=$(port_of api "$color")

    write_unit "gigapdf-web-$color.service" <<EOF
[Unit]
Description=GigaPDF Next.js Web Frontend ($color, port $p_web)
After=network.target
StartLimitBurst=5
StartLimitIntervalSec=300

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$ROOT/$color/apps/web
EnvironmentFile=$ENV_FILE
Environment="NODE_ENV=production"
Environment="PORT=$p_web"
ExecStart=/usr/bin/node $ROOT/$color/apps/web/.next/standalone/apps/web/server.js
Restart=on-failure
RestartSec=5
# node exits non-zero on SIGTERM — treat 143 (128+SIGTERM) as a clean stop
SuccessExitStatus=143
StandardOutput=append:/var/log/gigapdf/web.log
StandardError=append:/var/log/gigapdf/web-error.log
MemoryHigh=1536M
MemoryMax=2G
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$ROOT /var/log/gigapdf

[Install]
WantedBy=multi-user.target
EOF

    write_unit "gigapdf-admin-$color.service" <<EOF
[Unit]
Description=GigaPDF Next.js Admin Panel ($color, port $p_admin)
After=network.target
StartLimitBurst=5
StartLimitIntervalSec=300

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$ROOT/$color/apps/admin
EnvironmentFile=$ENV_FILE
Environment="NODE_ENV=production"
Environment="PORT=$p_admin"
ExecStart=/usr/bin/node $ROOT/$color/apps/admin/.next/standalone/apps/admin/server.js
Restart=on-failure
RestartSec=5
# node exits non-zero on SIGTERM — treat 143 (128+SIGTERM) as a clean stop
SuccessExitStatus=143
StandardOutput=append:/var/log/gigapdf/admin.log
StandardError=append:/var/log/gigapdf/admin-error.log
MemoryHigh=1536M
MemoryMax=2G
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$ROOT /var/log/gigapdf

[Install]
WantedBy=multi-user.target
EOF

    write_unit "gigapdf-api-$color.service" <<EOF
[Unit]
Description=GigaPDF FastAPI Backend ($color, port $p_api)
After=network.target
StartLimitBurst=5
StartLimitIntervalSec=300

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$ROOT/$color
Environment="PATH=$VENV/bin:/usr/bin:/bin"
EnvironmentFile=$ENV_FILE
ExecStart=$VENV/bin/uvicorn app.main:app --host 0.0.0.0 --port $p_api --workers 4
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/gigapdf/api.log
StandardError=append:/var/log/gigapdf/api-error.log
MemoryHigh=1536M
MemoryMax=2G
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$ROOT /var/lib/gigapdf /var/log/gigapdf

[Install]
WantedBy=multi-user.target
EOF
  done

  write_unit "gigapdf-celery.service" <<EOF
[Unit]
Description=GigaPDF Celery Worker
After=network.target
StartLimitBurst=5
StartLimitIntervalSec=300

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$ROOT/current
Environment="PATH=$VENV/bin:/usr/bin:/bin"
EnvironmentFile=$ENV_FILE
ExecStart=$VENV/bin/celery -A app.tasks.celery_app worker --loglevel=info --concurrency=4 --queues=default,export,infra
Restart=on-failure
RestartSec=10
TimeoutStopSec=300
StandardOutput=append:/var/log/gigapdf/celery.log
StandardError=append:/var/log/gigapdf/celery-error.log
MemoryHigh=768M
MemoryMax=1G
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$ROOT /var/lib/gigapdf /var/log/gigapdf

[Install]
WantedBy=multi-user.target
EOF

  write_unit "gigapdf-celery-billing.service" <<EOF
[Unit]
Description=GigaPDF Celery Billing Worker
After=network.target
StartLimitBurst=5
StartLimitIntervalSec=300

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$ROOT/current
Environment="PATH=$VENV/bin:/usr/bin:/bin"
EnvironmentFile=$ENV_FILE
ExecStart=$VENV/bin/celery -A app.tasks.celery_app worker --loglevel=info --queues=billing --concurrency=2
Restart=on-failure
RestartSec=10
TimeoutStopSec=300
StandardOutput=append:/var/log/gigapdf/celery-billing.log
StandardError=append:/var/log/gigapdf/celery-billing-error.log
MemoryHigh=768M
MemoryMax=1G
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$ROOT /var/lib/gigapdf /var/log/gigapdf

[Install]
WantedBy=multi-user.target
EOF

  write_unit "gigapdf-ocr.service" <<EOF
[Unit]
Description=GigaPDF OCR Engine (gigapdf-ocr-rten — PaddleOCR PP-OCR via RTen, host-side)
After=network.target
StartLimitBurst=5
StartLimitIntervalSec=300

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$ROOT/current
EnvironmentFile=$ENV_FILE
ExecStart=$SHARED/bin/ocr_serve
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/gigapdf/ocr.log
StandardError=append:/var/log/gigapdf/ocr-error.log
MemoryHigh=2G
MemoryMax=3G
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$ROOT /var/lib/gigapdf /var/log/gigapdf

[Install]
WantedBy=multi-user.target
EOF

  if [ "$UNITS_CHANGED" = 1 ]; then
    sudo systemctl daemon-reload
    ok "systemd units refreshed (daemon-reload done)"
  else
    ok "systemd units unchanged"
  fi
}

# ── Health gates ─────────────────────────────────────────────────────────────
wait_http() { # $1=url $2=code-regex $3=timeout-s $4=label
  local url="$1" regex="$2" timeout="$3" label="$4" code i
  for i in $(seq 1 "$timeout"); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)
    if [[ "$code" =~ ^${regex}$ ]]; then
      ok "$label healthy ($url → $code, ${i}s)"
      return 0
    fi
    sleep 1
  done
  warn "$label NOT healthy after ${timeout}s ($url → last code $code)"
  return 1
}

gate_unit() { # $1=unit — is-active + NRestarts<3 after a settle delay
  local unit="$1" restarts
  if ! sudo systemctl is-active --quiet "$unit"; then
    warn "$unit is not active"
    return 1
  fi
  restarts=$(sudo systemctl show "$unit" -p NRestarts --value 2>/dev/null || echo 0)
  if [ "${restarts:-0}" -gt 3 ]; then
    warn "$unit in crash loop (NRestarts=$restarts)"
    return 1
  fi
  ok "$unit active (NRestarts=${restarts:-0})"
}

port_free() { # $1=port — true if nothing listens
  ! ss -tln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
}

start_color_and_gate() { # $1=color — start api → health → web+admin → health
  local color="$1"
  local p_web p_admin p_api
  p_web=$(port_of web "$color"); p_admin=$(port_of admin "$color"); p_api=$(port_of api "$color")

  section "Starting $color instances (web:$p_web admin:$p_admin api:$p_api)"
  local p
  for p in "$p_web" "$p_admin" "$p_api"; do
    port_free "$p" || die "port $p already in use — refusing to start $color (conflicting service?)"
  done

  # NRestarts is per-unit-lifetime: reset counters so the gate reflects THIS start
  sudo systemctl reset-failed "gigapdf-api-$color" "gigapdf-web-$color" "gigapdf-admin-$color" 2>/dev/null || true

  sudo systemctl start "gigapdf-api-$color"
  wait_http "http://127.0.0.1:$p_api/health" "200" 90 "api-$color" || {
    sudo systemctl stop "gigapdf-api-$color" || true
    die "api-$color failed its health gate — site untouched, still on $(active_color)"
  }

  sudo systemctl start "gigapdf-web-$color" "gigapdf-admin-$color"
  wait_http "http://127.0.0.1:$p_web/" "(200|3[0-9][0-9])" 60 "web-$color" || {
    sudo systemctl stop "gigapdf-web-$color" "gigapdf-admin-$color" "gigapdf-api-$color" || true
    die "web-$color failed its health gate — site untouched, still on $(active_color)"
  }
  wait_http "http://127.0.0.1:$p_admin/admin" "(200|3[0-9][0-9])" 60 "admin-$color" || {
    sudo systemctl stop "gigapdf-web-$color" "gigapdf-admin-$color" "gigapdf-api-$color" || true
    die "admin-$color failed its health gate — site untouched, still on $(active_color)"
  }

  sleep 8   # settle window: catch a crash-loop the first curl missed
  local unit fail=0
  for unit in $(color_units "$color"); do
    gate_unit "$unit" || fail=1
  done
  if [ "$fail" = 1 ]; then
    sudo systemctl stop "gigapdf-web-$color" "gigapdf-admin-$color" "gigapdf-api-$color" || true
    die "$color instances unstable — site untouched, still on $(active_color)"
  fi
}

# ── nginx switch ─────────────────────────────────────────────────────────────
write_upstreams() { # $1=primary color — other color listed as backup (absorbs
  # lingering old nginx workers whose config still points at the old primary).
  local color="$1" oc
  oc=$(other_color "$color")
  sudo tee "$NGX_UPSTREAMS" >/dev/null <<EOF
# Managed by deploy/server-deploy.sh — DO NOT EDIT BY HAND.
# Active color: $color   ($(date -u +%FT%TZ))
upstream fastapi_backend {
    server 127.0.0.1:$(port_of api "$color");
    server 127.0.0.1:$(port_of api "$oc") backup;
    keepalive 32;
}
upstream nextjs_web {
    server 127.0.0.1:$(port_of web "$color");
    server 127.0.0.1:$(port_of web "$oc") backup;
    keepalive 32;
}
upstream nextjs_admin {
    server 127.0.0.1:$(port_of admin "$color");
    server 127.0.0.1:$(port_of admin "$oc") backup;
    keepalive 32;
}
EOF
}

ensure_site() { # $1=release dir — install deploy/nginx.conf when it changed
  local rel="$1" src="$1/deploy/nginx.conf"
  [ -f "$src" ] || { warn "no deploy/nginx.conf in release — keeping installed site file"; return 0; }
  if ! grep -q "gigapdf-upstreams.conf" "$src"; then
    # Release predates the blue/green nginx layout (transition window):
    # keep the already-migrated installed site file, never regress to inline
    # upstreams that would undo the switch mechanism.
    warn "release nginx.conf predates the upstream include — keeping installed site file"
    return 0
  fi
  if ! sudo cmp -s "$src" "$NGX_SITE"; then
    sudo cp "$NGX_SITE" "$STATE/nginx-site.bak" 2>/dev/null || true
    sudo install -m 0644 "$src" "$NGX_SITE"
    echo "  installed new $NGX_SITE (backup: $STATE/nginx-site.bak)"
  fi
}

switch_nginx() { # $1=color $2=release dir (may be empty on pure switch)
  local color="$1" rel="${2:-}"
  section "Switching nginx upstreams → $color"
  write_upstreams "$color"
  [ -n "$rel" ] && ensure_site "$rel"
  # Hard guard: the switch is a no-op (and stopping the old color would 502)
  # unless the installed site file actually includes the upstreams file.
  # The one-time nginx migration installs it — see deploy/README.md.
  sudo grep -q "gigapdf-upstreams.conf" "$NGX_SITE" || \
    die "installed $NGX_SITE does not include gigapdf-upstreams.conf — run the one-time nginx migration first (deploy/README.md)"
  if ! sudo nginx -t 2>&1 | tail -2; then
    if [ -f "$STATE/nginx-site.bak" ]; then
      sudo install -m 0644 "$STATE/nginx-site.bak" "$NGX_SITE"
      sudo nginx -t && warn "nginx config restored from backup"
    fi
    die "nginx -t failed — upstreams NOT switched"
  fi
  sudo systemctl reload nginx
  ok "nginx reloaded (graceful) — traffic now on $color, old color kept as backup"
}

drain_nginx() {
  # Old workers finish in-flight requests then exit; idle keepalive client
  # connections are closed immediately by nginx on graceful shutdown. Bounded
  # wait; anything still lingering after this fails over to the `backup`
  # upstream entry once the old color stops.
  local i
  for i in $(seq 1 45); do
    pgrep -f "nginx: worker process is shutting down" >/dev/null || { ok "nginx old workers drained (${i}s)"; return 0; }
    sleep 1
  done
  warn "some nginx workers still shutting down after 45s — backup upstream will absorb them"
}

stop_previous() { # $1=previous active (color or 'legacy')
  local prev="$1"
  section "Stopping previous generation: $prev"
  if [ "$prev" = "legacy" ]; then
    sudo systemctl stop $LEGACY_UNITS 2>/dev/null || true
    sudo systemctl disable $LEGACY_UNITS 2>/dev/null || true
    ok "legacy units stopped + disabled (unit files kept on disk as emergency fallback)"
  else
    sudo systemctl stop $(color_units "$prev") 2>/dev/null || true
    sudo systemctl disable $(color_units "$prev") >/dev/null 2>&1 || true
    # Clear any residual "failed" cosmetics so `status` reads clean
    sudo systemctl reset-failed $(color_units "$prev") 2>/dev/null || true
  fi
}

enable_color() { # $1=color — survive reboots
  sudo systemctl enable $(color_units "$1") >/dev/null 2>&1 || true
}

flip_link() { # $1=link path $2=target — atomic replace
  local link="$1" target="$2" tmp="$1.tmp.$$"
  ln -sfn "$target" "$tmp"
  mv -T "$tmp" "$link"
}

restart_workers() { # $1=skip_celery(true/false)
  section "Restarting background workers"
  if [ "$1" != "true" ]; then
    # SIGTERM → celery warm shutdown: waits for in-flight tasks (TimeoutStopSec=300)
    sudo systemctl restart gigapdf-celery gigapdf-celery-billing
    ok "celery workers restarted (warm shutdown honored)"
  else
    warn "celery restart skipped (--skip-celery)"
  fi
  if [ "$OCR_CHANGED" = 1 ] || ! sudo systemctl is-active --quiet gigapdf-ocr; then
    sudo systemctl restart gigapdf-ocr
    ok "OCR engine restarted"
  else
    ok "OCR unchanged — not restarted (avoids ~250MB model reload)"
  fi
  sudo systemctl enable gigapdf-celery gigapdf-celery-billing gigapdf-ocr >/dev/null 2>&1 || true
}

record_state() { # $1=color $2=release $3=sha
  echo "$1" > "$STATE/active-color"
  printf "%s | %s | %s | %s\n" "$(date -u +%FT%TZ)" "$1" "$2" "$3" >> "$STATE/history"
}

purge_releases() {
  section "Purging old releases (keep $KEEP_RELEASES)"
  local keep=() d t
  for d in blue green current; do
    t=$(readlink -f "$ROOT/$d" 2>/dev/null || true)
    [ -n "$t" ] && keep+=("$t")
  done
  local n=0
  for d in $(ls -1dt "$RELEASES"/*/ 2>/dev/null); do
    d="${d%/}"
    case "$d" in "$RELEASES"/*) ;; *) continue ;; esac   # paranoia: stay inside releases/
    n=$((n+1))
    if [ "$n" -le "$KEEP_RELEASES" ]; then continue; fi
    local protected=0 k
    for k in "${keep[@]:-}"; do [ "$d" = "$k" ] && protected=1; done
    if [ "$protected" = 0 ]; then
      echo "  removing $d"
      sudo rm -rf "$d"
    fi
  done
  ok "releases on disk: $(ls -1d "$RELEASES"/*/ 2>/dev/null | wc -l)"
}

install_ci_hook() { # $1=release dir — only install NEW-generation ci-deploy
  local src="$1/deploy/gigapdf-ci-deploy.sh"
  if [ -f "$src" ] && grep -q "server-deploy.sh" "$src"; then
    if ! sudo cmp -s "$src" /usr/local/bin/gigapdf-ci-deploy.sh 2>/dev/null; then
      sudo install -m 0755 "$src" /usr/local/bin/gigapdf-ci-deploy.sh
      ok "refreshed /usr/local/bin/gigapdf-ci-deploy.sh"
    fi
  fi
}

report() {
  section "Final state"
  local svc
  for svc in gigapdf-api-blue gigapdf-api-green gigapdf-web-blue gigapdf-web-green \
             gigapdf-admin-blue gigapdf-admin-green gigapdf-celery gigapdf-celery-billing gigapdf-ocr; do
    printf "  %-28s %s\n" "$svc" "$(sudo systemctl is-active "$svc" 2>&1 || true)"
  done
  echo "  active color : $(active_color)"
  echo "  current      : $(readlink "$ROOT/current" 2>/dev/null || echo '-') "
  echo "  current HEAD : $(cat "$ROOT/current/.release-sha" 2>/dev/null || echo '-')"
  df -h "$ROOT" | tail -1 | awk '{printf "  disk         : %s used, %s free (%s)\n", $3, $4, $5}'
}

# ── Subcommands ──────────────────────────────────────────────────────────────
cmd_deploy() {
  local sha="" from_github=false skip_celery=false
  while [ $# -gt 0 ]; do
    case "$1" in
      --sha) sha="$2"; shift 2 ;;
      --from-github) from_github=true; shift ;;
      --skip-celery) skip_celery=true; shift ;;
      *) die "deploy: unknown flag $1" ;;
    esac
  done

  acquire_lock
  ensure_layout
  self_install
  ensure_shared_env

  if $from_github; then
    section "Fetching github/main into bare repo"
    fetch_github_into_bare
  fi
  [ -n "$sha" ] || sha=$(git --git-dir="$BARE" rev-parse refs/heads/main)
  info "Deploying sha $sha"
  guard_disk

  section "Creating release"
  local rel
  rel=$(make_release "$sha")
  ok "release: $rel"

  link_env "$rel"
  ensure_venv "$rel"
  build_release "$rel"
  run_migrations "$rel"
  fetch_ocr

  section "Handing release ownership to $APP_USER:$APP_GROUP"
  sudo chown -R "$APP_USER":"$APP_GROUP" "$rel"

  ensure_units

  local prev target
  prev=$(active_color)
  if [ "$prev" = "legacy" ]; then
    target=green   # legacy units hold the blue ports (3000/3001/8000)
  else
    target=$(other_color "$prev")
  fi
  info "active=$prev → target=$target"

  # Make sure no stale target instance runs from a previous aborted deploy
  sudo systemctl stop $(color_units "$target") 2>/dev/null || true
  flip_link "$ROOT/$target" "$rel"

  start_color_and_gate "$target"
  switch_nginx "$target" "$rel"
  drain_nginx
  stop_previous "$prev"
  enable_color "$target"

  flip_link "$ROOT/current" "$rel"
  restart_workers "$skip_celery"
  record_state "$target" "$rel" "$sha"
  install_ci_hook "$rel"
  purge_releases
  report
  ok "DEPLOY COMPLETE — $target is live on $rel"
}

cmd_switch() {
  local to=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --to) to="$2"; shift 2 ;;
      *) die "switch: unknown flag $1" ;;
    esac
  done
  acquire_lock
  ensure_layout
  self_install
  ensure_units

  local prev; prev=$(active_color)
  if [ "$to" = "previous" ]; then
    [ "$prev" = "legacy" ] && die "no previous generation to roll back to (still on legacy)"
    to=$(other_color "$prev")
  fi
  case "$to" in blue|green|legacy) ;; *) die "switch: --to must be blue|green|previous|legacy" ;; esac
  [ "$to" = "$prev" ] && die "$to is already active — nothing to do"

  if [ "$to" = "legacy" ]; then
    # Emergency fallback to the frozen flat clone. Only valid while the blue
    # color is NOT active (legacy shares the blue ports).
    [ "$prev" = "blue" ] && die "cannot switch to legacy: blue color occupies the same ports (3000/3001/8000)"
    section "Starting LEGACY units (frozen flat clone)"
    sudo systemctl start $LEGACY_UNITS
    wait_http "http://127.0.0.1:$BLUE_API/health" "200" 90 "api-legacy" || die "legacy api failed health gate"
    wait_http "http://127.0.0.1:$BLUE_WEB/" "(200|3[0-9][0-9])" 60 "web-legacy" || die "legacy web failed health gate"
    switch_nginx blue ""       # legacy listens on the blue ports
    drain_nginx
    stop_previous "$prev"
    echo "legacy" > "$STATE/active-color"
    printf "%s | %s | %s | %s\n" "$(date -u +%FT%TZ)" legacy "$ROOT (flat clone)" "-" >> "$STATE/history"
    warn "LEGACY fallback active — celery/ocr still run the release in $ROOT/current"
    report
    return 0
  fi

  local rel
  rel=$(readlink -f "$ROOT/$to" 2>/dev/null || true)
  [ -n "$rel" ] && [ -d "$rel" ] || die "color $to has no release (symlink $ROOT/$to missing)"
  [ -d "$rel/apps/web/.next/standalone" ] || die "release $rel has no built standalone — cannot switch to it"
  info "switching $prev → $to ($rel)"

  start_color_and_gate "$to"
  switch_nginx "$to" "$rel"
  drain_nginx
  stop_previous "$prev"
  enable_color "$to"
  flip_link "$ROOT/current" "$rel"
  restart_workers false        # celery/ocr must run the same code as the web/api
  record_state "$to" "$rel" "$(cat "$rel/.release-sha" 2>/dev/null || echo '-')"
  report
  ok "SWITCH COMPLETE — $to is live on $rel"
}

cmd_status() {
  ensure_layout
  report
  echo
  echo "history (last 5):"
  tail -5 "$STATE/history" 2>/dev/null || echo "  (none)"
}

case "${1:-}" in
  deploy) shift; cmd_deploy "$@" ;;
  switch) shift; cmd_switch "$@" ;;
  status) shift; cmd_status "$@" ;;
  *) die "usage: $0 {deploy|switch|status} [flags] — see header comments" ;;
esac
