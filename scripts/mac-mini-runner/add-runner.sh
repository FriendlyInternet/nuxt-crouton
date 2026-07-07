#!/usr/bin/env bash
#
# add-runner.sh — register an ADDITIONAL GitHub Actions runner on the Mac mini.
#
# Epic #610 / issue #1045 (scale the mini to N concurrent jobs). A runner executes
# exactly ONE job at a time — concurrency = more registered runners. This script
# automates the per-runner dance from the runbook (§6) for runner #N on the same box:
#
#   ~/actions-runner-<N>/          (new install dir, reuses the first runner's tarball)
#     ./config.sh --name mac-mini-<N> --labels mac-mini   (same label → same routing)
#     echo "$PATH" > .path         (the launchd-minimal-PATH gotcha, runbook §2a)
#     ./svc.sh install && start    (own launchd service, always-on)
#
# Usage (🖥️ on the mini, as the runner user):
#   RUNNER_TOKEN=<fresh registration token> ./add-runner.sh <N>
#   # e.g.  RUNNER_TOKEN=AXXXX... ./add-runner.sh 2
#
# The registration token comes from repo Settings → Actions → Runners → "New self-hosted
# runner" (expires in ~1h — mint a FRESH one per runner). It is passed via env/arg only,
# never stored. Re-running for an existing N is safe: --replace re-registers cleanly.
#
# Resource sizing (#1045): each slot can be a full Nuxt build / Playwright run / in-job
# Claude agent. Default fleet = 3 on the mini — don't over-provision or the box thrashes.

set -euo pipefail

N="${1:-}"
TOKEN="${RUNNER_TOKEN:-${2:-}}"
REPO_URL="${REPO_URL:-https://github.com/FriendlyInternet/nuxt-crouton}"
BASE_DIR="${BASE_DIR:-$HOME/actions-runner}"          # the first runner's install

die() { echo "ERROR: $*" >&2; exit 1; }

# Locate the runner tarball. Prefer the fixed name the runbook §1a downloads to, but
# fall back to the versioned name GitHub ships (actions-runner-osx-*.tar.gz) — runner #1
# may have been set up by hand without the `-o` rename (the #1200 drift). Explicit
# TARBALL= always wins.
if [ -z "${TARBALL:-}" ]; then
  if [ -f "$BASE_DIR/actions-runner.tar.gz" ]; then
    TARBALL="$BASE_DIR/actions-runner.tar.gz"
  else
    TARBALL="$(ls -t "$BASE_DIR"/actions-runner-osx-*.tar.gz 2>/dev/null | head -1 || true)"
  fi
fi

[ -n "$N" ] || die "usage: RUNNER_TOKEN=<token> $0 <N>   (N = runner number, e.g. 2)"
case "$N" in *[!0-9]*|'') die "<N> must be a number, got '$N'";; esac
[ "$N" -ge 2 ] || die "N starts at 2 — runner #1 is the original ~/actions-runner install"
[ -n "$TOKEN" ] || die "no registration token — pass RUNNER_TOKEN=<token> (repo Settings → Actions → Runners → New self-hosted runner)"
[ -n "$TARBALL" ] && [ -f "$TARBALL" ] || die "runner tarball not found in $BASE_DIR (looked for actions-runner.tar.gz and actions-runner-osx-*.tar.gz) — download it per runbook §1a first, or set TARBALL="

DIR="$HOME/actions-runner-$N"
NAME="mac-mini-$N"

echo "==> Installing runner '$NAME' into $DIR"
mkdir -p "$DIR"
tar xzf "$TARBALL" -C "$DIR"

cd "$DIR"

echo "==> Registering '$NAME' (label: mac-mini) against $REPO_URL"
./config.sh \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "$NAME" \
  --labels mac-mini \
  --work _work \
  --unattended \
  --replace

# The launchd-minimal-PATH gotcha (runbook §2a): jobs don't see Homebrew/nvm unless the
# runner's .path file carries the interactive PATH. Prefer inheriting the first runner's
# .path (known-good), fall back to the current shell's PATH.
if [ -f "$BASE_DIR/.path" ]; then
  cp "$BASE_DIR/.path" .path
  echo "==> Copied .path from $BASE_DIR (toolchain PATH)"
else
  echo "$PATH" > .path
  echo "==> Wrote current \$PATH to .path (no $BASE_DIR/.path to copy)"
fi

echo "==> Installing + starting the launchd service"
./svc.sh install
./svc.sh start
./svc.sh status

echo
echo "✅ Runner '$NAME' is up. Verify: repo Settings → Actions → Runners shows '$NAME'"
echo "   Idle with labels self-hosted, macOS, ARM64, mac-mini."
echo "   The fleet-aware watchdog (runner-healthcheck.sh) picks it up automatically."
