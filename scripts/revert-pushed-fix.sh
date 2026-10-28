#!/usr/bin/env bash
# layer: stack
# Fix-bot guard (#2719): undo a fix the agent pushed despite being told not to.
# Usage: revert-pushed-fix.sh <PRE_SHA> <BRANCH> [remote=origin]
# Adds ONE commit on top of the remote branch whose tree equals PRE (no force-push), then pushes.
set -euo pipefail
PRE="$1"; BRANCH="$2"; REMOTE="${3:-origin}"
git fetch -q "$REMOTE" "$BRANCH"
git checkout -q -B fix-guard-revert "$REMOTE/$BRANCH"
git read-tree --reset -u "$PRE"
if git diff --cached --quiet; then echo "Branch content already equals $PRE."; exit 0; fi
git -c user.name="nuxt-harness[bot]" -c user.email="harness@users.noreply.github.com" \
  commit -q -m "revert: undo auto-fix refused by the fix-bot guard (#2719)"
git push "$REMOTE" "HEAD:$BRANCH"
