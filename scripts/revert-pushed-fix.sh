#!/usr/bin/env bash
# Fix-bot guard (#2719): undo a fix the agent pushed despite being told not to.
# Usage: revert-pushed-fix.sh <PRE_SHA> <BRANCH> <FIX_SHA> [remote=origin]
# Reverts ONLY the fix-bot's own commits (PRE..FIX_SHA that reached the remote branch) as new commits
# on top of the remote branch, then pushes (no force-push). Commits others pushed meanwhile are kept
# (#2978). Exits 2 without pushing when the revert conflicts.
set -euo pipefail
PRE="$1"; BRANCH="$2"; FIX="$3"; REMOTE="${4:-origin}"
git fetch -q "$REMOTE" "$BRANCH"
git checkout -q -B fix-guard-revert "$REMOTE/$BRANCH"
COMMITS=()
while read -r c; do
  [ -n "$c" ] && git merge-base --is-ancestor "$c" HEAD && COMMITS+=("$c")
done < <(git rev-list "$PRE..$FIX")   # newest first = safe revert order
if [ "${#COMMITS[@]}" = 0 ]; then echo "No fix-bot commits on $REMOTE/$BRANCH."; exit 0; fi
export GIT_AUTHOR_NAME="nuxt-harness[bot]" GIT_AUTHOR_EMAIL="harness@users.noreply.github.com"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
if ! git revert --no-edit "${COMMITS[@]}"; then
  git revert --abort 2>/dev/null || true
  echo "Revert conflicts with later commits; nothing pushed." >&2
  exit 2
fi
git push "$REMOTE" "HEAD:$BRANCH"
