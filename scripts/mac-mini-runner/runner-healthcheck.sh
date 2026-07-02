#!/usr/bin/env bash
#
# runner-healthcheck.sh — watchdog for the Mac mini self-hosted GitHub Actions runner FLEET.
#
# Epic #610 / issue #657 (WS5 — "keep the always-on agent loop reliable"), made
# fleet-aware in #1045 (N same-labelled runners on the one box — one runner = one
# concurrent job, so scaling = more registered runners, and the watchdog must notice
# runner-2 dying even while runner-1 is fine).
#
# What it checks, in order:
#   1. EVERY installed runner service (one `actions.runner.*.plist` per runner in
#      ~/Library/LaunchAgents) is loaded in launchd with a live wrapper PID.
#   2. Each runner's own `Runner.Listener` process exists (matched by install dir —
#      `<dir>/bin/Runner.Listener` — so a dead listener is attributed to the right runner).
#   3. The box can reach GitHub (the fleet is useless if it's online but isolated).
#   4. (best-effort) The repo's GitHub API reports >= EXPECTED online runners —
#      "expected 3, only 2 online" is a failure even though >=1 is up.
#
# On any failure it (a) restarts the FAILED runner(s) via launchd (healthy ones are left
# alone), (b) alerts via the optional ALERT_WEBHOOK (Slack/Discord-style JSON `{text}`
# POST), and (c) exits non-zero so launchd/log readers can see the failure. A clean pass
# exits 0 quietly (one log line per runner).
#
# This is the userspace twin of the pi runbook's "auth-retry-with-backoff" idea: the
# launchd `KeepAlive` already restarts a crashed *process*; this watchdog catches the
# cases KeepAlive can't see — a wedged-but-alive listener, or a lost GitHub connection.
#
# Designed to be driven by com.nuxtcrouton.runner-watchdog.plist (runs every 5 min), but
# it's a plain script — run it by hand any time to get a status read.
#
# ── Configuration (all optional; sensible defaults) ──────────────────────────────────
#   RUNNER_LABEL      Custom label we expect (informational).  Default: mac-mini
#   GH_REPO           owner/repo for the API liveness probe.   Default: FriendlyInternet/nuxt-crouton
#   GH_TOKEN          PAT with `repo` (or admin:org) scope for the API probe. If unset,
#                     step 4 is skipped (steps 1–3 still run — no token needed for those).
#   EXPECTED_RUNNERS  How many online runners step 4 requires. Default: the number of
#                     installed runner services found on this box.
#   ALERT_WEBHOOK     Slack/Discord-compatible incoming-webhook URL for failure alerts.
#   LOG_FILE          Where to append logs.  Default: ~/Library/Logs/runner-watchdog.log
#
# NB: keep secrets OUT of this committed file — pass them via the launchd plist's
# EnvironmentVariables or a sourced, gitignored ~/.runner-watchdog.env (see the runbook).

set -uo pipefail

RUNNER_LABEL="${RUNNER_LABEL:-mac-mini}"
GH_REPO="${GH_REPO:-FriendlyInternet/nuxt-crouton}"
LOG_FILE="${LOG_FILE:-$HOME/Library/Logs/runner-watchdog.log}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

# Optionally source a gitignored env file for GH_TOKEN / ALERT_WEBHOOK / EXPECTED_RUNNERS.
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

# ── Fleet discovery ────────────────────────────────────────────────────────────────────
# Every runner install gets its own launchd plist (`./svc.sh install` per runner, #1045's
# add-runner.sh). The plist files are the source of truth for what SHOULD be running —
# `launchctl list` only shows what IS loaded, so a service that fell out of launchd
# entirely would be invisible there.
#   label = plist filename minus .plist   (actions.runner.<owner>-<repo>.<name>)
#   dir   = the runner install dir, extracted from the plist's runsvc.sh path
labels=()
dirs=()
for plist in "$LAUNCH_AGENTS_DIR"/actions.runner.*.plist; do
  [ -f "$plist" ] || continue
  label="$(basename "$plist" .plist)"
  # The svc.sh-generated plist's ProgramArguments points at <install dir>/runsvc.sh.
  dir="$(sed -n 's|.*<string>\(/.*\)/runsvc.sh</string>.*|\1|p' "$plist" | head -1)"
  labels+=("$label")
  dirs+=("${dir:-}")
done

restart_runner() {
  local label="$1" dir="$2"
  log "Restarting runner via launchctl kickstart (label=$label)…"
  # `kickstart -k` kills then restarts the service in the GUI user's domain.
  launchctl kickstart -k "gui/$(id -u)/$label" 2>>"$LOG_FILE" && return 0
  # Fallback: use the runner's own svc.sh if kickstart failed.
  if [ -n "$dir" ] && [ -x "$dir/svc.sh" ]; then
    log "Restarting runner via svc.sh (dir=$dir)…"
    ( cd "$dir" && ./svc.sh stop; ./svc.sh start ) 2>>"$LOG_FILE" && return 0
  fi
  return 1
}

