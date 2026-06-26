# Claude Code Hooks

This directory contains git hooks for the nuxt-crouton project.

## Available Hooks

### pre-commit-sync-reminder

A git pre-commit hook that displays a reminder when committing changes to:
- Collection generator (`packages/nuxt-crouton-cli/lib/` or `bin/`)
- MCP server (`packages/nuxt-crouton-mcp-server/src/`)

The hook reminds developers to check if documentation artifacts need to be updated.

## Claude Code PreToolUse hooks (wired in `.claude/settings.json`)

These run inside a Claude Code session before a matched tool call. Exit `0` allows the call;
exit `2` cancels it and the stderr text is shown to the agent.

- **`gate-package-edits.sh`** (`Edit|Write`) — blocks edits to `packages/` without approval.
- **`require-comment-provenance.mjs`** (`mcp__github__add_issue_comment`) — blocks an agent
  comment whose body doesn't lead with a 🤖 provenance header.
- **`require-issue-dedup.mjs`** (`mcp__github__issue_write`) — backstops the dedup gate
  (#297): blocks a `method: create` whose body lacks a `Dedup-checked:` attestation line, so
  the issue-first flow can't silently open a duplicate. Updates/closes pass through. Run the
  **`/issue-dedup`** skill to do the real search; the marker is the receipt the hook checks.

## Installation

### Option 1: Manual Installation

```bash
# Copy the hook to git hooks directory
cp .claude/hooks/pre-commit-sync-reminder .git/hooks/pre-commit

# Make it executable
chmod +x .git/hooks/pre-commit
```

### Option 2: Using Git Config (Recommended)

```bash
# Set the hooks directory
git config core.hooksPath .claude/hooks

# Rename the hook file (remove the suffix)
mv .claude/hooks/pre-commit-sync-reminder .claude/hooks/pre-commit
chmod +x .claude/hooks/pre-commit
```

## Behavior

When you commit changes to the generator or MCP server, the hook will:

1. Display a reminder checklist of documentation to update
2. List the modified files
3. (In interactive mode) Ask for confirmation to continue

The hook is **non-blocking by default** - it displays the reminder but allows the commit to proceed. In interactive terminal mode, it asks for confirmation.

## Bypassing the Hook

If you need to skip the hook (e.g., for internal refactors):

```bash
git commit --no-verify -m "your message"
```

## Related Commands

- `/sync-check` - Claude Code slash command to verify documentation sync
- `node scripts/validate-field-types-sync.mjs` - CI validation script

## Customization

The hook checks for files matching these patterns:
- `packages/nuxt-crouton-cli/(lib|bin)/`
- `packages/nuxt-crouton-mcp-server/src/`

Modify the grep patterns in the hook script to adjust what triggers the reminder.
