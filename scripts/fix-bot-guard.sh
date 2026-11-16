#!/usr/bin/env bash
# Fix-bot guard (#2719): refuse a "fix" that deletes the worker's own new code, else push it.
# Run by the `Guard and push the fix` step of fix-ci-on-failure.yml (job `fix`), read from the default
# branch like commit-ci-fix.sh, so a PR branch cut before this file existed still gets it. Moved out of
# the workflow's inline `run:` block (#3452 — decision logic lives in scripts/, not in YAML).
#
# Compares the fix commit(s) with what the PR's worker commits added. If the fix removes any of those
# lines (blank lines/imports aside) it is not pushed: the branch is reset, the PR gets the lines listed,
# and the pi worker is re-run with the CI failure as feedback (the revise path, #2446).
#
# Env: PRE (head before the fix) · BASE · BRANCH · PR · ISSUE · RUN_URL · RUN_NAME · GH_TOKEN ·
#      RUNNER_TEMP (holds failed-job-logs.md) · GITHUB_OUTPUT (gets refused=true on a refusal).
set -euo pipefail
: "${PRE:?}" "${BASE:?}" "${BRANCH:?}" "${PR:?}" "${RUNNER_TEMP:?}"
ISSUE="${ISSUE:-}"; RUN_URL="${RUN_URL:-}"; RUN_NAME="${RUN_NAME:-}"
GITHUB_OUTPUT="${GITHUB_OUTPUT:-/dev/null}"
HEAD_NOW="$(git rev-parse HEAD)"
# Belt and braces: `git push` is disallowed for the agent, but if it pushed anyway the
# remote head has moved past $PRE. Judge those commits too; if refused, revert them.
git fetch -q origin "$BRANCH"
REMOTE_NOW="$(git rev-parse "origin/$BRANCH")"
PUSHED=0
if [ "$REMOTE_NOW" != "$PRE" ] && git merge-base --is-ancestor "$PRE" "$REMOTE_NOW"; then PUSHED=1; fi
if [ "$HEAD_NOW" = "$PRE" ] && [ "$PUSHED" = 0 ]; then
  echo "No fix commit — nothing to push."
  # #3373: the first-failure ping no longer mentions the owner while the bot is on it, so a
  # silent no-fix exit would reach nobody. Ping once unless the agent already blocked the issue.
  if [ -n "$ISSUE" ] && ! gh issue view "$ISSUE" --json labels --jq '.labels[].name' | grep -qx 'status:blocked'; then
    gh pr comment "$PR" --body "<!-- pipeline-note -->
