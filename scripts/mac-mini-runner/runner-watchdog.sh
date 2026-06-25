#!/usr/bin/env bash
# runner-watchdog.sh — keep the Mac mini's GitHub Actions runner connected (#657).
#
# launchd KeepAlive already relaunches a *crashed* runner process. This watchdog covers
# what KeepAlive can't see: the process is alive but DISCONNECTED from GitHub (network
# blip, wedged listener). It runs on a schedule (see com.fyit.runner-watchdog.plist),
# and on failure it restarts the runner service and optionally pings an alert webhook.
#
# Deploy: see scripts/mac-mini-runner/README.md. Configure via env in the plist:
#   RUNNER_DIR   path to the actions-runner checkout (default ~/actions-runner)
#   ALERT_WEBHOOK  optional Slack/Discord/generic webhook URL; posts JSON {text:...} on failure
#
# Exit codes: 0 = healthy (or recovered), 1 = unhealthy and restart attempted.
set -uo pipefail

RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"
LOG_TAG="runner-watchdog"

log() { echo "$(date -u +%FT%TZ) [$LOG_TAG] $*"; }

alert() {
  local msg="$1"
  log "ALERT: $msg"
  [ -n "$ALERT_WEBHOOK" ] || return 0
  # Generic JSON {"text": "..."} — works for Slack/Discord-compatible incoming webhooks.
  curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
    -d "{\"text\":\"🛠️ mac-mini runner watchdog: ${msg}\"}" \
    "$ALERT_WEBHOOK" >/dev/null 2>&1 || log "warn: alert webhook POST failed"
}

# 1) Is the runner LISTENER process alive? (svc.sh KeepAlive owns the crash case; we
#    double-check so a wedged-but-present process is still caught by the connectivity test.)
listener_alive() { pgrep -f "Runner.Listener" >/dev/null 2>&1; }

# 2) Can the box reach GitHub at all? (distinguishes "GitHub down / our net down" from
#    "runner wedged" — we only restart the runner, never thrash on a dead network.)
github_reachable() {
  curl -fsS -m 10 -o /dev/null "https://api.github.com/zen" 2>/dev/null
}

restart_runner() {
  log "restarting runner service…"
  if [ -x "$RUNNER_DIR/svc.sh" ]; then
    ( cd "$RUNNER_DIR" && ./svc.sh stop >/dev/null 2>&1; ./svc.sh start >/dev/null 2>&1 )
    return $?
  fi
  log "error: $RUNNER_DIR/svc.sh not found or not executable"
  return 1
}

main() {
  if ! github_reachable; then
    # Network/GitHub is the problem, not the runner — log and bail without thrashing.
    log "github unreachable — skipping restart (network or GitHub outage)"
    exit 0
  fi

  if listener_alive; then
    log "ok: Runner.Listener alive and GitHub reachable"
    exit 0
  fi

  alert "Runner.Listener not running (GitHub reachable) — restarting"
  if restart_runner; then
    sleep 5
    if listener_alive; then
      log "recovered: runner restarted, listener back"
      exit 0
    fi
  fi
  alert "runner restart did NOT bring the listener back — needs a human"
  exit 1
}

main "$@"
