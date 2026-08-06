#!/usr/bin/env node
// require-comment-provenance.mjs — PreToolUse gate for mcp__github__add_issue_comment.
//
// Comments posted by an agent via the GitHub MCP tools show up under the HUMAN account
// (@pmcp), so they can be mistaken for something Maarten wrote. This gate blocks any
// agent comment whose body doesn't LEAD with a 🤖 provenance header, so the source is
// always unmistakable on the very first line. (#479-adjacent; requested 2026-06.)
//
// Pass: the first non-empty line of `body` contains the 🤖 marker.
// Block: exit 2 with a reminder (PreToolUse exit 2 cancels the call, stderr → the agent).

let raw = ''
process.stdin.on('data', c => { raw += c })
process.stdin.on('end', () => {
  let body = ''
  try { body = ((JSON.parse(raw).tool_input) || {}).body || '' } catch { /* fall through → block */ }

  const firstLine = body.split('\n').map(l => l.trim()).find(l => l.length > 0) || ''
  if (firstLine.includes('🤖')) process.exit(0) // has a provenance header → allow

  process.stderr.write(
    'Blocked: agent GitHub comments must LEAD with a 🤖 provenance header (they post under ' +
    '@pmcp and must not be mistaken for the human). Prepend a first line, e.g.:\n\n' +
    '> 🤖 **Claude Code** · interactive agent, posted from `@pmcp`’s account (not Maarten) · _<one-line context>_\n\n' +
    'Then re-send the comment.\n'
  )
  process.exit(2)
})
