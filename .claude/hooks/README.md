# Claude Code Hooks

This directory holds two kinds of hooks for the nuxt-crouton project:
**runtime hooks** wired into Claude Code via `.claude/settings.json` (they fire
on tool calls / session start), and a **git hook** (`pre-commit-sync-reminder`).

## Runtime hooks (`.claude/settings.json`)

These are registered under `hooks.PreToolUse` / `hooks.SessionStart` and run
automatically — no installation step. A `PreToolUse` hook that exits non-zero
(2) **cancels** the tool call and feeds its stderr back to the agent.

| Hook | Fires on | What it enforces |
|------|----------|------------------|
| `gate-package-edits.sh` | `PreToolUse: Edit\|Write` | Blocks edits to `packages/*` unless the package is listed in `.claude/.package-edit-approved` (the packages boundary gate). |
| `gate-spec-signoff.mjs` | `PreToolUse: Edit\|Write` | Blocks marking a POC `spec.json` entry `status: "settled"` without a populated `signedOff` token — the done-rule backstop (done is *derived* from a sign-off, never self-asserted; #992 WS5). Scoped to `*spec.json`; fail-open on malformed JSON. |
| `require-comment-provenance.mjs` | `PreToolUse: mcp__github__add_issue_comment` | Blocks an agent GitHub comment whose body doesn't LEAD with a 🤖 provenance header (interactive comments post under @pmcp and must not be mistaken for the human); an `interactive` header must also carry `chat <id>` (the session's short id, #3996). |
| `require-unclaimed.mjs` | `PreToolUse: Bash`, `mcp__github__issue_write`, `mcp__github__add_issue_comment`, `mcp__github__sub_issue_write` | Refuses adding `work-this`, removing `status:blocked`, or a `**Worker:**` PR comment on a ticket another chat claimed (directly or via its parent epic), and `work-this` on a ticket with an open `Blocked-by:` (#3996); and putting a ticket under an epic (`--parent`, `--add-sub-issue`, `sub_issues`, `addSubIssue`, MCP `sub_issue_write`) when it already carries `work-this`/`plan:approved`/`status:blocked` or has an open `work-<n>` PR, unless this chat claimed it (#4517). Both checks run on every call; either refusing refuses it. Claims via `node scripts/claim.mjs claim\|release\|who <n>`; decisions in `scripts/lib/chat-claim.mjs`, tests in `scripts/claim.test.mjs`. Unrelated calls return with no network; fails open on lookup errors. |
| `require-live-review-target.mjs` | `PreToolUse: mcp__github__add_issue_comment` | Blocks an agent comment that asks the owner to act and names a merged/closed PR in its `**You:**` line (#2111). Decision in `scripts/review-target.mjs`; fails open on lookup errors. For `gh`-posted comments run `node scripts/review-target.mjs <body-file>`. |
| `require-issue-dedup.mjs` | `PreToolUse: mcp__github__issue_write` | Backstops the dedup gate (#297): blocks a `method: create` whose body lacks a `Dedup-checked:` attestation line, so the issue-first flow can't silently open a duplicate. Updates/closes pass through. Run the `/issue-dedup` skill to do the real search; the marker is the receipt the hook checks. |
| `session-start.sh` | `SessionStart` | Prints the ISSUE-FIRST reminder, the headless-browser path, exports `CROUTON_CHAT_ID` and prints the chat id (#3996), exports the dev auth secret, and runs `pnpm install`. |

To test a `PreToolUse` hook by hand, pipe a fake tool call to it:

```bash
echo '{"tool_input":{"file_path":"pocs/x/spec.json","content":"[{\"id\":\"a\",\"status\":\"settled\"}]"}}' \
  | node .claude/hooks/gate-spec-signoff.mjs; echo "exit=$?"   # → exit=2 (blocked)
```

## Git hook: `pre-commit-sync-reminder`

A git pre-commit hook that displays a reminder when committing changes to:
- Collection generator (`packages/crouton-cli/lib/` or `bin/`)
- MCP server (`packages/crouton-mcp/src/`)

It reminds developers to check whether documentation artifacts need updating.

### Installation

```bash
# Option 1 — copy into git's hook dir
cp .claude/hooks/pre-commit-sync-reminder .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

# Option 2 (recommended) — point git at this dir
git config core.hooksPath .claude/hooks
mv .claude/hooks/pre-commit-sync-reminder .claude/hooks/pre-commit
chmod +x .claude/hooks/pre-commit
```

The git hook is **non-blocking by default** — it shows the reminder but lets the
commit proceed (interactive mode asks for confirmation). Bypass with
`git commit --no-verify`.

## Related

- `/sync-check` — slash command to verify documentation sync
- `node scripts/validate-field-types-sync.mjs` — CI validation script
