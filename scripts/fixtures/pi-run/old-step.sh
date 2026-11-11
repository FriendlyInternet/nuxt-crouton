# FROZEN COPY of the prompt-building part of work-issue-pidev.yml's `pi` step, as it was at
# 1f901a0e (L565-L612), before #3620 moved it into scripts/pi-run.mjs. Do not edit: it is the
# reference scripts/pi-run.test.mjs compares buildPrompt against, byte for byte. Run from the repo
# root with `bash -e` (the GHA default) and PROMPT_FILE / RUNNER_TEMP / the step env set.
set -uo pipefail
BRANCH_INSTR="branch off main and target the PR at main"
if [ -n "${EPIC_BRANCH:-}" ]; then
  BRANCH_INSTR="branch off the integration branch '${EPIC_BRANCH}' and target the PR THERE (not main)"
fi
if [ -n "${PLAN:-}" ]; then
  node scripts/pipeline-prompt.mjs pi-planner --var "issue=$ISSUE" > "$PROMPT_FILE"
  # #2756: a plan REVIEW sent the plan back — `feedback` is the review comment id. Append
  # it so the new plan answers the review's reasons (the revise step is skipped in plan mode).
  if [ -n "${FEEDBACK_ID:-}" ]; then
    gh api "repos/${GITHUB_REPOSITORY}/issues/comments/${FEEDBACK_ID}" --jq .body > "$RUNNER_TEMP/feedback.txt"
    if [ "$(gh api "repos/${GITHUB_REPOSITORY}/issues/comments/${FEEDBACK_ID}" --jq .user.type)" != "Bot" ]; then
      WHO='the OWNER replied with guidance on a held plan - treat their comment as authoritative direction'
    else
      WHO='by the plan reviewer'
    fi
    # #3341: hand over the BEST earlier plan (the one whose review passed the most checks,
    # newest on a tie) and the ticket's Decisions, so the planner revises instead of
    # rewriting. "start fresh" in the feedback or a Decision skips the old plan.
    gh api "repos/${GITHUB_REPOSITORY}/issues/${ISSUE}/comments" --paginate | jq -s -r --argjson fb "${FEEDBACK_ID}" 'add' | jq -r --argjson fb "${FEEDBACK_ID}" -f scripts/lib/best-plan.jq > "$RUNNER_TEMP/prev-plan.txt" || : > "$RUNNER_TEMP/prev-plan.txt"
    gh issue view "$ISSUE" --json body -q .body | awk '/^## Decisions[ \t]*$/{f=1;print;next} /^## /{f=0} f' > "$RUNNER_TEMP/decisions.txt" || : > "$RUNNER_TEMP/decisions.txt"
    FRESH=""; cat "$RUNNER_TEMP/feedback.txt" "$RUNNER_TEMP/decisions.txt" | grep -qi 'start fresh' && FRESH=1
    { printf '\n\nYOUR PREVIOUS PLAN WAS SENT BACK (%s). REVISE the previous plan below: keep every part that passed verbatim, change only what a FAIL or a Decisions line touches, and add a `### Changes from the previous plan` section (what changed and why). Fix each FAIL by actually investigating, not by rewording. Add a `### Ticket re-read` section (one bullet per item of the ticket For agents and How to test: `- <item> — Covered: <where>` or `— Not covered: <why>`) and run `node scripts/lib/plan-shape.mjs --revised <draft>` before posting:\n\n' "$WHO"; cat "$RUNNER_TEMP/feedback.txt"
      if [ -n "$FRESH" ]; then printf '\n\nThe feedback says START FRESH: discard the previous plan, write a new one, and check it with `--revised --fresh`.\n'
      elif [ -s "$RUNNER_TEMP/prev-plan.txt" ]; then printf '\n\nPREVIOUS PLAN (revise this):\n\n'; cat "$RUNNER_TEMP/prev-plan.txt"; fi
      if [ -s "$RUNNER_TEMP/decisions.txt" ]; then printf '\n\nTICKET DECISIONS (binding; no change may contradict them):\n\n'; cat "$RUNNER_TEMP/decisions.txt"; fi
    } >> "$PROMPT_FILE"
  fi
elif [ -n "${REVISE:-}" ]; then
  PRN="$(gh pr list --head "${REV_BRANCH:-work-${ISSUE}}" --state open --json number -q '.[0].number' 2>/dev/null || true)"
  if [ "${REV_CONFLICT:-}" = "1" ]; then
    # #3002: the base merge conflicted — the task is the merge, with its own persona (the
    # reviser's "work-<issue>" / "owner comment" framing made pi stop on epic PRs).
    node scripts/pipeline-prompt.mjs pi-conflict-resolver --var "pr=$PRN" --var "issue=$ISSUE" --var "branch=${REV_BRANCH:-work-${ISSUE}}" \
      --var-file "task=$RUNNER_TEMP/conflict-task.txt" --var-file "feedback=$RUNNER_TEMP/feedback.txt" > "$PROMPT_FILE"
  else
    node scripts/pipeline-prompt.mjs pi-reviser --var "pr=$PRN" --var "issue=$ISSUE" \
      --var-file "feedback=$RUNNER_TEMP/feedback.txt" > "$PROMPT_FILE"
  fi
else
  node scripts/pipeline-prompt.mjs pi-worker --var "issue=$ISSUE" --var "branch_instr=$BRANCH_INSTR" > "$PROMPT_FILE"
  # #2757: BUILD FROM AN APPROVED PLAN — label-router.yml passes the plan comment id.
  # The worker implements exactly that plan, (the ledger row is written by record-outcome, #3457).
  if [ -n "${APPROVED_PLAN_ID:-}" ]; then
    gh api "repos/${GITHUB_REPOSITORY}/issues/comments/${APPROVED_PLAN_ID}" --jq .body > "$RUNNER_TEMP/approved-plan.txt"
    node scripts/plan-held.mjs --approved-prompt --plan-id "$APPROVED_PLAN_ID" --plan-file "$RUNNER_TEMP/approved-plan.txt" --issue "$ISSUE" > "$RUNNER_TEMP/approved-section.txt"
    cat "$RUNNER_TEMP/approved-section.txt" >> "$PROMPT_FILE"
  fi
fi
