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
| `require-comment-provenance.mjs` | `PreToolUse: mcp__github__add_issue_comment` | Blocks an agent GitHub comment whose body doesn't LEAD with a 🤖 provenance header (interactive comments post under @pmcp and must not be mistaken for the human). |
| `require-issue-dedup.mjs` | `PreToolUse: mcp__github__issue_write` | Backstops the dedup gate (#297): blocks a `method: create` whose body lacks a `Dedup-checked:` attestation line, so the issue-first flow can't silently open a duplicate. Updates/closes pass through. Run the `/issue-dedup` skill to do the real search; the marker is the receipt the hook checks. |
| `session-start.sh` | `SessionStart` | Prints the ISSUE-FIRST reminder, the headless-browser path, exports the dev auth secret, and runs `pnpm install`. |

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
