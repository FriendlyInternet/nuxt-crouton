#!/usr/bin/env bash
#
# runner-healthcheck.sh — watchdog for the Mac mini self-hosted GitHub Actions runner.
#
# Epic #610 / issue #657 (WS5 — "keep the always-on agent loop reliable").
#
# What it checks, in order:
#   1. The runner's own launchd service (`actions.runner.*`) is loaded and has a live PID.
#   2. That PID is actually a `Runner.Listener` process (not a zombie / wrong PID).
#   3. The box can reach GitHub (the runner is useless if it's online but isolated).
#   4. (best-effort) The repo's GitHub API reports >=1 ONLINE self-hosted runner.
#
# On any failure it (a) tries to restart the runner via launchd, (b) alerts via the
# optional ALERT_WEBHOOK (Slack/Discord-style JSON `{text}` POST), and (c) exits non-zero
# so launchd/log readers can see the failure. A clean pass exits 0 quietly (one log line).
#
# This is the userspace twin of the pi runbook's "auth-retry-with-backoff" idea: the
# launchd `KeepAlive` already restarts a crashed *process*; this watchdog catches the
# cases KeepAlive can't see — a wedged-but-alive listener, or a lost GitHub connection.
#
# Designed to be driven by com.nuxtcrouton.runner-watchdog.plist (runs every 5 min), but
# it's a plain script — run it by hand any time to get a status read.
#
# ── Configuration (all optional; sensible defaults) ──────────────────────────────────
#   RUNNER_DIR        Path to the actions-runner install.  Default: ~/actions-runner
#   RUNNER_LABEL      Custom label we expect (informational).  Default: mac-mini
#   GH_REPO           owner/repo for the API liveness probe.   Default: FriendlyInternet/nuxt-crouton
#   GH_TOKEN          PAT with `repo` (or admin:org) scope for the API probe. If unset,
#                     step 4 is skipped (steps 1–3 still run — no token needed for those).
#   ALERT_WEBHOOK     Slack/Discord-compatible incoming-webhook URL for failure alerts.
#   LOG_FILE          Where to append logs.  Default: ~/Library/Logs/runner-watchdog.log
#
# NB: keep secrets OUT of this committed file — pass them via the launchd plist's
# EnvironmentVariables or a sourced, gitignored ~/.runner-watchdog.env (see the runbook).

set -uo pipefail

RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_LABEL="${RUNNER_LABEL:-mac-mini}"
GH_REPO="${GH_REPO:-FriendlyInternet/nuxt-crouton}"
LOG_FILE="${LOG_FILE:-$HOME/Library/Logs/runner-watchdog.log}"

# Optionally source a gitignored env file for GH_TOKEN / ALERT_WEBHOOK.
[ -f "$HOME/.runner-watchdog.env" ] && . "$HOME/.runner-watchdog.env"

mkdir -p "$(dirname "$LOG_FILE")"

log() { printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$LOG_FILE" >&2; }

alert() {
  local msg="$1"
  log "ALERT: $msg"
  if [ -n "${ALERT_WEBHOOK:-}" ]; then
    curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"🔴 mac-mini runner watchdog: ${msg}\"}" \
      "$ALERT_WEBHOOK" >/dev/null 2>&1 \
      || log "WARN: alert webhook POST failed"
  fi
}

# The launchd label the runner's own `./svc.sh install` creates is of the form
# `actions.runner.<owner>-<repo>.<runnerName>`. We don't know the suffix, so match the prefix.
runner_launchd_label() {
  launchctl list 2>/dev/null | awk '/actions\.runner\./ {print $3; exit}'
}

restart_runner() {
  local label
  label="$(runner_launchd_label)"
  if [ -n "$label" ]; then
    log "Restarting runner via launchctl kickstart (label=$label)…"
    # `kickstart -k` kills then restarts the service in the GUI user's domain.
    launchctl kickstart -k "gui/$(id -u)/$label" 2>>"$LOG_FILE" \
      && return 0
  fi
  # Fallback: use the runner's own svc.sh if the label lookup failed.
  if [ -x "$RUNNER_DIR/svc.sh" ]; then
    log "Restarting runner via svc.sh (dir=$RUNNER_DIR)…"
    ( cd "$RUNNER_DIR" && ./svc.sh stop; ./svc.sh start ) 2>>"$LOG_FILE" && return 0
  fi
  return 1
}

fail=0

# ── 1+2. Is the runner service loaded and is its PID a live Runner.Listener? ──────────
svc_label="$(runner_launchd_label)"
if [ -z "$svc_label" ]; then
  alert "no actions.runner.* launchd service is loaded"
  fail=1
else
  # `launchctl list <label>` prints a plist; the PID line is `"PID" = N;` when running.
  # NB: launchd tracks the PID of the runner's WRAPPER (`runsvc.sh`), NOT the listener —
  # the real `Runner.Listener` runs as a child of that wrapper. So "healthy" = the service
  # has a live wrapper PID AND a Runner.Listener process exists somewhere. (Checking that
  # the wrapper PID itself is a Runner.Listener is wrong — it's bash — and would restart a
  # perfectly healthy runner every cycle.)
  pid="$(launchctl list "$svc_label" 2>/dev/null | awk -F'= ' '/"PID"/ {gsub(/[ ;]/,"",$2); print $2}')"
  if [ -z "$pid" ] || [ "$pid" = "-" ]; then
    alert "runner service '$svc_label' is loaded but has no running PID"
    fail=1
  elif ! pgrep -f 'Runner.Listener' >/dev/null 2>&1; then
    alert "runner service '$svc_label' is up (wrapper pid=$pid) but no Runner.Listener process exists (wedged wrapper / dead listener)"
    fail=1
  else
    listener_pid="$(pgrep -f 'Runner.Listener' | head -1)"
    log "OK: runner '$svc_label' alive (wrapper pid=$pid, listener pid=$listener_pid, label=$RUNNER_LABEL)"
  fi
fi

# ── 3. Can the box reach GitHub at all? ───────────────────────────────────────────────
if ! curl -fsS -m 10 -o /dev/null https://api.github.com; then
  alert "cannot reach api.github.com (network down or GitHub unreachable)"
  fail=1
else
  log "OK: api.github.com reachable"
fi

# ── 4. Does the repo report a live self-hosted runner? (needs GH_TOKEN) ───────────────
if [ -n "${GH_TOKEN:-}" ]; then
  online="$(curl -fsS -m 15 \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$GH_REPO/actions/runners" 2>/dev/null \
    | grep -c '"status": *"online"')"
  if [ "${online:-0}" -ge 1 ]; then
    log "OK: GitHub reports $online online runner(s) for $GH_REPO"
  else
    alert "GitHub API reports 0 online runners for $GH_REPO"
    fail=1
  fi
else
  log "SKIP: GH_TOKEN unset — skipping GitHub API liveness probe (steps 1–3 still ran)"
fi

# ── Recover ───────────────────────────────────────────────────────────────────────────
if [ "$fail" -ne 0 ]; then
  if restart_runner; then
    log "Recovery: restart issued. Re-verifying in 15s…"
    sleep 15
    if pgrep -f 'Runner.Listener' >/dev/null 2>&1; then
      new_pid="$(pgrep -f 'Runner.Listener' | head -1)"
      log "Recovery: runner back up (Runner.Listener pid=$new_pid)"
      alert "runner was down and has been auto-restarted (listener pid=$new_pid)"
    else
      alert "runner restart attempted but no Runner.Listener is up — needs a human"
    fi
  else
    alert "could not restart the runner (no launchd label and no svc.sh) — needs a human"
  fi
  exit 1
fi

log "PASS: all checks green"
exit 0
