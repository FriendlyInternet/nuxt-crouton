#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Installs workspace dependencies and builds the @fyit/crouton-* packages so
# apps boot and tests/linters run. The container state is cached into the
# environment snapshot after this completes, so later sessions start fast.
#
# Local (non-web) sessions are skipped — local dev manages its own setup.
set -euo pipefail

# Issue-first reminder — surfaces in EVERY session (before the remote-only
# setup gate). The repo tracks work as GitHub issues; the easiest step to skip
# is opening the issue BEFORE coding. See CLAUDE.md "ISSUE-FIRST (HARD GATE)"
# and the github-tasks skill.
cat <<'REMINDER'
[session-start] 📋 ISSUE-FIRST: before writing code for any new feature/package/app,
  open the GitHub issue first (epic + sub-issues for multi-step work) via the
  github-tasks skill, and add its pkg:/app: label to .github/labels.yml. Work
  lands via a PR (Closes #NN), not direct pushes to main. A missing issue = a
  failing build: stop and create it.
REMINDER

# Headless-browser announcement — surfaces in EVERY session so no agent has to
# rediscover it (the recurring trap: the Playwright browser DOWNLOAD is
# egress-blocked, so `npx playwright install` fails and a session wrongly
# concludes "no browser" — when a chromium is ALREADY installed under
# /opt/pw-browsers). You CAN screenshot/preview UI locally. Use
# `node scripts/app-shots.mjs <url> <path[:name]>` (it auto-resolves the build).
_chromium=""
for _c in /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell \
          /opt/pw-browsers/chromium-*/chrome-linux/chrome; do
  [ -x "$_c" ] && _chromium="$_c"
done
if [ -n "$_chromium" ]; then
  cat <<BROWSER
[session-start] 📸 HEADLESS BROWSER AVAILABLE — you can render/screenshot UI locally.
  chromium: $_chromium  (the download host is egress-blocked; use this pre-installed one)
  Easiest: node scripts/app-shots.mjs <baseUrl> <path[:name]>  → screenshots/<name>.png
  Do NOT conclude "no browser" from a failed \`playwright install\` — verify, don't assume.
BROWSER
fi

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# CLAUDE_PROJECT_DIR is set by the harness in a real invocation; fall back to
# the repo root relative to this script so the hook is also runnable directly.
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Provide a dev BETTER_AUTH_SECRET so apps (e.g. fanfare) boot without manual
# env config. Generated once and reused (kept outside the repo so it's stable
# across sessions and never committed). Dev-only — production uses its own
# secret. Skipped if you've already set BETTER_AUTH_SECRET in the env config.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  dev_secret_file="${HOME:-/root}/.crouton-dev-auth-secret"
  if [ ! -s "$dev_secret_file" ]; then
    openssl rand -hex 32 > "$dev_secret_file" 2>/dev/null || true
  fi
  if [ -s "$dev_secret_file" ]; then
    echo "export BETTER_AUTH_SECRET=$(cat "$dev_secret_file")" >> "$CLAUDE_ENV_FILE"
    echo "[session-start] dev BETTER_AUTH_SECRET exported"
  fi
fi

echo "[session-start] pnpm install…"
pnpm install

# Apps (e.g. fanfare) won't boot until the crouton packages' dist exists — the
# dev server errors on a missing crouton-core/dist. Build them once here.
echo "[session-start] pnpm build:packages…"
pnpm build:packages

echo "[session-start] done."
