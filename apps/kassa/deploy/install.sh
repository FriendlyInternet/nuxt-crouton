#!/usr/bin/env bash
#
# Generic venue-till installer (#804) — bare Linux box → running, org-bound till.
#
# The device-agnostic generalisation of the Pi rig (#798, `deploy/pi/setup.sh`),
# which assumed a checked-out repo and built in place. This one assumes NOTHING
# on the box: it downloads a prebuilt node-server bundle, installs a systemd
# unit, claims the device against the org with a one-time pairing code (#1662),
# and verifies it can actually reach what it needs.
#
# Design notes:
#   * NO build on-site. Nuxt needs multiple GB of heap; a 4GB Pi would swap for
#     minutes. The bundle is built by CI (`release-venue-bundle.yml`).
#   * The pairing code is the ONLY thing an operator types. Everything the
#     device needs afterwards (org, event, token, its own secret) comes back
#     from the claim — no config file to hand-edit, no engineer, no SSH.
#   * Idempotent. Re-running upgrades the bundle and leaves an existing device
#     identity alone unless --reclaim is passed.
#
# Usage (on the target box):
#   curl -fsSL <raw-url>/install.sh | sudo bash -s -- --release venue-2026.08.03
#
#   --release <tag>     bundle release tag to install (default: latest)
#   --api-url <url>     origin that mints/accepts pairing codes
#   --code <code>       pairing code (otherwise prompted for)
#   --name <name>       device name shown in the org's device list
#   --reclaim           re-run the claim even if this box already has an identity
#   --skip-claim        install + wire only; claim later with --reclaim
#   --dry-run           print what would happen; touch nothing
set -euo pipefail

REPO="${FANFARE_REPO:-FriendlyInternet/nuxt-crouton}"
API_URL="${FANFARE_API_URL:-https://kassa.friendlyinter.net}"
RELEASE="latest"
PAIRING_CODE="${FANFARE_PAIRING_CODE:-}"
DEVICE_NAME="${FANFARE_DEVICE_NAME:-}"
RECLAIM=0
SKIP_CLAIM=0
DRY_RUN=0

INSTALL_DIR="${FANFARE_INSTALL_DIR:-/opt/fanfare}"
ETC_DIR="/etc/fanfare"
ENV_FILE="$ETC_DIR/fanfare.env"
DEVICE_FILE="$ETC_DIR/device.env"
SERVICE_NAME="fanfare"
RUN_USER="${FANFARE_USER:-fanfare}"
PORT="${FANFARE_PORT:-3000}"

log()  { echo "[install] $*"; }
warn() { echo "[install] WARN: $*" >&2; }
die()  { echo "[install] ERROR: $*" >&2; exit 1; }
run()  { if [ "$DRY_RUN" = 1 ]; then echo "  would run: $*"; else "$@"; fi }

while [ $# -gt 0 ]; do
  case "$1" in
    --release)    RELEASE="${2:?--release needs a value}"; shift 2 ;;
    --api-url)    API_URL="${2:?--api-url needs a value}"; shift 2 ;;
    --code)       PAIRING_CODE="${2:?--code needs a value}"; shift 2 ;;
    --name)       DEVICE_NAME="${2:?--name needs a value}"; shift 2 ;;
    --reclaim)    RECLAIM=1; shift ;;
    --skip-claim) SKIP_CLAIM=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    sed -n '2,30p' "$0"; exit 0 ;;
    *)            die "unknown option: $1 (try --help)" ;;
  esac
done

# ── 0. Preflight ─────────────────────────────────────────────────────────────
# Fail fast and specifically: a half-installed box is worse than no box.
# Under --dry-run these are advisory — the point of a dry run is to preview the
# plan from anywhere (a laptop, CI), not only from a box that could install.
require() {
  local what="$1" msg="$2"
  if command -v "$what" >/dev/null 2>&1; then return 0; fi
  if [ "$DRY_RUN" = 1 ]; then warn "$msg (dry-run: continuing)"; return 0; fi
  die "$msg"
}
if [ "$DRY_RUN" != 1 ] && [ "$(id -u)" != 0 ]; then
  die "must run as root (use sudo)"
fi
require systemctl "systemd is required (this installer wires a service)"
require curl "curl is required"
require tar  "tar is required"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64|armv7l) : ;;
  *) warn "untested architecture: $ARCH (continuing)" ;;
esac
log "host: $(uname -s) $ARCH"

# ── 1. Node runtime ──────────────────────────────────────────────────────────
# The bundle is a Nitro node-server build, so a modern Node is the one real
# dependency. We install it rather than asking the operator to.
NODE_BIN="$(command -v node || true)"
NODE_MAJOR=0
[ -n "$NODE_BIN" ] && NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"

