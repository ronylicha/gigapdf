#!/bin/bash
# =============================================================================
# GigaPDF Deployment Script
# This script is executed by the post-receive hook on each deployment
# =============================================================================

set -e

# =============================================================================
# LEGACY GUARD — this in-place flat-clone deploy is DISABLED once the
# blue/green release layout is active (it would chown releases/, restart the
# retired legacy units on ports already used by the blue color, and race the
# zero-downtime switch). Use deploy/redeploy.sh (laptop) or
# deploy/server-deploy.sh (on the VPS) instead. See deploy/README.md.
# =============================================================================
if [ -f /opt/gigapdf/shared/state/active-color ]; then
    echo "FATAL: blue/green release layout is active — legacy deploy.sh is disabled." >&2
    echo "Use deploy/redeploy.sh (laptop) or deploy/server-deploy.sh deploy (VPS)." >&2
    exit 1
fi

echo "=========================================="
echo "  GigaPDF Deployment"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

APP_DIR="/opt/gigapdf"
ENV_FILE="$APP_DIR/.env"
SNAPSHOT_BASE="/opt/gigapdf-snapshots"
DEPLOY_TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
SNAPSHOT_DIR="$SNAPSHOT_BASE/$DEPLOY_TIMESTAMP"

cd "$APP_DIR"

# =============================================================================
# 0. Bootstrap directories
# =============================================================================
log_info "Bootstrapping directories..."
sudo mkdir -p "$SNAPSHOT_BASE"
sudo chown ubuntu:ubuntu "$SNAPSHOT_BASE"
mkdir -p /var/log/gigapdf

# Ensure rollback script is executable
chmod +x "$APP_DIR/scripts/rollback.sh" 2>/dev/null || true

# =============================================================================
# 0.5 Fix permissions
# =============================================================================
log_info "Fixing permissions..."
# /var/lib/gigapdf is written at runtime by the services (User=gigapdf) — the
# celery export task does os.makedirs(storage_path/exports). Owner=ubuntu keeps
# it deployer-editable; group=gigapdf + setgid (2) makes new files/dirs
# group-writable by the worker. Plain ubuntu:ubuntu made exports fail with
# PermissionError ([Errno 13]).
sudo mkdir -p /var/lib/gigapdf/documents/exports
sudo chown -R ubuntu:gigapdf /var/lib/gigapdf 2>/dev/null || true
sudo chmod -R 2775 /var/lib/gigapdf 2>/dev/null || true
sudo chown -R ubuntu:ubuntu /var/log/gigapdf 2>/dev/null || true
# Reclaim turbo / next caches written by the systemd service user. Without
# this, the upcoming "rm -rf .turbo" fails with EPERM and `set -e` kills
# the deploy mid-way (silent cause of "deploy didn't pick up my code").
sudo chown -R ubuntu:ubuntu "$APP_DIR/.turbo" 2>/dev/null || true
sudo find "$APP_DIR/packages" -maxdepth 2 -name '.turbo' -exec chown -R ubuntu:ubuntu {} + 2>/dev/null || true
sudo find "$APP_DIR/apps" -maxdepth 2 -name '.turbo' -exec chown -R ubuntu:ubuntu {} + 2>/dev/null || true
sudo find "$APP_DIR/apps" -maxdepth 2 -name '.next' -exec chown -R ubuntu:ubuntu {} + 2>/dev/null || true

# =============================================================================
# 1. Copy Production Environment if not exists
# =============================================================================
if [ ! -f "$ENV_FILE" ]; then
    log_info "Creating .env from template..."
    cp deploy/.env.production "$ENV_FILE"
    log_warn "Please edit /opt/gigapdf/.env with production values!"
fi

# =============================================================================
# 1.5 Clean turbo cache to avoid build issues
# =============================================================================
log_info "Cleaning turbo cache..."
# Use sudo because previous deploys ran the build under the gigapdf service
# user, leaving cache files owned by that user. Without sudo, rm fails with
# EPERM and (set -e) silently kills the deploy.
sudo rm -rf .turbo packages/*/.turbo apps/*/.turbo

# =============================================================================
# 1.6 Create .env symlinks for apps
# =============================================================================
log_info "Creating .env symlinks..."
ln -sf /opt/gigapdf/.env /opt/gigapdf/apps/web/.env
ln -sf /opt/gigapdf/.env /opt/gigapdf/apps/admin/.env

