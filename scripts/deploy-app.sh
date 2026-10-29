#!/usr/bin/env bash
# layer: stack
set -euo pipefail

# Deploy a crouton app to Cloudflare Pages with D1 + KV
# Usage: ./scripts/deploy-app.sh <app-dir>
# Example: ./scripts/deploy-app.sh apps/bike-sheds

APP_DIR="${1:?Usage: deploy-app.sh <app-dir>}"
APP_NAME="$(basename "$APP_DIR")"
WRANGLER_TOML="$APP_DIR/wrangler.toml"

fail() { echo "❌ $1" >&2; exit 1; }
info() { echo "→ $1"; }
ok()   { echo "✅ $1"; }

# ── Pre-flight checks ──────────────────────────────────────────────

[ -d "$APP_DIR" ] || fail "Directory $APP_DIR does not exist"
[ -f "$WRANGLER_TOML" ] || fail "No wrangler.toml found at $WRANGLER_TOML"

info "Checking wrangler authentication..."
wrangler whoami > /dev/null 2>&1 || fail "Not logged in. Run: wrangler login"
ok "Authenticated with Cloudflare"

# ── Create Cloudflare Pages project ────────────────────────────────

info "Creating Pages project: $APP_NAME"
if wrangler pages project list 2>/dev/null | grep -q "^$APP_NAME "; then
  info "Pages project '$APP_NAME' already exists, skipping"
else
  wrangler pages project create "$APP_NAME" --production-branch main
  ok "Created Pages project: $APP_NAME"
fi

# ── Create D1 database ────────────────────────────────────────────

DB_NAME="${APP_NAME}-db"
info "Creating D1 database: $DB_NAME"

DB_OUTPUT=$(wrangler d1 create "$DB_NAME" 2>&1) || {
  if echo "$DB_OUTPUT" | grep -q "already exists"; then
    info "D1 database '$DB_NAME' already exists"
    DB_ID=$(wrangler d1 list --json 2>/dev/null | grep -o "\"uuid\":\"[^\"]*\"" | head -1 | cut -d'"' -f4)
  else
    fail "Failed to create D1 database: $DB_OUTPUT"
  fi
}
DB_ID="${DB_ID:-$(echo "$DB_OUTPUT" | grep -o '[0-9a-f-]\{36\}' | head -1)}"
[ -n "$DB_ID" ] || fail "Could not extract D1 database ID"
ok "D1 database ready: $DB_ID"

# ── Create KV namespace ───────────────────────────────────────────

KV_NAME="${APP_NAME}-kv"
info "Creating KV namespace: $KV_NAME"

KV_OUTPUT=$(wrangler kv namespace create "$KV_NAME" 2>&1) || {
  if echo "$KV_OUTPUT" | grep -q "already exists"; then
    info "KV namespace '$KV_NAME' already exists"
    KV_ID=$(wrangler kv namespace list --json 2>/dev/null | grep -B1 "\"title\":\"$KV_NAME\"" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  else
    fail "Failed to create KV namespace: $KV_OUTPUT"
  fi
}
KV_ID="${KV_ID:-$(echo "$KV_OUTPUT" | grep -o '[0-9a-f]\{32\}' | head -1)}"
[ -n "$KV_ID" ] || fail "Could not extract KV namespace ID"
ok "KV namespace ready: $KV_ID"

# ── Update wrangler.toml with real IDs ────────────────────────────

info "Updating $WRANGLER_TOML with resource IDs..."
sed -i.bak "s/database_id = \".*\"/database_id = \"$DB_ID\"/" "$WRANGLER_TOML"
sed -i.bak "/\[\[kv_namespaces\]\]/,/^$/s/id = \".*\"/id = \"$KV_ID\"/" "$WRANGLER_TOML"
rm -f "${WRANGLER_TOML}.bak"
ok "Updated wrangler.toml"

# ── Set secrets ───────────────────────────────────────────────────

info "Setting secrets for $APP_NAME..."

read -rsp "Enter BETTER_AUTH_SECRET (32+ chars): " AUTH_SECRET
echo
[ ${#AUTH_SECRET} -ge 32 ] || fail "BETTER_AUTH_SECRET must be at least 32 characters"

read -rp "Enter BETTER_AUTH_URL (e.g. https://$APP_NAME.pages.dev): " AUTH_URL
[ -n "$AUTH_URL" ] || fail "BETTER_AUTH_URL is required"

echo "$AUTH_SECRET" | wrangler pages secret put BETTER_AUTH_SECRET --project-name "$APP_NAME"
echo "$AUTH_URL" | wrangler pages secret put BETTER_AUTH_URL --project-name "$APP_NAME"
ok "Secrets configured"

# ── Run database migrations ───────────────────────────────────────

info "Running database migrations..."
(cd "$APP_DIR" && npx wrangler d1 migrations apply "$DB_NAME" --remote)
ok "Migrations applied"

# ── Build and deploy ──────────────────────────────────────────────

info "Building and deploying $APP_NAME..."
(cd "$APP_DIR" && pnpm run cf:deploy)

DEPLOY_URL="https://${APP_NAME}.pages.dev"
echo ""
echo "════════════════════════════════════════════"
ok "Deployed: $DEPLOY_URL"
echo "════════════════════════════════════════════"
