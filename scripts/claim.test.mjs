/**
 * #3996 contract — chats claim the tickets they drive; a guard stops other chats.
 *
 * The incident: on 2026-11-16 one chat's sweep added `work-this` to #3988 (step 6 of epic #3897,
 * driven by another chat, still waiting on #3980). Every case below replays a piece of that.
 * The hook tests (T6, T7) spawn the REAL hook files with the GitHub lookups replaced by a JSON
 * fixture (CLAIM_FACTS_FILE) — the same code path Claude Code runs, minus the network.
 *
 *   node --test scripts/claim.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  activeClaim, claimMarker, confirmLabelChange, decideClaimGuard, describeClaim,
  detectGuardedAction, releaseMarker, shortChatId, ticketFromPr,
} from './lib/chat-claim.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = join(root, '.claude/hooks/require-unclaimed.mjs')
const PROVENANCE = join(root, '.claude/hooks/require-comment-provenance.mjs')

const NOW = Date.parse('2026-11-16T23:00:00Z')
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString()
const A = 'c7f3a1'
const A_SESSION = 'c7f3a1d2-0000-4000-8000-000000000000'
const B_SESSION = '9b8e7d6c-0000-4000-8000-000000000000'

// ── T1 ──
test('T1 shortChatId turns a session UUID into a 6-char id', () => {
  assert.equal(shortChatId('C7F3A1D2-1234-5678-9abc-def012345678'), 'c7f3a1')
  assert.equal(shortChatId('c7-f3-a1d2'), 'c7f3a1')
  assert.equal(shortChatId(''), '')
  assert.equal(shortChatId(undefined), '')
  assert.equal(shortChatId('not-a-session'), '')
})

test('T1 claimMarker/releaseMarker round-trip through activeClaim (newest marker wins)', () => {
  const m = claimMarker({ chat: A, name: 'products', since: '2026-11-16T22:35Z' })
  assert.equal(m, '<!-- claim: chat=c7f3a1 name="products" since=2026-11-16T22:35Z -->')
  assert.deepEqual(activeClaim({ state: 'OPEN', comments: [{ body: m, createdAt: hoursAgo(1) }], now: NOW }),
    { chat: A, name: 'products', since: '2026-11-16T22:35Z' })

  const released = [
    { body: m, createdAt: hoursAgo(2) },
    { body: releaseMarker(A), createdAt: hoursAgo(1) },
  ]
  assert.equal(activeClaim({ state: 'OPEN', comments: released, now: NOW }), null)

  // re-claimed after the release → claimed again; order of the input array does not matter
  const reclaimed = [
    { body: claimMarker({ chat: 'abcdef', since: 'x' }), createdAt: hoursAgo(0.5) },
    ...released,
  ]
  assert.equal(activeClaim({ state: 'OPEN', comments: reclaimed, now: NOW }).chat, 'abcdef')

  // a release by a DIFFERENT chat does not void the claim
  const foreign = [{ body: m, createdAt: hoursAgo(2) }, { body: releaseMarker('ffffff'), createdAt: hoursAgo(1) }]
  assert.equal(activeClaim({ state: 'OPEN', comments: foreign, now: NOW }).chat, A)
})

// ── T2 ──
test('T2 activeClaim is null for a closed issue and for a claim silent for 24 h', () => {
  const m = claimMarker({ chat: A, name: 'products', since: 's' })
  assert.equal(activeClaim({ state: 'CLOSED', comments: [{ body: m, createdAt: hoursAgo(1) }], now: NOW }), null)
  assert.equal(activeClaim({ state: 'open', comments: [{ body: m, createdAt: hoursAgo(25) }], now: NOW }), null)
  // the claiming chat's later 🤖 header ("chat c7f3a1") keeps it alive
  const kept = [
    { body: m, createdAt: hoursAgo(40) },
    { body: `> 🤖 **Claude Code** · interactive agent · chat ${A} · _update_`, createdAt: hoursAgo(3) },
  ]
  assert.equal(activeClaim({ state: 'OPEN', comments: kept, now: NOW }).chat, A)
  // another chat's chatter does not
  const others = [{ body: m, createdAt: hoursAgo(40) }, { body: 'chat 9b8e7d says hi', createdAt: hoursAgo(1) }]
  assert.equal(activeClaim({ state: 'OPEN', comments: others, now: NOW }), null)
})

// ── T3 ──
test('T3 detectGuardedAction spots the gh CLI shapes', () => {
  assert.deepEqual(detectGuardedAction('Bash', { command: 'gh issue edit 3988 --add-label "type:feat,work-this"' }),
    { kind: 'add-work-this', number: 3988 })
  assert.deepEqual(detectGuardedAction('Bash', { command: "cd x && gh issue edit 3988 --add-label='work-this'" }),
    { kind: 'add-work-this', number: 3988 })
  assert.deepEqual(detectGuardedAction('Bash', { command: 'gh api repos/o/r/issues/3988/labels -f labels[]=work-this' }),
    { kind: 'add-work-this', number: 3988 })
  assert.deepEqual(detectGuardedAction('Bash', { command: 'gh issue edit 3988 --remove-label status:blocked' }),
    { kind: 'unblock', number: 3988 })
  assert.deepEqual(detectGuardedAction('Bash', { command: 'gh api -X DELETE repos/o/r/issues/3988/labels/status%3Ablocked' }),
    { kind: 'unblock', number: 3988 })
  assert.deepEqual(detectGuardedAction('Bash', { command: 'gh pr comment 12 --body "**Worker:** fix"' }),
    { kind: 'worker-comment', number: 12, needsPrMap: true })
  assert.deepEqual(detectGuardedAction('Bash', { command: 'gh pr comment 12 --body-file /tmp/c.md' }),
    { kind: 'worker-comment', number: 12, needsPrMap: true, bodyFile: '/tmp/c.md' })
})

test('T3 detectGuardedAction spots the MCP shapes', () => {
  assert.deepEqual(
    detectGuardedAction('mcp__github__issue_write', { method: 'update', issue_number: 3988, labels: ['type:feat', 'work-this'] }),
    { kind: 'add-work-this', number: 3988, labelsAfter: ['type:feat', 'work-this'] })
  const drop = detectGuardedAction('mcp__github__issue_write', { method: 'update', issue_number: 3988, labels: ['type:feat'] })
  assert.equal(drop.kind, 'unblock')
  assert.equal(confirmLabelChange(drop, [{ name: 'status:blocked' }]), true)
  assert.equal(confirmLabelChange(drop, ['type:feat']), false) // nothing was dropped
  const add = detectGuardedAction('mcp__github__issue_write', { method: 'update', issue_number: 1, labels: ['work-this'] })
  assert.equal(confirmLabelChange(add, ['work-this']), false) // already carried
  assert.deepEqual(
    detectGuardedAction('mcp__github__add_issue_comment', { issue_number: 12, body: '> 🤖 header\n\n**Worker:** fix it' }),
    { kind: 'worker-comment', number: 12, needsPrMap: true })
})

test('T3 detectGuardedAction ignores unrelated calls', () => {
  assert.equal(detectGuardedAction('Bash', { command: 'gh issue view 3988' }), null)
  assert.equal(detectGuardedAction('Bash', { command: 'gh issue edit 3988 --add-label type:feat' }), null)
  assert.equal(detectGuardedAction('Bash', { command: 'grep -rn work-this scripts' }), null)
  assert.equal(detectGuardedAction('Bash', { command: 'gh pr comment 12 --body "looks good"' }), null)
  assert.equal(detectGuardedAction('mcp__github__issue_write', { method: 'create', labels: ['work-this'] }), null)
  assert.equal(detectGuardedAction('mcp__github__add_issue_comment', { issue_number: 12, body: 'no worker line' }), null)
})

test('T3 detectGuardedAction sees through loops, xargs and env prefixes (a sweep is a loop)', () => {
  const g = (command) => detectGuardedAction('Bash', { command })
  assert.deepEqual(g('for n in 1; do gh issue edit 3988 --add-label work-this; done'), { kind: 'add-work-this', number: 3988 })
  assert.deepEqual(g('GH_REPO=o/r gh issue edit 3988 --add-label work-this'), { kind: 'add-work-this', number: 3988 })
  assert.deepEqual(g('bash -c "gh issue edit 3988 --remove-label status:blocked"'), { kind: 'unblock', number: 3988 })
  assert.deepEqual(g('(gh issue edit 3988 --add-label work-this)'), { kind: 'add-work-this', number: 3988 })
  // A ticket the hook can't see is refused, never let through.
  assert.equal(g('for n in 3988 3953; do gh issue edit $n --add-label work-this; done').unresolved, '$n')
  assert.equal(g('echo 3988 | xargs -I{} gh issue edit {} --add-label work-this').unresolved, '{}')
  assert.equal(g('ls | xargs -n1 gh issue edit --add-label work-this').unresolved, '(no number)')
  assert.equal(g('gh api repos/o/r/issues/$n/labels -f labels[]=work-this').unresolved, '$n')
  assert.equal(decideClaimGuard({ action: g('for n in 3988; do gh issue edit $n --add-label work-this; done') }).allow, false)
  // Still quiet on unrelated loops.
  assert.equal(g('for n in 1 2; do gh issue edit $n --add-label type:feat; done'), null)
})

test('ticketFromPr maps a PR to its ticket by Closes #N, else work-<n> branch', () => {
  assert.equal(ticketFromPr({ body: 'Closes #3988\n\nmore' }), 3988)
  assert.equal(ticketFromPr({ body: 'nothing', headRefName: 'pi/work-3988-x' }), 3988)
  assert.equal(ticketFromPr({ body: 'nothing', headRefName: 'feature' }), null)
})

// ── T4 ──
const epicClaim = { chat: A, name: 'products', since: '2026-11-16T22:35Z' }
const chain = [{ issue: 3988, claim: null }, { issue: 3897, claim: epicClaim }]

test('T4 decideClaimGuard refuses another chat on a child of a claimed epic', () => {
  const v = decideClaimGuard({ action: { kind: 'add-work-this', number: 3988 }, myChat: '9b8e7d', claims: chain })
  assert.equal(v.allow, false)
  assert.match(v.reason, /claimed by c7f3a1 \(products\) via epic #3897/)
  assert.match(v.reason, /ask the owner/)
})

test('T4 decideClaimGuard allows the claiming chat and unclaimed tickets', () => {
  assert.equal(decideClaimGuard({ action: { kind: 'add-work-this', number: 3988 }, myChat: A, claims: chain }).allow, true)
  assert.equal(decideClaimGuard({ action: { kind: 'unblock', number: 3988 }, myChat: '9b8e7d', claims: [{ issue: 3988, claim: null }] }).allow, true)
  assert.equal(describeClaim(3988, chain), 'claimed by c7f3a1 (products) via #3897 since 2026-11-16T22:35Z')
  assert.equal(describeClaim(3988, []), 'unclaimed')
})

// ── T5 ──
test('T5 decideClaimGuard refuses work-this while a Blocked-by issue is open', () => {
  const v = decideClaimGuard({ action: { kind: 'add-work-this', number: 3988 }, myChat: A, claims: chain, openBlockers: [3980] })
  assert.equal(v.allow, false)
  assert.match(v.reason, /#3988 waits on #3980 \(open\)/)
  assert.equal(decideClaimGuard({ action: { kind: 'add-work-this', number: 3988 }, myChat: A, claims: chain, openBlockers: [] }).allow, true)
})

// ── T6: the real hook, network replaced by a fixture ──
function fixture(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'claim-'))
  const file = join(dir, 'facts.json')
  writeFileSync(file, JSON.stringify({
    now: new Date(NOW).toISOString(),
    issues: {
      3897: { state: 'OPEN', body: '', comments: [{ body: claimMarker(epicClaim), createdAt: hoursAgo(1) }], parent: null },
      3988: { state: 'OPEN', body: '', labels: [], comments: [], parent: 3897 },
      3980: { state: 'OPEN', body: '', comments: [] },
      ...extra,
    },
    prs: { 12: { body: 'Closes #3988', headRefName: 'pi/work-3988' } },
  }))
  return { file, dir }
}

const runHook = (hook, input, env = {}) => spawnSync('node', [hook], {
  input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CROUTON_CHAT_ID: '', ...env },
})

test('T6 hook refuses gh issue edit --add-label work-this from another chat', () => {
  const { file } = fixture()
  const r = runHook(HOOK, { session_id: B_SESSION, tool_name: 'Bash', tool_input: { command: 'gh issue edit 3988 --add-label work-this' } },
    { CLAIM_FACTS_FILE: file })
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /#3988 is claimed by c7f3a1 \(products\) via epic #3897/)
})

test('T6 hook allows the same command from the claiming chat', () => {
  const { file } = fixture()
  const r = runHook(HOOK, { session_id: A_SESSION, tool_name: 'Bash', tool_input: { command: 'gh issue edit 3988 --add-label work-this' } },
    { CLAIM_FACTS_FILE: file })
  assert.equal(r.status, 0, r.stderr)
})

test('T6 hook refuses a **Worker:** PR comment (mapped via Closes #N) and an open Blocked-by', () => {
  const { file } = fixture()
  const w = runHook(HOOK, { session_id: B_SESSION, tool_name: 'mcp__github__add_issue_comment', tool_input: { issue_number: 12, body: '> 🤖 x\n\n**Worker:** redo it' } },
    { CLAIM_FACTS_FILE: file })
  assert.equal(w.status, 2, w.stderr)
  const blocked = fixture({ 3988: { state: 'OPEN', body: 'Blocked-by: #3980', labels: [], comments: [], parent: null } })
  const b = runHook(HOOK, { session_id: A_SESSION, tool_name: 'Bash', tool_input: { command: 'gh issue edit 3988 --add-label work-this' } },
    { CLAIM_FACTS_FILE: blocked.file })
  assert.equal(b.status, 2, b.stderr)
  assert.match(b.stderr, /waits on #3980 \(open\)/)
})

test('T6 hook refuses a loop sweep: a literal ticket is checked, a $n ticket is refused with no lookup', () => {
  const { file } = fixture()
  const loop = runHook(HOOK, { session_id: B_SESSION, tool_name: 'Bash', tool_input: { command: 'for n in 1; do gh issue edit 3988 --add-label work-this; done' } },
    { CLAIM_FACTS_FILE: file })
  assert.equal(loop.status, 2, loop.stderr)
  assert.match(loop.stderr, /#3988 is claimed by c7f3a1/)
  const sweep = runHook(HOOK, { session_id: B_SESSION, tool_name: 'Bash', tool_input: { command: 'for n in 3988 3953; do gh issue edit $n --add-label work-this; done' } },
    { CLAIM_FACTS_FILE: '/nonexistent/facts.json' })
  assert.equal(sweep.status, 2, sweep.stderr)
  assert.match(sweep.stderr, /can't tell which ticket this targets \(\$n\)/)
  const xargs = runHook(HOOK, { session_id: A_SESSION, tool_name: 'Bash', tool_input: { command: 'echo 3988 | xargs -I{} gh issue edit {} --add-label work-this' } },
    { CLAIM_FACTS_FILE: file })
  assert.equal(xargs.status, 2, xargs.stderr)
})

test('T6 hook passes an unrelated command with no lookup', () => {
  const r = runHook(HOOK, { session_id: B_SESSION, tool_name: 'Bash', tool_input: { command: 'gh issue view 1' } },
    { CLAIM_FACTS_FILE: '/nonexistent/facts.json' })
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '') // a lookup would have failed open with a note on stderr
})

test('T6 hook fails open when a lookup fails', () => {
  const r = runHook(HOOK, { session_id: B_SESSION, tool_name: 'Bash', tool_input: { command: 'gh issue edit 3988 --add-label work-this' } },
    { CLAIM_FACTS_FILE: '/nonexistent/facts.json' })
  assert.equal(r.status, 0)
  assert.match(r.stderr, /lookup failed, allowing/)
})

// ── T7: provenance hook requires the chat id on interactive headers ──
test('T7 provenance hook refuses an interactive header without chat <id>', () => {
  const body = '✅ **done**\n> 🤖 **Claude Code** · interactive agent · posted from `@pmcp` · _x_\n\nok'
  const r = runHook(PROVENANCE, { session_id: A_SESSION, tool_input: { body } })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /chat c7f3a1/)
  const ok = runHook(PROVENANCE, { session_id: A_SESSION, tool_input: { body: body.replace('interactive agent', 'interactive agent · chat c7f3a1') } })
  assert.equal(ok.status, 0, ok.stderr)
})

test('T7 provenance hook leaves pipeline headers alone', () => {
  const body = '> 🤖 **pi.dev harness** · agent pipeline (CI) · _x_\n\nok'
  assert.equal(runHook(PROVENANCE, { session_id: A_SESSION, tool_input: { body } }).status, 0)
  // no session id (e.g. an older harness) → the old rule only
  const interactive = '> 🤖 **Claude Code** · interactive agent · _x_'
  assert.equal(runHook(PROVENANCE, { tool_input: { body: interactive } }).status, 0)
})