# =============================================================================
# 1.7 Lock down .env so only the gigapdf runtime user (and ubuntu owner) can
# read it. The Python services use pydantic-settings which calls open('.env')
# from the process itself — systemd's EnvironmentFile= load as root is not
# enough, the file must be readable by User=gigapdf or celery crash-loops with
# PermissionError. Owner=ubuntu keeps the file editable by the deployer.
# =============================================================================
if [ -f "$ENV_FILE" ]; then
    log_info "Securing .env (owner=ubuntu, group=gigapdf, mode=640)..."
    sudo chown ubuntu:gigapdf "$ENV_FILE"
    sudo chmod 640 "$ENV_FILE"
fi

# =============================================================================
# 2. Python Virtual Environment & Dependencies
# =============================================================================
log_info "Setting up Python environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# =============================================================================
# 2.5 Scaleway CLI (for infrastructure monitoring)
# =============================================================================
log_info "Setting up Scaleway CLI..."

# Install scw CLI if not present
if ! command -v scw &> /dev/null; then
    log_info "Installing Scaleway CLI..."
    curl -s https://raw.githubusercontent.com/scaleway/scaleway-cli/master/scripts/get.sh | sh
fi

# Note: scw CLI uses environment variables (SCW_ACCESS_KEY, SCW_SECRET_KEY, etc.)
# These are loaded from /opt/gigapdf/.env via systemd EnvironmentFile
# No config file needed - variables take priority over config files
if [ -n "$SCW_ACCESS_KEY" ]; then
    log_info "Scaleway CLI installed (credentials configured via environment)"
else
    log_warn "SCW_ACCESS_KEY not set - infrastructure costs API will not work"
    log_warn "Add to .env: SCW_ACCESS_KEY, SCW_SECRET_KEY, SCW_DEFAULT_ORGANIZATION_ID, SCW_DEFAULT_PROJECT_ID"
fi

# =============================================================================
# 3. Node.js Dependencies
# =============================================================================
log_info "Installing Node.js dependencies..."
pnpm install --frozen-lockfile

# =============================================================================
# 4. Build Packages (sequential to avoid OOM on small VPS)
# =============================================================================
log_info "Building shared packages (sequential mode)..."
export NODE_OPTIONS="--max-old-space-size=1024"
pnpm exec turbo build --filter='./packages/*' --concurrency=1

# =============================================================================
# 5. Generate Prisma clients
# =============================================================================
log_info "Generating Prisma clients..."
cd apps/web
pnpm db:generate || log_warn "Web Prisma generate skipped"
cd ../..

cd apps/admin
pnpm db:generate || log_warn "Admin Prisma generate skipped"
cd ../..

# =============================================================================
# 6. Build Next.js Applications
# =============================================================================
log_info "Building Next.js Web application..."
cd apps/web
NODE_OPTIONS="--max-old-space-size=1536" pnpm build
cd ../..

log_info "Building Next.js Admin application..."
cd apps/admin
NODE_OPTIONS="--max-old-space-size=1536" pnpm build
cd ../..

# =============================================================================
# 7. Copy static files to standalone directories
# =============================================================================
log_info "Copying static files to standalone directories..."

# Web app
mkdir -p /opt/gigapdf/apps/web/.next/standalone/apps/web/.next
cp -r /opt/gigapdf/apps/web/.next/static /opt/gigapdf/apps/web/.next/standalone/apps/web/.next/
cp -r /opt/gigapdf/apps/web/public /opt/gigapdf/apps/web/.next/standalone/apps/web/ 2>/dev/null || true

# Admin app
mkdir -p /opt/gigapdf/apps/admin/.next/standalone/apps/admin/.next
cp -r /opt/gigapdf/apps/admin/.next/static /opt/gigapdf/apps/admin/.next/standalone/apps/admin/.next/
cp -r /opt/gigapdf/apps/admin/public /opt/gigapdf/apps/admin/.next/standalone/apps/admin/ 2>/dev/null || true

# =============================================================================
# 7.5. Snapshot build artefacts (zero-downtime rollback support)
# =============================================================================
# Build is done BEFORE any service restart. We snapshot the artefacts now so
# that rollback.sh can restore them without needing a full rebuild.
log_info "Snapshotting build artefacts to $SNAPSHOT_DIR ..."
mkdir -p "$SNAPSHOT_DIR/apps/web" "$SNAPSHOT_DIR/apps/admin"