🔴 **@pmcp — auto-fix stopped without a fix; \`$RUN_NAME\` is still failing.**

**Fix:** take a look, then push a fix or reply to resume." || true
    gh issue edit "$ISSUE" --add-label "status:blocked" || true
  fi
  exit 0
fi
git fetch -q origin "$BASE"
git diff "origin/$BASE...$PRE" > "$RUNNER_TEMP/worker.diff"
git diff "$PRE" "$HEAD_NOW" > "$RUNNER_TEMP/fix.diff"
if [ "$PUSHED" = 1 ]; then git diff "$PRE" "$REMOTE_NOW" >> "$RUNNER_TEMP/fix.diff"; fi
# shellcheck disable=SC2016 # the JS is single-quoted on purpose
node -e '
  const fs = require("fs")
  import("./scripts/lib/fix-removes-worker-code.mjs").then(({ findRemovedWorkerLines }) => {
    const r = findRemovedWorkerLines(fs.readFileSync(process.argv[1], "utf8"), fs.readFileSync(process.argv[2], "utf8"))
    fs.writeFileSync(process.argv[3], JSON.stringify(r))
    process.exit(r.refuse ? 3 : 0)
  })
' "$RUNNER_TEMP/worker.diff" "$RUNNER_TEMP/fix.diff" "$RUNNER_TEMP/verdict.json" && ok=1 || ok=0
if [ "$ok" = 1 ]; then
  if [ "$HEAD_NOW" != "$PRE" ]; then node scripts/git-push-retry.mjs origin "HEAD:$BRANCH"; fi
  exit 0
fi

echo "refused=true" >> "$GITHUB_OUTPUT"
git reset -q --hard "$PRE"
# No force-push: if the agent already pushed, add a revert commit restoring $PRE's tree.
# Undo only the fix-bot's own commits; a worker revision pushed meanwhile must survive (#2978).
if [ "$PUSHED" = 1 ] && ! bash scripts/revert-pushed-fix.sh "$PRE" "$BRANCH" "$HEAD_NOW"; then
  UNDONE_NOTE="<!-- pipeline-note -->"$'\n'"> 🤖 **pi.dev harness** · fix-bot guard (#2719) · _auto-fix not undone_"
  UNDONE_NOTE="$UNDONE_NOTE"$'\n\n'"⚠️ The refused auto-fix is already on this branch and could not be reverted cleanly (later commits touch the same lines). Nothing was pushed. Please revert the fix-bot commit(s) \`$PRE..$HEAD_NOW\` by hand."
  gh pr comment "$PR" --body "$UNDONE_NOTE"
fi
# shellcheck disable=SC2016 # the JS is single-quoted on purpose
LINES="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(r.removed.map(x=>"- `"+x.file+"`: `"+x.line.trim()+"`").join(String.fromCharCode(10)))' "$RUNNER_TEMP/verdict.json")"
ERR="$(cat "$RUNNER_TEMP/failed-job-logs.md" 2>/dev/null || echo '(could not read the failed job logs — see the failing run)')"
# #3668 review: a hidden marker with the failing line, so the worker's next head keeps the try count
# while that line repeats (carriedTry) — refused fix → worker → same red ends at the cap, not in a loop.
# The lib is the default-branch copy the fix job puts in $RUNNER_TEMP/lib; no lib or no line → no marker.
# A crash of the marker CLI fails CLOSED: warn, and post a marker with an empty line (= "handed back,
# line unknown"), which carriesCount treats as a carry — so the try count does not reset (#3830 review).
HB_MARK=""
if [ -f "$RUNNER_TEMP/lib/diagnosis-review.mjs" ]; then
  if ! HB_MARK="$(node "$RUNNER_TEMP/lib/diagnosis-review.mjs" handback-marker "$PRE" "$RUN_NAME" "$RUNNER_TEMP/raw-logs")"; then
    echo "::warning::fix-bot guard: the handback-marker CLI (diagnosis-review.mjs) failed — marking this hand-back with an unknown line so the try count carries over"
    HB_MARK="<!-- fix-bot-handback:v1 sha=$PRE check=$(jq -rn --arg c "${RUN_NAME:-unknown}" '$c|@uri') line= -->"
  fi
fi
{
  echo "<!-- pipeline-note -->"
  if [ -n "$HB_MARK" ]; then echo "$HB_MARK"; fi
  echo "> 🤖 **pi.dev harness** · fix-bot guard (#2719) · _auto-fix refused_"
  echo
  echo "🔧 **Auto-fix not pushed: it would delete code this PR was asked to add.** Handing back to the worker to implement the missing piece instead."
  echo
  echo "**Lines the fix would remove:**"
  echo "$LINES"
  echo
  echo "<details><summary>CI failure (\`$RUN_NAME\`) the worker should fix</summary>"
  echo
  echo "$ERR"
  echo "[failing run]($RUN_URL)"
  echo "</details>"
  echo
  echo "**Revise instruction:** CI is red. Make it green by IMPLEMENTING what the lines above reference — do not delete them. Use the error text above."
} > "$RUNNER_TEMP/handback.md"
PRC_URL="$(gh pr comment "$PR" --body-file "$RUNNER_TEMP/handback.md")"
if [ -n "$ISSUE" ]; then
  # Comment POST + dispatch are ONE protected hand-off step (#3306): a limit / 5xx saves it for the sweep,
  # which falls back to the PR comment just posted (an issue-comment id, readable the same way).
  node scripts/handoff-exec.mjs dispatch "$(jq -nc --argjson i "$ISSUE" --arg b "$BRANCH" --arg f "$RUNNER_TEMP/handback.md" --arg p "${PRC_URL##*issuecomment-}" '{issue:$i,workflow:"work-issue-pidev.yml",inputs:{issue:($i|tostring),branch:$b},postBodyFile:$f,fallbackFeedback:$p}')"
fi
