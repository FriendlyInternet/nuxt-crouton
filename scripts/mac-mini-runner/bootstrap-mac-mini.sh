#!/usr/bin/env bash
#
# bootstrap-mac-mini.sh — recreate the WHOLE Mac mini runner box: bare mini → fleet online.
#
# Epic #610 / issue #1200. This is the one-shot, IDEMPOTENT version of the manual runbook
# (writeups/setup/self-hosted-mac-mini-runner.md). Safe to re-run: every phase detects what's
# already present and skips it, so on an already-set-up box it is a no-op, and on a fresh (or
# wiped) mini it stands the box up from scratch.
#
# Covers (the runner box): toolchain · runner #1 download+register · fleet of N · launchd
# services · no-sleep (pmset + caffeinate) · fleet-aware watchdog.
# Does NOT cover: pi.dev extensions/settings (→ #1060, config-as-code) or worker secrets.
#
# Usage (🖥️ on the mini, as the runner user):
#   RUNNER_TOKEN=<fresh reg token> ./bootstrap-mac-mini.sh [FLEET]
#     FLEET   how many runners total (default 3). Env FLEET= also works.
#   The token: repo Settings → Actions → Runners → New self-hosted runner, OR
#     gh api -X POST repos/<owner>/<repo>/actions/runners/registration-token -q .token
#   A token is only needed when a runner actually has to (re)register — a full no-op re-run
#   needs none (pass one anyway if unsure; it's harmless and single-use).
#
# Dry run: DRY_RUN=1 ./bootstrap-mac-mini.sh   (prints what it WOULD do, mutates nothing)

set -euo pipefail

FLEET="${1:-${FLEET:-3}}"
TOKEN="${RUNNER_TOKEN:-}"
REPO_URL="${REPO_URL:-https://github.com/FriendlyInternet/nuxt-crouton}"
RUNNER_VERSION="${RUNNER_VERSION:-2.335.1}"
RUNNER_ARCH="${RUNNER_ARCH:-osx-arm64}"
BASE_DIR="$HOME/actions-runner"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_CLONE="${REPO_CLONE:-$(cd "$SCRIPT_DIR/../.." && pwd)}"   # this repo checkout (watchdog path)
DRY_RUN="${DRY_RUN:-0}"

die()  { echo "ERROR: $*" >&2; exit 1; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
skip() { echo "   ✓ $* — already present, skipping"; }
have() { command -v "$1" >/dev/null 2>&1; }
run()  { if [ "$DRY_RUN" = 1 ]; then echo "   [dry-run] $*"; else eval "$@"; fi; }

case "$FLEET" in *[!0-9]*|'') die "FLEET must be a number, got '$FLEET'";; esac
[ "$FLEET" -ge 1 ] || die "FLEET must be ≥ 1"
[ "$(uname -s)" = "Darwin" ] || die "this bootstrap is macOS-only (Darwin); got $(uname -s)"
[ "$DRY_RUN" = 1 ] && echo "*** DRY RUN — no changes will be made ***"

# ── 1. Toolchain ────────────────────────────────────────────────────────────────────────
# node 22 (via nvm) · pnpm (via corepack) · gh · wrangler. Detect first; install only what's
# missing. Homebrew is a prerequisite we don't auto-install (it wants an interactive sudo).
step "1. Toolchain"
have brew || die "Homebrew not found — install it first (https://brew.sh), then re-run"
if have node && [ "$(node -v 2>/dev/null | cut -c2- | cut -d. -f1)" -ge 20 ] 2>/dev/null; then
  skip "node $(node -v)"
else
  echo "   installing node 22 via nvm…"
  [ -d "$HOME/.nvm" ] || run 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
  # shellcheck disable=SC1090
  export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  run 'nvm install 22 && nvm alias default 22'
fi
if have pnpm; then skip "pnpm $(pnpm -v)"; else echo "   enabling pnpm via corepack…"; run 'corepack enable && corepack prepare pnpm@latest --activate'; fi
if have gh; then skip "gh $(gh --version | head -1 | awk '{print $3}')"; else run 'brew install gh'; fi
if have wrangler; then skip "wrangler"; else echo "   (wrangler is used via npx from the repo — global optional; skipping)"; fi

# ── 2. Runner #1 — download (fixed name) + register ───────────────────────────────────────
step "2. Runner #1 (download + register)"
mkdir -p "$BASE_DIR"
TARBALL="$BASE_DIR/actions-runner.tar.gz"
if [ -f "$BASE_DIR/config.sh" ]; then
  skip "runner unpacked in $BASE_DIR"
else
  # Prefer an existing versioned tarball (the #1200 drift), else download to the FIXED name.
  EXISTING="$(ls -t "$BASE_DIR"/actions-runner-osx-*.tar.gz 2>/dev/null | head -1 || true)"
  if [ -n "$EXISTING" ]; then TARBALL="$EXISTING"; echo "   using existing tarball $TARBALL";
  else
    URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
    echo "   downloading $URL"
    run "curl -fLo '$TARBALL' '$URL'"
  fi
  run "tar xzf '$TARBALL' -C '$BASE_DIR'"