# Copy .next directories (they contain standalone + static)
cp -a "$APP_DIR/apps/web/.next"   "$SNAPSHOT_DIR/apps/web/.next"
cp -a "$APP_DIR/apps/admin/.next" "$SNAPSHOT_DIR/apps/admin/.next"

# Copy package dist artefacts if present
if [ -d "$APP_DIR/packages" ]; then
    mkdir -p "$SNAPSHOT_DIR/packages"
    # Only copy compiled output, not node_modules (saves space)
    find "$APP_DIR/packages" -maxdepth 2 -name "dist" -type d | while read -r dist_dir; do
        rel="${dist_dir#"$APP_DIR/"}"
        mkdir -p "$SNAPSHOT_DIR/$rel"
        cp -a "$dist_dir/." "$SNAPSHOT_DIR/$rel/"
    done
fi

# Update the "latest" symlink atomically
ln -sfn "$SNAPSHOT_DIR" "$SNAPSHOT_BASE/latest"
log_info "Snapshot created. Total snapshots: $(ls -1 "$SNAPSHOT_BASE" | grep -c '^[0-9]' || echo 0)"

# Prune snapshots older than 7 days (keep at most 5)
log_info "Pruning old snapshots (keeping last 5)..."
ls -1dt "$SNAPSHOT_BASE"/[0-9]* 2>/dev/null | tail -n +6 | xargs -r rm -rf
log_info "Snapshot pruning complete."

# =============================================================================
# 8. Database Migrations
# =============================================================================
# IMPORTANT: Migration order matters!
# 1. Alembic manages FastAPI tables (stored_documents, user_quotas, plans, etc.)
# 2. Prisma manages Better Auth tables (users, sessions, accounts, verification, jwks)
# Both share the same database but manage different tables.
# NEVER run prisma db push with --accept-data-loss as it will delete Alembic tables!
# =============================================================================

log_info "Running Alembic migrations (FastAPI tables)..."
source .venv/bin/activate
cd "$APP_DIR"

# Source .env for database scripts
if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

alembic upgrade head || log_warn "Alembic migrations skipped or failed"

# Better Auth tables (created via SQL script, NOT Prisma push)
# Prisma push would delete Alembic tables, so we use a safe SQL script instead
log_info "Creating Better Auth tables (SQL script)..."
python3 -c "
from sqlalchemy import create_engine, text
import os

# Get database URL from environment
db_url = os.environ.get('DATABASE_URL', '')
if not db_url:
    print('DATABASE_URL not set, skipping Better Auth tables')
    exit(0)

# Ensure sync driver
db_url = db_url.replace('postgresql+asyncpg', 'postgresql')

engine = create_engine(db_url)
with open('deploy/init-betterauth-tables.sql', 'r') as f:
    sql = f.read()

with engine.connect() as conn:
    # Execute each statement separately
    for statement in sql.split(';'):
        statement = statement.strip()
        if statement and not statement.startswith('--'):
            try:
                conn.execute(text(statement))
            except Exception as e:
                pass  # Table already exists, ignore
    conn.commit()
    print('Better Auth tables created/verified successfully')
" || log_warn "Better Auth tables creation skipped"

# =============================================================================
# 7. Install/Update Systemd Services
# =============================================================================
log_info "Installing systemd services..."
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable services on boot
sudo systemctl enable gigapdf-api
sudo systemctl enable gigapdf-web
sudo systemctl enable gigapdf-admin
sudo systemctl enable gigapdf-celery
sudo systemctl enable gigapdf-celery-billing
sudo systemctl enable gigapdf-ocr

