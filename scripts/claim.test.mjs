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
  activeClaim, claimMarker, confirmLabelChange, decideAdoptGuard, decideClaimGuard, describeClaim,
  detectAdopts, detectGuardedAction, issueNodeId, releaseMarker, shortChatId, ticketFromPr,
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

// ── #4517: putting a ticket that is already being built under an epic (adopt) ──
// The 23 Nov incident: #4375, #4376 and #4377 were put under new epics after they had started.
// The fixtures replay their shapes on that day (live labels have moved on since).
const B_CHAT = '9b8e7d'
const REPO_ID = 1063412456
const ID_4375 = 6592202606 // any id: the fixture maps its node id to #4375
function adoptFixture(issues = {}, prs = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'adopt-'))
  const file = join(dir, 'facts.json')
  writeFileSync(file, JSON.stringify({
    now: new Date(NOW).toISOString(),
    repoId: REPO_ID,
    nodes: { [issueNodeId(REPO_ID, ID_4375)]: 4375 },
    issues: {
      4455: { state: 'OPEN', body: '', labels: ['epic'], comments: [], parent: null },
      4375: { state: 'OPEN', body: '', labels: ['work-this', 'plan:approved', 'status:blocked'], comments: [], parent: null },
      4376: { state: 'OPEN', body: '', labels: ['work-this', 'status:blocked'], comments: [], parent: null },
      4377: { state: 'OPEN', body: '', labels: ['plan:approved'], comments: [], parent: null },
      4380: { state: 'OPEN', body: '', labels: ['type:feat'], comments: [], parent: null },
      ...issues,
    },
    prs: { 4381: { body: 'Closes #4377', headRefName: 'work-4377' }, 4300: { body: '', headRefName: 'work-4380', state: 'MERGED' }, ...prs },
  }))
  return file
}
const bash = (command) => ({ session_id: B_SESSION, tool_name: 'Bash', tool_input: { command } })
const adoptHook = (input, file) => runHook(HOOK, input, { CLAIM_FACTS_FILE: file })

// covers: T8
test('T8 a #4375-shaped child (work-this, plan:approved, status:blocked) put under an epic is refused', () => {
  const r = adoptHook(bash('gh issue edit 4375 --parent 4455'), adoptFixture())
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /#4375 is already being built \(work-this, plan:approved, status:blocked\)/)
  assert.match(r.stderr, /leave it where it is, or ask the owner/)
})

// covers: T9
test('T9 a #4376-shaped child (work-this, status:blocked) is refused', () => {
  const r = adoptHook(bash('gh issue edit 4376 --parent 4455'), adoptFixture())
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /#4376 is already being built \(work-this, status:blocked\)/)
})

// covers: T10
test('T10 a #4377-shaped child (plan:approved, open PR on work-4377) is refused and names the PR', () => {
  const r = adoptHook(bash('gh issue edit 4377 --parent 4455'), adoptFixture())
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /#4381/)
})

// covers: T11
test('T11 decideAdoptGuard passes a fresh open ticket and a closed one', () => {
  const claims = [{ issue: 4380, claim: null }]
  assert.equal(decideAdoptGuard({ child: 4380, issue: { state: 'OPEN', labels: ['type:feat'] }, claims, openPrs: [] }).allow, true)
  assert.equal(decideAdoptGuard({ child: 4380, issue: { state: 'CLOSED', labels: ['work-this'] }, claims, openPrs: [] }).allow, true)
  // an open PR on another ticket's branch does not count; pi/work-<n> does
  assert.equal(decideAdoptGuard({ child: 4380, issue: { state: 'OPEN', labels: [] }, claims, openPrs: [{ number: 1, headRefName: 'work-43800' }] }).allow, true)
  assert.equal(decideAdoptGuard({ child: 4380, issue: { state: 'OPEN', labels: [] }, claims, openPrs: [{ number: 1, headRefName: 'pi/work-4380' }] }).allow, false)
})

