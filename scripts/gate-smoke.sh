#!/usr/bin/env bash
# Local one-command runner for the agent-gate positive-case smoke (#1035).
#
# Points a gate's subagent (frontend-review / a11y / red-team) at its
# committed known-bad fixture under .claude/gate-fixtures/<gate>/ and asserts
# the resulting verdict is severe enough to have failed the real per-PR gate.
# This is the local mirror of .github/workflows/gate-smoke.yml — same
# fixtures, same expectation, useful for a quick sanity check without
# round-tripping through Actions.
#
# Requires: the `claude` CLI (Claude Code) on PATH and ANTHROPIC_API_KEY (or
# an already-authenticated Claude Code session) in the environment.
#
# Usage:
#   scripts/gate-smoke.sh <frontend-review|a11y|red-team|all>

set -euo pipefail

GATES_ALL=(frontend-review a11y red-team)
ARG="${1:-}"

if [ -z "$ARG" ]; then
  echo "Usage: $0 <frontend-review|a11y|red-team|all>" >&2
  exit 2
fi

if [ "$ARG" = "all" ]; then
  GATES=("${GATES_ALL[@]}")
else
  GATES=("$ARG")
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "error: the 'claude' CLI is not on PATH. Install Claude Code, or run this" >&2
  echo "smoke via Actions instead: workflow_dispatch on gate-smoke.yml." >&2
  exit 1
fi

FAIL=0

for gate in "${GATES[@]}"; do
  case "$gate" in
    frontend-review|a11y|red-team) ;;
    *)
      echo "error: unknown gate '$gate' (expected frontend-review|a11y|red-team|all)" >&2
      exit 2
      ;;
  esac

  echo "==> Smoking '$gate' against .claude/gate-fixtures/$gate/ ..."
  rm -f gate-smoke-verdict.json

  claude -p "Act as the ${gate} subagent defined in .claude/agents/${gate}.md.
Input: { scope: \".claude/gate-fixtures/${gate}\", depth: \"quick\", fix: false }.
Scan ONLY the file(s) under .claude/gate-fixtures/${gate}/ (ignore the README.md
there and everything else in the repo) through the checklist in the agent
definition. These fixtures are deliberately bad — you are expected to find a
real, severe violation; do not soften or omit it. Then write
gate-smoke-verdict.json at the repo root, exactly: {\"highest\":\"<severity>\"}
using the same severity vocabulary as the real gate's own verdict file. Always
write the file. Do not edit the fixtures. Do not post any comments." \
    --allowedTools Bash,Write,Edit,Read,Grep,Glob \
    --max-turns 40 || true

  if [ ! -f gate-smoke-verdict.json ]; then
    echo "FAIL: $gate produced no verdict on its known-bad fixture (fail-open case)." >&2
    FAIL=1
    continue
  fi

  HIGHEST=$(node -e "process.stdout.write((require('./gate-smoke-verdict.json').highest||'none').toLowerCase())")
  echo "    verdict: $HIGHEST"
  case "$HIGHEST" in
    critical|high)
      echo "    PASS: $gate correctly flagged its known-bad fixture."
      ;;
    *)
      echo "FAIL: $gate did not flag its known-bad fixture as critical/high (got '$HIGHEST')." >&2
      FAIL=1
      ;;
  esac
  rm -f gate-smoke-verdict.json
done

exit $FAIL