# =============================================================================
# 7b. Fetch host-side OCR engine (gigapdf-ocr-rten binary + .rten models)
# =============================================================================
# Recognition runs in the gigapdf-ocr service (PaddleOCR PP-OCR via RTen). The
# prebuilt x86_64 binary + the 14-language model set ship as the lib's
# "ocr-rten-v1" release asset (kept out of git). Idempotent: a SHA marker skips
# the ~250MB re-download when nothing changed.
log_info "Fetching OCR engine (gigapdf-ocr-rten)..."
OCR_REL="https://github.com/QrCommunication/gigapdf-lib/releases/download/ocr-rten-v1"
OCR_BIN="$APP_DIR/bin/ocr_serve"
OCR_MODELS_ROOT="/var/lib/gigapdf/rten-models"
sudo mkdir -p "$APP_DIR/bin" "$OCR_MODELS_ROOT"
OCR_TMP="$(mktemp -d)"
if curl -fsSL -o "$OCR_TMP/gigapdf-ocr.sha256" "$OCR_REL/gigapdf-ocr.sha256"; then
    OCR_NEWSHA="$(grep "gigapdf-ocr-models.tar.gz" "$OCR_TMP/gigapdf-ocr.sha256" | awk '{print $1}')"
    OCR_MARKER="$OCR_MODELS_ROOT/.asset-sha"
    if [ ! -x "$OCR_BIN" ] || [ ! -d "$OCR_MODELS_ROOT/models" ] || [ "$(cat "$OCR_MARKER" 2>/dev/null)" != "$OCR_NEWSHA" ]; then
        log_info "  downloading OCR binary + 14-language models (~250MB)..."
        curl -fsSL -o "$OCR_TMP/ocr_serve" "$OCR_REL/ocr_serve"
        curl -fsSL -o "$OCR_TMP/gigapdf-ocr-models.tar.gz" "$OCR_REL/gigapdf-ocr-models.tar.gz"
        ( cd "$OCR_TMP" && sha256sum -c gigapdf-ocr.sha256 )
        sudo install -m 0755 -o gigapdf -g gigapdf "$OCR_TMP/ocr_serve" "$OCR_BIN"
        sudo rm -rf "$OCR_MODELS_ROOT/models"
        sudo tar xzf "$OCR_TMP/gigapdf-ocr-models.tar.gz" -C "$OCR_MODELS_ROOT"
        sudo chown -R gigapdf:gigapdf "$OCR_MODELS_ROOT"
        echo "$OCR_NEWSHA" | sudo tee "$OCR_MARKER" >/dev/null
        log_info "  OCR engine updated."
    else
        log_info "  OCR engine up-to-date — skipping ~250MB fetch."
    fi
else
    log_warn "  could not reach OCR release asset — leaving existing OCR engine in place."
fi
rm -rf "$OCR_TMP"
# Upsert OCR env keys into .env (idempotent — never duplicates a key).
for kv in "OCR_MODELS_DIR=/var/lib/gigapdf/rten-models/models" "OCR_BIND=127.0.0.1:8077" "OCR_SERVICE_URL=http://127.0.0.1:8077"; do
    k="${kv%%=*}"
    sudo grep -q "^$k=" "$APP_DIR/.env" 2>/dev/null || echo "$kv" | sudo tee -a "$APP_DIR/.env" >/dev/null
done

# =============================================================================
# 8. Update Nginx Configuration + Maintenance Page
# =============================================================================
log_info "Updating Nginx configuration..."

# Install maintenance page (served by nginx on 502/503/504 during restarts)
sudo mkdir -p /var/www/gigapdf-maintenance
sudo cp "$APP_DIR/deploy/nginx/maintenance.html" /var/www/gigapdf-maintenance/maintenance.html
sudo chown -R www-data:www-data /var/www/gigapdf-maintenance
log_info "Maintenance page installed at /var/www/gigapdf-maintenance/maintenance.html"

if [ -f /etc/letsencrypt/live/giga-pdf.com/fullchain.pem ]; then
    sudo cp deploy/nginx.conf /etc/nginx/sites-available/gigapdf
    sudo nginx -t && sudo systemctl reload nginx
else
    log_warn "SSL certificate not found, skipping Nginx update"
    log_warn "Run: sudo certbot --nginx -d giga-pdf.com -d www.giga-pdf.com"
fi

# =============================================================================
# 9. Zero-downtime service restart (build already complete — services up so far)
# =============================================================================
# Strategy:
#   a) API (uvicorn multi-worker): send SIGHUP for graceful reload.
#      Workers finish in-flight requests then reload the new code.
#      Falls back to stop+start if the service was not running.
#   b) Celery workers: restart AFTER API is healthy. Celery tasks survive
#      restarts via Redis broker, so this causes no data loss.
#   c) Next.js apps (web + admin): restart AFTER API is healthy.
#      Each restart takes ~3-5 s; nginx serves existing keepalive connections
#      during that window.
#
# Error handling: if any critical service fails to become healthy, the script
# exits non-zero so the calling CI/CD system can trigger rollback.sh.
# =============================================================================

