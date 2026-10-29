#!/usr/bin/env bash
# layer: stack
# Merge main into an open epic branch so in-flight work picks up pipeline fixes (#2475).
#
# WHY. Sub-PRs target `epic/*`, and a `pull_request` run uses the workflows and scripts of the
# PR's merge commit (head merged into BASE). The decomposer cuts an epic branch from main ONCE
# and nothing ever updated it — so a pipeline fix merged to main reached only NEW epics. On
# epic #2413 the branch was 57 commits behind: #2470 ran the old screenshot code and captured
# the kassa start page although the fix (#2433) had merged hours earlier.
#
# WHAT. Called by work-issue-pidev.yml right before the worker starts (every sub-PR, new or
# revised, passes through there). Fast-forward merge of origin/main into the epic branch,
# pushed with the Harness App token so it cascades. A MERGE, never a rebase: the epic branch
# is shared, so no force-push. On conflict: abort, post ONE 🔀 on the epic (deduped by a
# marker), and exit 0 — the worker still runs on the stale base rather than stalling the wave.
#
# Usage:
#   scripts/sync-epic-branch.sh <epic-branch> <epic-issue-number>
# Env: GH_TOKEN (Harness App token; used for the push URL and the conflict comment),
#      GITHUB_REPOSITORY (owner/repo), GITHUB_SERVER_URL + GITHUB_RUN_ID (run link; optional).
#
# Never fails the caller: every exit path is 0 except bad arguments.

set -uo pipefail

EPIC_BRANCH="${1:-}"
EPIC="${2:-}"
REPO="${GITHUB_REPOSITORY:-}"
MARKER='<!-- epic-sync:conflict -->'

if [ -z "$EPIC_BRANCH" ] || [ -z "$EPIC" ] || [ -z "$REPO" ] || [ -z "${GH_TOKEN:-}" ]; then
  echo "Usage: $0 <epic-branch> <epic-issue-number>  (needs GH_TOKEN + GITHUB_REPOSITORY)" >&2
  exit 2
fi

echo "epic-sync: ${EPIC_BRANCH} ← main"

# #2788: a missing epic branch (deleted after its first batch merged while the epic stayed open)
# used to leave later children with nothing to land on. Recreate it from main and say so, rather
# than letting the worker silently fall back to main.
if [ -z "$(git ls-remote --heads origin "refs/heads/${EPIC_BRANCH}" | cut -f1)" ]; then
  git fetch origin main --quiet 2>/dev/null || true
  MAIN_TIP="$(git ls-remote origin refs/heads/main | cut -f1)"
  if [ -n "$MAIN_TIP" ] && git push origin "${MAIN_TIP}:refs/heads/${EPIC_BRANCH}" >/dev/null 2>&1 \
     && [ -n "$(git ls-remote --heads origin "refs/heads/${EPIC_BRANCH}" | cut -f1)" ]; then
    echo "::notice::epic-sync: ${EPIC_BRANCH} was MISSING on the remote — recreated from main (${MAIN_TIP:0:7}) (#2788)"
    exit 0
  fi
  echo "::warning::epic-sync: ${EPIC_BRANCH} is missing and could not be recreated from main"
  exit 0
fi

# The checkout is depth-1 on main. A merge needs a common ancestor, so deepen both refs;
# fall back to the full history if the epic branch is older than the window.
if ! git fetch origin --depth=1000 "main" "$EPIC_BRANCH" --quiet 2>&1; then
  echo "::warning::epic-sync: could not fetch ${EPIC_BRANCH} — skipping sync"
  exit 0
fi
# Resolve both tips by name: actions/checkout keeps no `origin/main` tracking ref, and a
# multi-ref fetch leaves FETCH_HEAD holding every tip.
MAIN_SHA="$(git ls-remote origin "refs/heads/main" | cut -f1)"
EPIC_SHA="$(git ls-remote origin "refs/heads/${EPIC_BRANCH}" | cut -f1)"
if [ -z "$EPIC_SHA" ] || [ -z "$MAIN_SHA" ]; then
  echo "::warning::epic-sync: could not resolve ${EPIC_BRANCH} (${EPIC_SHA:-?}) or main (${MAIN_SHA:-?}) — skipping"
  exit 0
fi

if ! git merge-base "$MAIN_SHA" "$EPIC_SHA" >/dev/null 2>&1; then
  echo "epic-sync: no common ancestor in the last 1000 commits — fetching full history"
  git fetch origin --unshallow --quiet 2>/dev/null || git fetch origin --deepen=20000 --quiet 2>/dev/null || true
fi