if [ "$NODE_MAJOR" -lt 20 ]; then
  log "installing Node.js 20 (found: ${NODE_BIN:-none} ${NODE_MAJOR:-})"
  if command -v apt-get >/dev/null 2>&1; then
    run bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -'
    run apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    run dnf install -y nodejs
  else
    die "no supported package manager; install Node.js >= 20 manually, then re-run"
  fi
  NODE_BIN="$(command -v node || echo /usr/bin/node)"
else
  log "node: $NODE_BIN ($("$NODE_BIN" -v))"
fi

# ── 2. Service user + directories ────────────────────────────────────────────
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  log "creating service user: $RUN_USER"
  run useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$RUN_USER"
fi
run mkdir -p "$INSTALL_DIR" "$ETC_DIR"
run chmod 750 "$ETC_DIR"

# ── 3. Fetch + unpack the bundle ─────────────────────────────────────────────
# Resolve the tag first so the installed version is always recorded, even when
# the operator asked for "latest".
if [ "$RELEASE" = "latest" ]; then
  log "resolving latest venue release..."
  RELEASE="$(curl -fsSL "https://api.github.com/repos/$REPO/releases" \
    | grep -o '"tag_name": *"venue-[^"]*"' | head -1 | sed 's/.*"venue-/venue-/;s/"$//' || true)"
  [ -n "$RELEASE" ] || die "could not resolve a venue-* release; pass --release <tag>"
fi
TARBALL="fanfare-venue.tar.gz"
URL="https://github.com/$REPO/releases/download/$RELEASE/$TARBALL"
log "bundle: $RELEASE"

if [ "$DRY_RUN" = 1 ]; then
  echo "  would download: $URL"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "$URL" -o "$TMP/$TARBALL" || die "download failed: $URL"

  # Verify when the checksum is published; never fail the install if it is not
  # (older releases predate it) — but say so loudly.
  if curl -fsSL "$URL.sha256" -o "$TMP/$TARBALL.sha256" 2>/dev/null; then
    ( cd "$TMP" && sha256sum -c "$TARBALL.sha256" >/dev/null ) \
      || die "checksum mismatch — refusing to install"
    log "checksum ok"
  else
    warn "no published checksum for $RELEASE — skipping verification"
  fi

  tar -xzf "$TMP/$TARBALL" -C "$TMP"
  # Replace atomically-ish: keep the old tree until the new one is in place.
  rm -rf "$INSTALL_DIR/output.new"
  cp -R "$TMP/fanfare-venue/output" "$INSTALL_DIR/output.new"
  rm -rf "$INSTALL_DIR/output.old"
  [ -d "$INSTALL_DIR/output" ] && mv "$INSTALL_DIR/output" "$INSTALL_DIR/output.old"
  mv "$INSTALL_DIR/output.new" "$INSTALL_DIR/output"
  cp -f "$TMP/fanfare-venue/BUNDLE.json" "$INSTALL_DIR/BUNDLE.json" 2>/dev/null || true
  chown -R "$RUN_USER:$RUN_USER" "$INSTALL_DIR"
  log "installed to $INSTALL_DIR"
fi

# ── 4. Claim the device ──────────────────────────────────────────────────────
# The one interactive step. Everything the till needs to be part of an org
# comes back from this call (#1662) — there is no config to hand-edit.
claim_device() {
  if [ -z "$PAIRING_CODE" ]; then
    if [ -t 0 ]; then
      printf '[install] pairing code (from the app, 8 characters): '
      read -r PAIRING_CODE
    else
      die "no pairing code: pass --code <code> (stdin is not a terminal)"
    fi
  fi
  PAIRING_CODE="$(echo "$PAIRING_CODE" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')"
  echo "$PAIRING_CODE" | grep -qE '^[0-9A-HJ-NP-Z]{8}$' \
    || die "that does not look like a pairing code (8 chars, no I or O)"

  [ -n "$DEVICE_NAME" ] || DEVICE_NAME="$(hostname)"

  log "claiming as \"$DEVICE_NAME\" against $API_URL ..."
  if [ "$DRY_RUN" = 1 ]; then
    echo "  would POST $API_URL/api/crouton-sales/devices/claim"
    return 0
  fi

  local body http
  body="$(curl -fsS -w '\n%{http_code}' -X POST \
    -H 'content-type: application/json' \
    -d "{\"code\":\"$PAIRING_CODE\",\"deviceName\":\"$DEVICE_NAME\"}" \
    "$API_URL/api/crouton-sales/devices/claim" 2>/dev/null || true)"
  http="$(echo "$body" | tail -1)"
  body="$(echo "$body" | sed '$d')"

  case "$http" in
    200) : ;;
    401) die "the pairing code was rejected — mint a fresh one in the app" ;;
    410) die "that pairing code is used up or expired — mint a fresh one" ;;
    429) die "too many attempts; this code is locked for a while — wait, then retry" ;;
    *)   die "claim failed (HTTP ${http:-no response}) against $API_URL" ;;
  esac

  # Persist the identity. 0600 root-owned: deviceSecret is a credential.
  local dev org evt tok sec
  dev="$(echo "$body" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).deviceId||""))')"
  org="$(echo "$body" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).orgId||""))')"
  evt="$(echo "$body" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).eventId||""))')"
  tok="$(echo "$body" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token||""))')"
  sec="$(echo "$body" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).deviceSecret||""))')"
  [ -n "$dev" ] || die "claim returned no device id — refusing to write a partial identity"

  umask 077
  cat > "$DEVICE_FILE" <<EOF
