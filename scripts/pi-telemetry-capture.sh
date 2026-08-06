#!/usr/bin/env bash
# pi-telemetry-capture.sh — locate THIS pi run's telemetry, run the adapter, and preserve
# the raw session. Shared by both pi lanes (#2056).
#
# WHY THIS FILE EXISTS. This lived as a byte-identical block inside BOTH
# `work-issue-pidev.yml` and `decompose-on-issue-pidev.yml` — the same duplication that let
# the #2027 claim-guard wedge get half-fixed. Two copies of a diagnostic is one diagnostic
# and one liability, and here BOTH copies carried all three defects below.
#
# WHAT IT USED TO DO, AND WHY THAT WAS WORSE THAN NOTHING. Every run printed "no pi subagent
# telemetry found" and it was structurally unable to print anything else:
#
#   1. WRONG ROOT. It searched only `$HOME/.pi/agent/sessions`, but the WORKER lane passes
#      `--session-dir "$RUNNER_TEMP/pi-session"`. Nothing was ever written where it looked,
#      for any worker run, successful or not. (The decomposer lane passes no --session-dir,
#      so `$HOME` is right for it — which is why one wrong root looked plausible.)
#   2. EMPTY `SINCE`. `find -newermt ""` errors on GNU find and silently matches everything
#      on BSD — and the whole pipeline was `2>/dev/null`, so a probe that could not run and a
#      genuine "nothing found" printed the same reassuring sentence.
#   3. NO RAW CAPTURE. Only the adapter's output was uploaded, so when the adapter found
#      nothing there was nothing left to inspect — and `$RUNNER_TEMP` is wiped when the job
#      ends, taking the session jsonl with it. That is exactly why #2055's 84-second no-op
#      could not be explained afterwards.
#
# EXIT CODE. Always 0. A broken diagnostic must not turn a successful worker run red — that
# trades a silent diagnostic for a misleading verdict. Instead a broken probe emits an
# `::error::` annotation and says PROBE BROKEN, so it can never again read as "all clear".
# The three outcomes are deliberately distinguishable: PROBE BROKEN ≠ "ran cleanly, found
# none" ≠ "found telemetry".
#
# Inputs (env): SINCE (run-start ISO timestamp), RUNNER_TEMP, HOME.
# Output: ./pi-telemetry-out/ (uploaded as a build artifact by the caller).

set +e
mkdir -p pi-telemetry-out

if [ -z "${SINCE:-}" ]; then
  echo "::error::PROBE BROKEN — the run-start timestamp (steps.t0.outputs.ts) is empty, so this"
  echo "::error::run's telemetry cannot be distinguished from a previous run's. NOT reporting"
  echo "::error::'no telemetry found': that would be a guess. (#2056)"
  exit 0
fi

# Both roots: the per-run session dir the worker lane passes to pi, plus pi's own default
# (what the decomposer lane uses). Searching both means a future change to either side
# degrades to "found via the other" rather than to silence.
SESS_ROOTS=""
[ -d "$RUNNER_TEMP/pi-session" ] && SESS_ROOTS="$RUNNER_TEMP/pi-session"
[ -d "$HOME/.pi/agent/sessions" ] && SESS_ROOTS="$SESS_ROOTS $HOME/.pi/agent/sessions"
if [ -z "$SESS_ROOTS" ]; then
  echo "::error::PROBE BROKEN — no pi session root exists at either $RUNNER_TEMP/pi-session"
  echo "::error::or $HOME/.pi/agent/sessions. pi wrote no session at all this run. (#2056)"
  exit 0
fi
echo "searching session roots: $SESS_ROOTS"

# The most-recently-modified subagent-artifacts dir MODIFIED DURING THIS RUN (#1019):
# `-newermt "$SINCE"` scopes to dirs touched at/after the run-start timestamp, so we never
# mis-attribute a PRIOR run's telemetry (the #839 stale-row bug). `-newermt` works on both
# BSD find (the mac-mini) and GNU find (ubuntu fallback). Errors are KEPT (not `2>/dev/null`)
# so a find that cannot run says so instead of looking empty.
# shellcheck disable=SC2086 # word-splitting SESS_ROOTS into multiple find roots is intended
FIND_ERR="$(find $SESS_ROOTS -type d -name subagent-artifacts -newermt "$SINCE" 2>&1 >"$RUNNER_TEMP/tele-dirs.txt")"
if [ -n "$FIND_ERR" ]; then
  echo "::error::PROBE BROKEN — find failed while scanning for telemetry: $FIND_ERR (#2056)"
  exit 0
fi

# Newest-first by mtime via `ls -dt`, which means the same thing on BSD and GNU.
# NOT `stat`: the two platforms give `-f` opposite meanings — on GNU it prints FILESYSTEM
# stats and EXITS 0, so the old "BSD form, then GNU fallback" resolved to a line of
# free-space numbers and the fallback never ran. Verified on a real runner.
# The non-empty guard is load-bearing: `xargs` with no input still runs `ls -dt`, which
# prints `.` — a real directory, so an empty result would have been handed to the adapter
# as if it were the session.
TELE_DIR=""
if [ -s "$RUNNER_TEMP/tele-dirs.txt" ]; then
  TELE_DIR="$(tr '\n' '\0' < "$RUNNER_TEMP/tele-dirs.txt" | xargs -0 ls -dt 2>/dev/null | head -n1)"
fi

if [ -n "$TELE_DIR" ] && [ -d "$TELE_DIR" ]; then
  echo "pi telemetry dir: $TELE_DIR"
  node .claude/skills/loop-station/pi-telemetry.mjs "$TELE_DIR"          > pi-telemetry-out/pi-trace.jsonl    2>pi-telemetry-out/adapter.err
  node .claude/skills/loop-station/pi-telemetry.mjs "$TELE_DIR" --ledger > pi-telemetry-out/ledger-rows.jsonl 2>>pi-telemetry-out/adapter.err
  [ -s pi-telemetry-out/adapter.err ] && echo "::warning::pi-telemetry adapter wrote to stderr — see the adapter.err artifact"
  echo "── #883 ledger-row slice from THIS pi run (model · cost · turns · wall) ──"
  cat pi-telemetry-out/ledger-rows.jsonl || true
else
  echo "probe ran cleanly; no subagent-artifacts dir was touched during this run."
  echo "(A decompose-only run — sub-issues, no worker — legitimately writes none.)"
fi

# ALWAYS keep the raw session, whatever the adapter made of it. $RUNNER_TEMP is wiped when
# the job ends, so this is the only chance to preserve the one file that can explain a
# no-op run after the fact (#2055).
if [ -d "$RUNNER_TEMP/pi-session" ]; then
  mkdir -p pi-telemetry-out/session
  cp -R "$RUNNER_TEMP/pi-session/." pi-telemetry-out/session/ 2>/dev/null
  echo "captured raw pi session ($(find pi-telemetry-out/session -type f | wc -l | tr -d ' ') files)"
else
  echo "::warning::no raw pi session at $RUNNER_TEMP/pi-session to capture (#2055)"
fi
