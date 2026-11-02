#!/usr/bin/env bash
# CI-fix commit (#3104): make the ONE commit for the fix-bot, so the marker can't be forged or forgotten.
# Usage: commit-ci-fix.sh <message-file>
# The fix agent only stages its files and writes its message to <message-file>; this script (loaded from a
# trusted checkout of the default branch) commits the staged files with that message + `CI-Fix: true`,
# under the fix-bot identity. No message file (or empty) -> nothing is committed. Nothing staged -> nothing.
set -euo pipefail
MSG="${1:?usage: commit-ci-fix.sh <message-file>}"
if [ ! -s "$MSG" ]; then echo "No CI-fix message — nothing committed."; exit 0; fi
if git diff --cached --quiet; then echo "Nothing staged — nothing committed."; exit 0; fi
export GIT_AUTHOR_NAME="claude[bot]" GIT_AUTHOR_EMAIL="41898282+claude[bot]@users.noreply.github.com"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
# Drop any marker the agent wrote itself, then append exactly one as the trailer.
grep -v -x -E '[[:space:]]*CI-Fix:[[:space:]]*true[[:space:]]*' "$MSG" > "$BODY" || true
git commit -q -F "$BODY" --trailer "CI-Fix: true"
git log -1 --format='Committed %h: %s'