if git merge-base --is-ancestor "$MAIN_SHA" "$EPIC_SHA" 2>/dev/null; then
  echo "epic-sync: ${EPIC_BRANCH} already contains main (${MAIN_SHA:0:7}) — nothing to do"
  exit 0
fi

BEHIND="$(git rev-list --count "${EPIC_SHA}..${MAIN_SHA}" 2>/dev/null || echo '?')"
echo "epic-sync: ${EPIC_BRANCH} is ${BEHIND} commit(s) behind main — merging"

git config user.name  "nuxt-harness[bot]"
git config user.email "nuxt-harness[bot]@users.noreply.github.com"

# Work on a scratch ref so the caller's checkout (main) is untouched afterwards.
ORIG_REF="$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)"
ORIG_SHA="$(git rev-parse HEAD)"
SCRATCH="epic-sync/${EPIC}"
restore() {
  git checkout -q "$ORIG_REF" 2>/dev/null || git checkout -q "$ORIG_SHA"
  git branch -q -D "$SCRATCH" 2>/dev/null || true
}
git checkout -q -B "$SCRATCH" "$EPIC_SHA"

if ! git merge --no-edit --no-ff "$MAIN_SHA" \
     -m "chore(root): merge main into ${EPIC_BRANCH} (#2475)" \
     -m "Keeps in-flight sub-PRs on current pipeline code — ${BEHIND} commit(s) from main." >/dev/null 2>&1; then
  CONFLICTS="$(git diff --name-only --diff-filter=U | head -20)"
  git merge --abort 2>/dev/null || git reset -q --hard "$EPIC_SHA"
  restore
  echo "::warning::epic-sync: merge conflict in ${EPIC_BRANCH}; worker runs on the stale base"
  echo "$CONFLICTS"

  # One 🔀 on the epic, deduped: the same conflict must not ping on every worker start.
  EXISTING="$(gh api "repos/${REPO}/issues/${EPIC}/comments?per_page=100" --jq "[.[] | select(.body | contains(\"${MARKER}\"))] | length" 2>/dev/null || echo 0)"
  if [ "${EXISTING:-0}" = "0" ]; then
    RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${REPO}/actions/runs/${GITHUB_RUN_ID:-}"
    # shellcheck disable=SC2016  # literal backticks for markdown code spans, no expansion wanted
    FILES="$(printf '%s\n' "$CONFLICTS" | sed 's/^/- `/; s/$/`/')"
    # Heredoc to a FILE, not `$(cat <<EOF)` — the #1001/#1706 shell trap (#1727).
    BODY_FILE="${RUNNER_TEMP:-/tmp}/epic-sync-comment.md"
    cat > "$BODY_FILE" <<EOF
${MARKER}
> 🤖 **Claude Code** · agent pipeline (CI) · _epic branch sync (#2475)_

🔀 **This epic's branch no longer merges cleanly with main — its next sub-PRs keep running the old pipeline code until it does.**

**You:** merge \`main\` into \`${EPIC_BRANCH}\` and resolve the files below — or do nothing, and the work continues on the old base.
**Depth:** ${RUN_URL}

<details><summary>Conflicting files</summary>

${FILES}

</details>
EOF
    gh api -X POST "repos/${REPO}/issues/${EPIC}/comments" -F body=@"$BODY_FILE" --jq .html_url 2>/dev/null \
      && echo "epic-sync: posted conflict comment on #${EPIC}" \
      || echo "::warning::epic-sync: could not post conflict comment on #${EPIC}"
  else
    echo "epic-sync: conflict already reported on #${EPIC} — not re-posting"
  fi
  exit 0
fi

NEW_SHA="$(git rev-parse HEAD)"
# `origin` carries the App token: the worker's checkout persisted it (token: on actions/checkout).
if git push origin "HEAD:refs/heads/${EPIC_BRANCH}" 2>&1 | tail -1; then
  # Assert the effect, not the exit code: the remote tip must now be the merge commit.
  REMOTE="$(git ls-remote origin "refs/heads/${EPIC_BRANCH}" | cut -f1)"
  if [ "$REMOTE" = "$NEW_SHA" ]; then
    echo "epic-sync: ${EPIC_BRANCH} now at ${NEW_SHA:0:7} (+${BEHIND} from main)"
  else
    echo "::warning::epic-sync: push reported ok but ${EPIC_BRANCH} is at ${REMOTE:0:7}, expected ${NEW_SHA:0:7}"
  fi
else
  echo "::warning::epic-sync: push to ${EPIC_BRANCH} failed — worker runs on the stale base"
fi

restore
exit 0
