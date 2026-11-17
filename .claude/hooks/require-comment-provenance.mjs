#!/usr/bin/env node
// require-comment-provenance.mjs — PreToolUse gate for mcp__github__add_issue_comment.
//
// Comments posted by an agent via the GitHub MCP tools show up under the HUMAN account
// (@pmcp), so they can be mistaken for something Maarten wrote. This gate blocks any
// agent comment whose body doesn't LEAD with a 🤖 provenance header, so the source is
// always unmistakable on the very first line. (#479-adjacent; requested 2026-06.)
//
// Pass: one of the first few non-empty lines of `body` contains the 🤖 marker.
// Block: exit 2 with a reminder (PreToolUse exit 2 cancels the call, stderr → the agent).
//
// #2081 — this used to require the marker on the VERY first line, which collided head-on with
// the owner-brief rule that a comment must lead with its type (🔴 / 💡 / ✅ / 🔀 / 🛠 / 👀).
// Both hooks fire on this same tool, so the two rules made every conforming comment
// unpostable. The type line answers "what do you need from me", the provenance line answers
// "who wrote this" — the first question is the more urgent one, so the type leads and
// provenance sits directly under it. "Unmistakable source" is satisfied either way; "on line
// 1 exactly" was never the point.
//
// #3996 — all interactive chats post as the same account, so an `interactive` header must also
// name WHICH chat wrote it: `chat <id>` (the first 6 hex chars of the session id, printed at
// session start). Only enforced when the hook input carries a `session_id`; pipeline headers
// are untouched.
import { shortChatId } from '../../scripts/lib/chat-claim.mjs'

let raw = ''
process.stdin.on('data', c => { raw += c })
process.stdin.on('end', () => {
  let body = ''
  let sessionId = ''
  try {
    const parsed = JSON.parse(raw)
    body = ((parsed.tool_input) || {}).body || ''
    sessionId = parsed.session_id || ''
  } catch { /* fall through → block */ }

  // The first THREE non-empty lines: enough for `<type> **headline**` + an optional blank +
  // the provenance line, and still tight enough that the header can't be buried mid-comment.
  const head = body.split('\n').map(l => l.trim()).filter(l => l.length > 0).slice(0, 3)
  const line = head.find(l => l.includes('🤖'))
  if (line) {
    const chat = shortChatId(sessionId)
    if (chat && /interactive/i.test(line) && !new RegExp(`chat ${chat}\\b`, 'i').test(line)) {
      process.stderr.write(
        `Blocked: an interactive 🤖 header must name this chat — add \`chat ${chat}\` to it, e.g.:\n\n` +
        `> 🤖 **Claude Code** · interactive agent · chat ${chat} · posted from \`@pmcp\`’s account (not Maarten) · _<one-line context>_\n\n` +
        'Then re-send the comment.\n'
      )
      process.exit(2)
    }
    process.exit(0) // has a provenance header → allow
  }

  process.stderr.write(
    'Blocked: agent GitHub comments must LEAD with a 🤖 provenance header (they post under ' +
    '@pmcp and must not be mistaken for the human). Prepend a first line, e.g.:\n\n' +
    '> 🤖 **Claude Code** · interactive agent · chat <id> · posted from `@pmcp`’s account (not Maarten) · _<one-line context>_\n\n' +
    'Then re-send the comment.\n'
  )
  process.exit(2)
})
