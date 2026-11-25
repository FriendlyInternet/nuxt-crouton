#!/usr/bin/env bash
# data-pr.sh — land a generated data file on `main` through an auto-merge PR (#3490).
#
# Replaces direct pushes to `main`, so the Harness App no longer needs to bypass the
# `main` ruleset. One fixed branch per data file: `data/<name>`.
#
#   data-pr.sh start   <name>                      # check out data/<name> (or main) — run BEFORE writing
#   data-pr.sh publish <name> <title> <file...>    # commit, push, open PR if needed, auto-merge
#
# Needs GH_TOKEN = the Harness App token (a GITHUB_TOKEN-opened PR triggers no checks).
# Env: DATA_PR_POLL_MS (poll interval, default 5000), DATA_PR_POLL_MAX (default 12).
set -euo pipefail

cmd="${1:-}"; name="${2:-}"

case "$name" in
  ''|*[!a-z0-9-]*|-*|main|master) echo "data-pr: refusing unsafe name '${name}'" >&2; exit 2 ;;
esac
branch="data/${name}"

jfield() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s||"null");const v=eval("j"+process.argv[1]);console.log(v===null||v===undefined?"":(typeof v==="object"?JSON.stringify(v):v))})' "$1"; }

start() {
  git fetch origin
  if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
    git fetch origin "$branch"
    git checkout -B "$branch" "origin/${branch}"
    git merge --no-edit origin/main
  else
    git checkout -B "$branch" origin/main
  fi
}

publish() {
  local title="${3:-}"; shift 3 || true
  title="$(printf '%s' "$title" | sed -E 's/ *\[skip ci\]//g')"
  [ -n "$title" ] || { echo "data-pr: title required" >&2; exit 2; }
  [ "$#" -gt 0 ] || { echo "data-pr: no files given" >&2; exit 2; }

  git add -- "$@"
  if git diff --cached --quiet; then
    echo "data-pr: no change"; exit 0
  fi
  # No [skip ci]: it would also skip pull_request workflows and the required checks would never report.
  git commit -m "$title"

  local pushed=0 i
  for i in 1 2 3; do
    if git push origin "HEAD:refs/heads/${branch}"; then pushed=1; break; fi
    echo "data-pr: push attempt $i failed; rebasing…"
    git pull --rebase origin "$branch" || true
    sleep $((i))
  done
  [ "$pushed" = 1 ] || { echo "data-pr: push to ${branch} failed" >&2; exit 1; }

  local open
  open="$(gh pr list --head "$branch" --base main --state open --json number | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s||"[]").length))')"
  if [ "$open" = "0" ]; then
    gh pr create --base main --head "$branch" --title "$title" \
      --body "Automated data refresh for \`${name}\`. Refs #3490. Lands via auto-merge once CI Gate and E2E Gate pass."
  fi

  local polls="${DATA_PR_POLL_MAX:-12}" ms="${DATA_PR_POLL_MS:-5000}" st="UNKNOWN"
  for ((i = 0; i < polls; i++)); do
    st="$(gh pr view "$branch" --json mergeStateStatus | jfield .mergeStateStatus)"
    [ "$st" != "UNKNOWN" ] && break
    sleep "$(node -e 'console.log(process.argv[1]/1000)' "$ms")"
  done

  gh pr merge "$branch" --auto --merge

  local view state auto num
  view="$(gh pr view "$branch" --json number,state,autoMergeRequest)"
  state="$(printf '%s' "$view" | jfield .state)"
  auto="$(printf '%s' "$view" | jfield .autoMergeRequest)"
  num="$(printf '%s' "$view" | jfield .number)"; num="${num:-$branch}"
  if [ "$state" = "MERGED" ]; then
    echo "data-pr: merged #${num}"
  elif [ -n "$auto" ]; then
    echo "data-pr: auto-merge on #${num}"
  else
    echo "data-pr: PR ${num} (${branch}) is neither merged nor set to auto-merge" >&2
    exit 1
  fi
}

case "$cmd" in
  start) start ;;
  publish) publish "$@" ;;
  *) echo "usage: data-pr.sh start <name> | publish <name> <title> <file...>" >&2; exit 2 ;;
esac
