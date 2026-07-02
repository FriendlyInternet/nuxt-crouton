#!/usr/bin/env node
// require-issue-dedup.mjs — PreToolUse gate for mcp__github__issue_write (method: create).
//
// The repo is issue-first, which makes accidental DUPLICATE issues/epics the main failure
// mode: an ephemeral session opens a second epic for work that's already tracked (the
// #257/#265 blog case). The `/issue-dedup` skill makes "search before you create" a real
// step; this hook is its BACKSTOP — a `create` can't land unless the body carries a
// `Dedup-checked:` attestation line, the receipt that the dedup search was run. (#297)
//
// It can't verify the search actually happened (a hook sees only the tool input), only that
// the agent attested — exactly like require-comment-provenance.mjs checks for a 🤖 header.
//
// Pass: method !== 'create' (updates/etc. are untouched), OR the body contains "Dedup-checked:".
// Block: exit 2 with a reminder (PreToolUse exit 2 cancels the call, stderr → the agent).

let raw = ''
process.stdin.on('data', c => { raw += c })
process.stdin.on('end', () => {
  let input = {}
  try { input = (JSON.parse(raw).tool_input) || {} } catch { /* fall through → block */ }

  // Only gate issue CREATION — updates, closes, label changes, etc. pass through.
  if (input.method && input.method !== 'create') process.exit(0)

  const body = input.body || ''
  if (/Dedup-checked:/i.test(body)) process.exit(0) // attested → allow

  process.stderr.write(
    'Blocked: a new GitHub issue must be dedup-checked first (issue-first → duplicates are the ' +
    'main risk). Run the `/issue-dedup` skill — search open AND recently-closed issues/epics, ' +
    'surface any matches, decide reuse / replace / new — then end the body with a one-line ' +
    'attestation, e.g.:\n\n' +
    '  _Dedup-checked: searched «keyword, keyword» → no match_\n\n' +
    'If a match exists, REUSE it instead of creating a duplicate. Re-send once the body carries ' +
    'the `Dedup-checked:` line.\n'
  )
  process.exit(2)
})