# Written by install.sh at claim time (#804). Do not edit by hand —
# re-run the installer with --reclaim to replace this identity.
FANFARE_DEVICE_ID=$dev
FANFARE_ORG_ID=$org
FANFARE_EVENT_ID=$evt
FANFARE_DEVICE_TOKEN=$tok
FANFARE_DEVICE_SECRET=$sec
FANFARE_API_URL=$API_URL
EOF
  chmod 600 "$DEVICE_FILE"
  log "claimed: device=$dev org=$org event=${evt:-<none yet>}"
}

if [ "$SKIP_CLAIM" = 1 ]; then
  log "skipping claim (--skip-claim)"
elif [ -f "$DEVICE_FILE" ] && [ "$RECLAIM" != 1 ]; then
  log "already claimed (use --reclaim to re-pair); leaving $DEVICE_FILE alone"
else
  claim_device
fi

# ── 5. Base env ──────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  log "writing $ENV_FILE"
  if [ "$DRY_RUN" = 1 ]; then
    echo "  would write $ENV_FILE"
  else
    umask 077
    cat > "$ENV_FILE" <<EOF
# Base runtime env for the venue till. Device identity lives in device.env.
NITRO_PORT=$PORT
NITRO_HOST=0.0.0.0
NODE_ENV=production
# Set a real value before going live — sessions are signed with this.
BETTER_AUTH_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '\n/+=' | head -c 32)
BETTER_AUTH_URL=http://localhost:$PORT
EOF
    chmod 600 "$ENV_FILE"
  fi
else
  log "keeping existing $ENV_FILE"
fi

# ── 6. systemd unit ──────────────────────────────────────────────────────────
UNIT="/etc/systemd/system/$SERVICE_NAME.service"
log "writing $UNIT"
if [ "$DRY_RUN" = 1 ]; then
  echo "  would write $UNIT, then: systemctl enable --now $SERVICE_NAME"
else
  cat > "$UNIT" <<EOF
[Unit]
Description=Fanfare venue till (local-first POS)
Documentation=https://github.com/$REPO
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
# Optional: absent until the device is claimed.
EnvironmentFile=-$DEVICE_FILE
ExecStart=$NODE_BIN $INSTALL_DIR/output/server/index.mjs
Restart=always
RestartSec=3
# The till must come back by itself after a power cut — that is the whole point.
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
fi

# ── 7. Reachability check ────────────────────────────────────────────────────
# "It installed" is not "it works". Report, never fail the install — a till
# with an unplugged printer should still boot and be fixable on site.
log "checking reachability..."
if [ "$DRY_RUN" = 1 ]; then
  echo "  would check: local app, $API_URL, printers on the LAN"
else
  for _ in $(seq 1 20); do
    curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
    sleep 1
  done
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    log "  ✅ till responds on http://127.0.0.1:$PORT"
  else
    warn "  ❌ till did not respond on :$PORT — check: journalctl -u $SERVICE_NAME -n 50"
  fi

  if curl -fsS -o /dev/null --max-time 8 "$API_URL" 2>/dev/null; then
    log "  ✅ cloud reachable: $API_URL"
  else
    warn "  ⚠️  cloud unreachable: $API_URL (the till still runs offline; sync resumes later)"
  fi

  # Thermal printers listen on :9100. Probe any configured hosts.
  if [ -n "${FANFARE_PRINTER_HOSTS:-}" ]; then
    for host in $FANFARE_PRINTER_HOSTS; do
      if timeout 3 bash -c ">/dev/tcp/$host/9100" 2>/dev/null; then
        log "  ✅ printer reachable: $host:9100"
      else
        warn "  ❌ printer unreachable: $host:9100"
      fi
    done
  else
    log "  (no FANFARE_PRINTER_HOSTS set — skipping printer probe)"
  fi
fi

log ""
log "done — $SERVICE_NAME is installed and enabled."
log "  status : systemctl status $SERVICE_NAME"
log "  logs   : journalctl -u $SERVICE_NAME -f"
# `|| true`: `hostname -I` is Linux-only, and under `set -e` a failing command
# substitution in an assignment aborts the script — which would truncate this
# summary on the very last line.
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
log "  till   : http://${HOST_IP:-<this-box>}:$PORT"
[ -f "$DEVICE_FILE" ] && log "  device : $(grep FANFARE_DEVICE_ID "$DEVICE_FILE" 2>/dev/null | cut -d= -f2)" || true