fi
# Registered already? config.sh writes a .runner file with the runner name.
if [ -f "$BASE_DIR/.runner" ]; then
  skip "runner #1 registered ($(grep -o '"agentName":[^,]*' "$BASE_DIR/.runner" 2>/dev/null | cut -d'"' -f4 || echo mac-mini))"
else
  [ -n "$TOKEN" ] || die "runner #1 not registered and no RUNNER_TOKEN given — mint one and re-run"
  ( cd "$BASE_DIR" && run "./config.sh --url '$REPO_URL' --token '$TOKEN' --name mac-mini --labels mac-mini --work _work --unattended --replace" )
fi
# .path — the launchd-minimal-PATH gotcha (§2a): jobs need the interactive PATH.
if [ -f "$BASE_DIR/.path" ]; then skip ".path present"; else run "echo \"\$PATH\" > '$BASE_DIR/.path'"; fi
# launchd service for #1
if launchctl list 2>/dev/null | grep -q "actions.runner.*\.mac-mini$"; then
  skip "runner #1 launchd service loaded"
else
  ( cd "$BASE_DIR" && run "./svc.sh install" && run "./svc.sh start" )
fi

# ── 3. Fleet — runners 2..FLEET ───────────────────────────────────────────────────────────
step "3. Fleet (runners 2..$FLEET)"
if [ "$FLEET" -lt 2 ]; then echo "   FLEET=1 — single runner, no fleet members to add";
else
  for n in $(seq 2 "$FLEET"); do
    if launchctl list 2>/dev/null | grep -q "actions.runner.*\.mac-mini-$n$"; then
      skip "mac-mini-$n"
    else
      [ -n "$TOKEN" ] || die "mac-mini-$n not present and no RUNNER_TOKEN given — mint a FRESH token per runner and re-run"
      echo "   adding mac-mini-$n (needs its own fresh token)…"
      run "RUNNER_TOKEN='$TOKEN' '$SCRIPT_DIR/add-runner.sh' $n"
      TOKEN=""   # a registration token is single-use — force a fresh one for the next
    fi
  done
fi

# ── 4. No-sleep (pmset policy + caffeinate assertion) ─────────────────────────────────────
step "4. No-sleep"
# Only touch pmset (which needs sudo) if the policy isn't already right — keeps a re-run a
# true no-op with no sudo prompt.
cur_sleep="$(pmset -g 2>/dev/null | awk '$1=="sleep"{print $2; exit}')"
cur_disk="$(pmset -g 2>/dev/null | awk '$1=="disksleep"{print $2; exit}')"
if [ "$cur_sleep" = "0" ] && [ "$cur_disk" = "0" ]; then
  skip "pmset no-sleep policy (sleep 0, disksleep 0)"
else
  echo "   applying pmset no-sleep policy (needs sudo)…"
  for kv in "sleep 0" "disksleep 0" "powernap 0" "autorestart 1" "womp 1"; do run "sudo pmset -c $kv"; done
fi
CAFF="$HOME/Library/LaunchAgents/com.nuxtcrouton.caffeinate.plist"
if [ -f "$CAFF" ]; then skip "caffeinate agent"; else
  run "cat > '$CAFF' <<'PLIST'
<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<plist version=\"1.0\"><dict>
  <key>Label</key><string>com.nuxtcrouton.caffeinate</string>
  <key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-s</string><string>-i</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
PLIST"
  run "launchctl bootstrap gui/\$(id -u) '$CAFF' 2>/dev/null || launchctl load '$CAFF'"
fi

# ── 5. Fleet-aware watchdog ───────────────────────────────────────────────────────────────
step "5. Watchdog"
WD="$HOME/Library/LaunchAgents/com.nuxtcrouton.runner-watchdog.plist"
if launchctl list 2>/dev/null | grep -q "com.nuxtcrouton.runner-watchdog"; then
  skip "watchdog loaded"
else
  # Template the committed plist: swap the YOURNAME placeholders for this box's real paths.
  run "sed -e 's#/Users/YOURNAME/nuxt-crouton#$REPO_CLONE#g' -e 's#/Users/YOURNAME#$HOME#g' '$SCRIPT_DIR/com.nuxtcrouton.runner-watchdog.plist' > '$WD'"
  run "launchctl bootstrap gui/\$(id -u) '$WD' 2>/dev/null || launchctl load '$WD'"
fi

# ── Done ──────────────────────────────────────────────────────────────────────────────────
step "Done — verifying"
if [ "$DRY_RUN" = 1 ]; then echo "   (dry run — nothing changed)"; exit 0; fi
echo "   launchd runner services:"; launchctl list 2>/dev/null | grep "actions.runner" | awk '{print "     " $3}'
echo
echo "✅ Box bootstrapped. Confirm all $FLEET runners show Idle at:"
echo "   $REPO_URL/settings/actions/runners"
echo "   (fleet-aware watchdog runs every 5 min; no-sleep + launchd survive reboot.)"