# Helper: wait for an HTTP endpoint to return 2xx (max N attempts x delay)
wait_healthy() {
    local name="$1"
    local url="$2"
    local max_attempts="${3:-12}"
    local delay="${4:-5}"
    log_info "Waiting for $name to become healthy at $url ..."
    for i in $(seq 1 "$max_attempts"); do
        if curl -sf "$url" > /dev/null 2>&1; then
            log_info "$name is healthy (attempt $i)."
            return 0
        fi
        sleep "$delay"
    done
    log_error "$name did NOT become healthy after $((max_attempts * delay))s — triggering rollback."
    bash "$APP_DIR/scripts/rollback.sh" --non-interactive 2>&1 || true
    exit 1
}

log_info "--- Step 9a: Restart FastAPI (load new code) ---"
if sudo systemctl is-active --quiet gigapdf-api; then
    # IMPORTANT: gigapdf-api runs `uvicorn --workers N` (multiprocessing). That
    # process manager does NOT hot-reload Python code on SIGHUP, so a plain
    # `systemctl reload` (ExecReload=kill -HUP) leaves the OLD code running while
    # still answering /health — the deploy reports success but ships nothing.
    # A real restart is required (~2-3s; nginx retries the upstream).
    # Regression: 2026-06-21 rate-limiter fix never took effect until restarted.
    sudo systemctl restart gigapdf-api
    log_info "gigapdf-api restarted (new code loaded)."
else
    log_warn "gigapdf-api was stopped — performing cold start."
    sudo systemctl start gigapdf-api
fi

# Gate: API must be healthy before touching anything else
wait_healthy "gigapdf-api" "http://localhost:8000/health" 12 5

log_info "--- Step 9b: Restart Celery workers (tasks survive via broker) ---"
sudo systemctl restart gigapdf-celery
sudo systemctl restart gigapdf-celery-billing
log_info "Celery workers restarted."

log_info "--- Step 9b-bis: Restart OCR engine (loads ~250MB models at boot) ---"
sudo systemctl restart gigapdf-ocr
log_info "gigapdf-ocr restarted (model load takes a few seconds)."

log_info "--- Step 9c: Restart Next.js Web (nginx serves stale keepalives) ---"
sudo systemctl restart gigapdf-web
# Brief grace period so the new process binds port 3000 before admin restarts
sleep 4

log_info "--- Step 9d: Restart Next.js Admin ---"
sudo systemctl restart gigapdf-admin

# =============================================================================
# 10. Final Health Checks
# =============================================================================
log_info "Performing final health checks..."
sleep 5

DEPLOY_OK=true

check_service() {
    local svc="$1"
    if sudo systemctl is-active --quiet "$svc"; then
        echo -e "  ${GREEN}✓${NC} $svc is running"
    else
        echo -e "  ${RED}✗${NC} $svc failed to start"
        sudo systemctl status "$svc" --no-pager -l 2>/dev/null | tail -20 || true
        DEPLOY_OK=false
    fi
}

check_http() {
    local label="$1"
    local url="$2"
    local http_code
    http_code="$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")"
    if echo "$http_code" | grep -qE "^[23]"; then
        echo -e "  ${GREEN}✓${NC} $label responded HTTP $http_code"
    else
        echo -e "  ${YELLOW}!${NC} $label responded HTTP $http_code (may still be warming up)"
    fi
}

echo ""
echo "Systemd services:"
check_service gigapdf-api
check_service gigapdf-web
check_service gigapdf-admin
check_service gigapdf-celery
check_service gigapdf-celery-billing
check_service gigapdf-ocr
check_http "OCR /health" "http://localhost:8077/health"

echo ""
echo "HTTP endpoints:"
check_http "API     (localhost:8000)" "http://localhost:8000/health"
check_http "Web     (localhost:3000)" "http://localhost:3000"
check_http "Admin   (localhost:3001)" "http://localhost:3001"

if [ "$DEPLOY_OK" = false ]; then
    log_error "One or more services failed. Triggering automatic rollback..."
    bash "$APP_DIR/scripts/rollback.sh" 2>&1 || true
    exit 1
fi

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
echo ""
echo "Services:"
echo "  - API:    http://localhost:8000"
echo "  - Web:    http://localhost:3000"
echo "  - Admin:  http://localhost:3001"
echo ""
echo "Logs:"
echo "  - API:    /var/log/gigapdf/api.log"
echo "  - Web:    /var/log/gigapdf/web.log"
echo "  - Celery: /var/log/gigapdf/celery.log"
echo ""