fail=0
failed_labels=()
failed_dirs=()

mark_failed() { fail=1; failed_labels+=("$1"); failed_dirs+=("$2"); }

# ── 1+2. Per runner: service loaded with live PID, and its own Runner.Listener alive? ──
if [ "${#labels[@]}" -eq 0 ]; then
  alert "no actions.runner.*.plist installed under $LAUNCH_AGENTS_DIR — no runner services on this box"
  fail=1
else
  for i in "${!labels[@]}"; do
    label="${labels[$i]}"; dir="${dirs[$i]}"
    # `launchctl list <label>` prints a plist; the PID line is `"PID" = N;` when running.
    # NB: launchd tracks the PID of the runner's WRAPPER (`runsvc.sh`), NOT the listener —
    # the real `Runner.Listener` runs as a child of that wrapper. So "healthy" = the
    # service has a live wrapper PID AND that runner's own Runner.Listener process exists
    # (matched on the install dir so fleet members don't vouch for each other).
    pid="$(launchctl list "$label" 2>/dev/null | awk -F'= ' '/"PID"/ {gsub(/[ ;]/,"",$2); print $2}')"
    if [ -z "$pid" ] || [ "$pid" = "-" ]; then
      alert "runner service '$label' is installed but has no running PID (not loaded or crashed)"
      mark_failed "$label" "$dir"
    elif [ -n "$dir" ] && ! pgrep -f "$dir/bin/Runner.Listener" >/dev/null 2>&1; then
      alert "runner service '$label' is up (wrapper pid=$pid) but its Runner.Listener ($dir) is gone (wedged wrapper / dead listener)"
      mark_failed "$label" "$dir"
    elif [ -z "$dir" ] && ! pgrep -f 'Runner.Listener' >/dev/null 2>&1; then
      # Couldn't parse the install dir from the plist — fall back to the any-listener check.
      alert "runner service '$label' is up (wrapper pid=$pid) but no Runner.Listener process exists"
      mark_failed "$label" "$dir"
    else
      listener_pid="$(pgrep -f "${dir:+$dir/bin/}Runner.Listener" | head -1)"
      log "OK: runner '$label' alive (wrapper pid=$pid, listener pid=$listener_pid, label=$RUNNER_LABEL)"
    fi
  done
fi

# ── 3. Can the box reach GitHub at all? ───────────────────────────────────────────────
if ! curl -fsS -m 10 -o /dev/null https://api.github.com; then
  alert "cannot reach api.github.com (network down or GitHub unreachable)"
  fail=1
else
  log "OK: api.github.com reachable"
fi

# ── 4. Does the repo report the WHOLE fleet online? (needs GH_TOKEN) ──────────────────
# Fleet-aware (#1045): >=1 online is NOT a pass when 3 are installed — compare against
# EXPECTED_RUNNERS (default: the number of installed services found above).
expected="${EXPECTED_RUNNERS:-${#labels[@]}}"
if [ -n "${GH_TOKEN:-}" ] && [ "$expected" -gt 0 ]; then
  online="$(curl -fsS -m 15 \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$GH_REPO/actions/runners" 2>/dev/null \
    | grep -c '"status": *"online"')"
  if [ "${online:-0}" -ge "$expected" ]; then
    log "OK: GitHub reports $online online runner(s) for $GH_REPO (expected >= $expected)"
  else
    alert "GitHub API reports only ${online:-0} online runner(s) for $GH_REPO — expected $expected"
    fail=1
  fi
else
  log "SKIP: GH_TOKEN unset — skipping GitHub API fleet probe (steps 1–3 still ran)"
fi

# ── Recover — restart only the runners that failed ────────────────────────────────────
if [ "$fail" -ne 0 ]; then
  if [ "${#failed_labels[@]}" -eq 0 ]; then
    # A global failure (network / API count) with no specific runner to kick.
    alert "failure without an attributable runner (network or fleet-count) — check the box"
  else
    for i in "${!failed_labels[@]}"; do
      label="${failed_labels[$i]}"; dir="${failed_dirs[$i]}"
      if restart_runner "$label" "$dir"; then
        log "Recovery: restart issued for '$label'. Re-verifying in 15s…"
        sleep 15
        if pgrep -f "${dir:+$dir/bin/}Runner.Listener" >/dev/null 2>&1; then
          new_pid="$(pgrep -f "${dir:+$dir/bin/}Runner.Listener" | head -1)"
          log "Recovery: '$label' back up (Runner.Listener pid=$new_pid)"
          alert "runner '$label' was down and has been auto-restarted (listener pid=$new_pid)"
        else
          alert "runner '$label' restart attempted but its Runner.Listener is not up — needs a human"
        fi
      else
        alert "could not restart runner '$label' (kickstart and svc.sh both failed) — needs a human"
      fi
    done
  fi
  exit 1
fi

log "PASS: all checks green (${#labels[@]} runner service(s))"
exit 0