// covers: T12
test('T12 the owner\'s yes the existing way: the chat holding the claim may adopt, another chat may not', () => {
  const claimed = { 4375: { state: 'OPEN', body: '', labels: ['work-this', 'plan:approved', 'status:blocked'], comments: [{ body: claimMarker({ chat: A, since: 's' }), createdAt: hoursAgo(1) }], parent: null } }
  const file = adoptFixture(claimed)
  const mine = adoptHook({ ...bash('gh issue edit 4375 --parent 4455'), session_id: A_SESSION }, file)
  assert.equal(mine.status, 0, mine.stderr)
  const other = adoptHook(bash('gh issue edit 4375 --parent 4455'), file)
  assert.equal(other.status, 2, other.stderr)
  assert.match(other.stderr, /#4375 is claimed by c7f3a1/)
  // same rule directly
  assert.equal(decideAdoptGuard({ child: 4375, issue: claimed[4375], myChat: B_CHAT, claims: [{ issue: 4375, claim: { chat: A, name: '' } }] }).allow, false)
})

// covers: T13
test('T13 detectAdopts reads child and epic for every covered shape, and ignores the rest', () => {
  const b = (command) => detectAdopts('Bash', { command })
  const one = [{ kind: 'adopt', epic: 4455, children: [{ number: 4375 }] }]
  assert.deepEqual(b('gh issue edit 4375 --parent 4455'), one)
  assert.deepEqual(b('gh issue edit 4375 --parent=https://github.com/o/r/issues/4455'), one)
  assert.deepEqual(b('gh api repos/o/r/issues/4455/sub_issues -F sub_issue_id=6592202606'),
    [{ kind: 'adopt', epic: 4455, children: [{ childId: 6592202606 }] }])
  assert.deepEqual(b(`gh api graphql -f query='mutation{addSubIssue(input:{issueId:"I_x",subIssueUrl:"https://github.com/o/r/issues/4375"}){clientMutationId}}'`),
    [{ kind: 'adopt', epic: null, children: [{ number: 4375 }] }])
  assert.deepEqual(b(`gh api graphql -f query='mutation{addSubIssue(input:{issueId:"I_x",subIssueId:"I_kwDOP2Ji6M8AAAABiO0Hbg"}){clientMutationId}}'`),
    [{ kind: 'adopt', epic: null, children: [{ childNode: 'I_kwDOP2Ji6M8AAAABiO0Hbg' }] }])
  assert.deepEqual(detectAdopts('mcp__github__sub_issue_write', { method: 'add', issue_number: 4455, sub_issue_id: 6592202606 }),
    [{ kind: 'adopt', epic: 4455, children: [{ childId: 6592202606 }] }])
  const sub = b('gh api repos/o/r/issues/4455/sub_issues -F sub_issue_id=$(gh api repos/o/r/issues/4375 --jq .id)')
  assert.equal(sub.length, 1)
  assert.ok(sub[0].unresolved, JSON.stringify(sub))
  assert.ok(b(`gh api graphql -f query='mutation($c:ID!){addSubIssue(input:{issueId:"I_x",subIssueId:$c}){clientMutationId}}' -f c=I_y`)[0].unresolved)
  for (const cmd of [
    'gh issue edit 4375 --remove-parent',
    'gh issue edit 4455 --remove-sub-issue 4375',
    'gh api repos/o/r/issues/4455/sub_issues',
    'gh api -X DELETE repos/o/r/issues/4455/sub_issue -F sub_issue_id=1',
    'gh issue view 4375',
    'gh issue create --parent 4455 --title x',
  ]) assert.deepEqual(b(cmd), [], cmd)
  assert.deepEqual(detectAdopts('mcp__github__sub_issue_write', { method: 'remove', issue_number: 4455, sub_issue_id: 1 }), [])
  assert.deepEqual(detectAdopts('mcp__github__issue_write', { method: 'update', issue_number: 1 }), [])
})

// covers: T14
test('T14 issueNodeId builds the real node id, and an MCP adopt by id is resolved and refused', () => {
  assert.equal(issueNodeId(1063412456, 6592202606), 'I_kwDOP2Ji6M8AAAABiO0Hbg')
  const r = adoptHook({ session_id: B_SESSION, tool_name: 'mcp__github__sub_issue_write', tool_input: { method: 'add', issue_number: 4455, sub_issue_id: ID_4375 } }, adoptFixture())
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /#4375 is already being built/)
  const rest = adoptHook(bash(`gh api repos/o/r/issues/4455/sub_issues -F sub_issue_id=${ID_4375}`), adoptFixture())
  assert.equal(rest.status, 2, rest.stderr)
})

// covers: T15
test('T15 a failed lookup fails open with a note; an unrelated call makes no lookup', () => {
  const r = adoptHook(bash('gh issue edit 4375 --parent 4455'), '/nonexistent/facts.json')
  assert.equal(r.status, 0)
  assert.match(r.stderr, /lookup failed, allowing/)
  const quiet = adoptHook(bash('gh issue view 1'), '/nonexistent/facts.json')
  assert.equal(quiet.status, 0)
  assert.equal(quiet.stderr, '')
})

// covers: T16
test('T16 --parent: flag order and several children are read right', () => {
  const b = (command) => detectAdopts('Bash', { command })
  assert.deepEqual(b('gh issue edit --parent 4455 4375'), [{ kind: 'adopt', epic: 4455, children: [{ number: 4375 }] }])
  const two = [{ kind: 'adopt', epic: 4455, children: [{ number: 4375 }, { number: 4376 }] }]
  assert.deepEqual(b('gh issue edit 4375 4376 --parent 4455'), two)
  assert.deepEqual(b('gh issue edit -R o/r 4375 --title x 4376 --parent 4455'), two)
  assert.equal(b('gh issue edit $n --parent 4455')[0].unresolved, '$n')
  const file = adoptFixture()
  const mixed = adoptHook(bash('gh issue edit 4380 4376 --parent 4455'), file)
  assert.equal(mixed.status, 2, mixed.stderr)
  assert.match(mixed.stderr, /#4376/)
  const flagFirst = adoptHook(bash('gh issue edit --parent 4455 4375'), file)
  assert.equal(flagFirst.status, 2, flagFirst.stderr)
  assert.match(flagFirst.stderr, /#4375 is already being built/)
  const sweep = adoptHook(bash('for n in 4375; do gh issue edit $n --parent 4455; done'), '/nonexistent/facts.json')
  assert.equal(sweep.status, 2, sweep.stderr)
  assert.match(sweep.stderr, /can't tell which ticket/)
})

// covers: T17
test('T17 --add-sub-issue (epic side): every listed child is checked', () => {
  const b = (command) => detectAdopts('Bash', { command })
  assert.deepEqual(b('gh issue edit 4455 --add-sub-issue 4375,4376,4377'),
    [{ kind: 'adopt', epic: 4455, children: [{ number: 4375 }, { number: 4376 }, { number: 4377 }] }])
  assert.deepEqual(b('gh issue edit --add-sub-issue https://github.com/o/r/issues/4375 4455 --add-sub-issue 4376'),
    [{ kind: 'adopt', epic: 4455, children: [{ number: 4375 }, { number: 4376 }] }])
  assert.equal(b('gh issue edit 4455 --add-sub-issue $x')[0].unresolved, '$x')
  const file = adoptFixture()
  const refused = adoptHook(bash('gh issue edit 4455 --add-sub-issue 4380,4377'), file)
  assert.equal(refused.status, 2, refused.stderr)
  assert.match(refused.stderr, /#4381/)
  const fresh = adoptHook(bash('gh issue edit 4455 --add-sub-issue 4380'), file)
  assert.equal(fresh.status, 0, fresh.stderr) // #4380's merged PR does not count
})

// covers: T18
test('T18 an adopt in the same command as a label change is still judged by the adopt rule', () => {
  const file = adoptFixture()
  for (const cmd of [
    'gh issue edit 4375 --parent 4455 --add-label work-this',
    'gh issue edit --remove-label status:blocked --parent 4455 4375',
    'gh issue edit 4380 --add-label work-this && gh issue edit 4375 --parent 4455',
  ]) {
    const r = adoptHook(bash(cmd), file)
    assert.equal(r.status, 2, `${cmd}: ${r.stderr}`)
    assert.match(r.stderr, /#4375 is already being built/, cmd)
  }
  assert.deepEqual(detectGuardedAction('Bash', { command: 'gh issue edit 4375 --parent 4455 --add-label work-this' }),
    { kind: 'add-work-this', number: 4375 })
  const labelOnly = adoptHook(bash('gh issue edit 4380 --add-label work-this'), file)
  assert.equal(labelOnly.status, 0, labelOnly.stderr)
})
