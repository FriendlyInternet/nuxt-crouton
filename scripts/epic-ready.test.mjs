// The pure epic→main-ready predicate (#1815). A false SKIP is safe; a false OPEN spams main — so
// these pin the conservative rule: open only when children exist, ALL closed, branch ahead, no PR.
//   node --test scripts/epic-ready.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEpicNumber, decideOpen, resolveEpicTarget } from './epic-ready.mjs'

test('parseEpicNumber pulls the number from an epic branch, else null', () => {
  assert.equal(parseEpicNumber('epic/1701-cold-scaffold-first-run'), 1701)
  assert.equal(parseEpicNumber('epic/42-x'), 42)
  assert.equal(parseEpicNumber('work-1741'), null)
  assert.equal(parseEpicNumber('main'), null)
  assert.equal(parseEpicNumber(''), null)
  assert.equal(parseEpicNumber(undefined), null)
})

const CLOSED = { state: 'closed' }
const OPEN = { state: 'open' }

test('opens when all children closed, branch ahead, no existing PR', () => {
  const d = decideOpen({ subIssues: [CLOSED, CLOSED], existingEpicMainPrs: [], aheadCount: 3 })
  assert.equal(d.open, true)
})

test('does NOT open while any child is still open', () => {
  const d = decideOpen({ subIssues: [CLOSED, OPEN], existingEpicMainPrs: [], aheadCount: 3 })
  assert.equal(d.open, false)
  assert.match(d.reason, /1 child/)
})

test('does NOT open when an epic→main PR already exists (idempotent, no dup)', () => {
  const d = decideOpen({ subIssues: [CLOSED], existingEpicMainPrs: [{ number: 9 }], aheadCount: 3 })
  assert.equal(d.open, false)
  assert.match(d.reason, /already open/)
})

test('does NOT open an epic with no sub-issues', () => {
  const d = decideOpen({ subIssues: [], existingEpicMainPrs: [], aheadCount: 3 })
  assert.equal(d.open, false)
  assert.match(d.reason, /no sub-issues/)
})

test('does NOT open when the branch is not ahead of main (nothing to land)', () => {
  const d = decideOpen({ subIssues: [CLOSED], existingEpicMainPrs: [], aheadCount: 0 })
  assert.equal(d.open, false)
  assert.match(d.reason, /ahead of main/)
})

test('defaults are safe — empty call never opens', () => {
  assert.equal(decideOpen().open, false)
})

// ── resolveEpicTarget (#2152: solo leaf vs genuine epic) ──────────────────────
test('a real child of a distinct epic: epicNumber from the block, never solo', () => {
  const r = resolveEpicTarget({ closedIssueNumber: 42, blockEpicNumber: 10, subIssueCount: 0 })
  assert.deepEqual(r, { epicNumber: 10, isSolo: false })
})

test('a solo leaf with no pipeline block at all defaults epicNumber to its own number', () => {
  const r = resolveEpicTarget({ closedIssueNumber: 2146, blockEpicNumber: null, subIssueCount: 0 })
  assert.deepEqual(r, { epicNumber: 2146, isSolo: true })
})

test('a solo leaf whose block DID survive (epic=self) is still solo when it has no real sub-issues', () => {
  const r = resolveEpicTarget({ closedIssueNumber: 2146, blockEpicNumber: 2146, subIssueCount: 0 })
  assert.deepEqual(r, { epicNumber: 2146, isSolo: true })
})

test('a genuine multi-child epic closing directly (epic=self, real sub-issues) is NOT solo', () => {
  const r = resolveEpicTarget({ closedIssueNumber: 100, blockEpicNumber: 100, subIssueCount: 5 })
  assert.deepEqual(r, { epicNumber: 100, isSolo: false })
})

test('a genuine epic with no block at all (defaults to self) but real sub-issues is NOT solo', () => {
  const r = resolveEpicTarget({ closedIssueNumber: 100, blockEpicNumber: null, subIssueCount: 3 })
  assert.deepEqual(r, { epicNumber: 100, isSolo: false })
})

// ── packages approval carry (#2494) ───────────────────────────────────────────
import { packagesApprovalCarry, ownerApproved, closesNumbers } from './epic-ready.mjs'
import { ATTESTATION_RE, evaluatePackagesGuard } from './packages-guard.mjs'

const PKG = ['packages/crouton-core/app/components/CroutonBlockFrame.vue']
const APP = ['apps/kassa/app/pages/index.vue']
const OK = { login: 'pmcp', body: 'lgtm' }

test('closesNumbers reads Closes #NN from prose, never from code', () => {
  assert.deepEqual(closesNumbers('Closes #12\n`Closes #99`\n```\nCloses #98\n```'), [12])
  assert.deepEqual(closesNumbers(''), [])
})

test('ownerApproved: owner lgtm comment or APPROVED review; others never', () => {
  assert.equal(ownerApproved({ comments: [OK], owner: 'pmcp' }), true)
  assert.equal(ownerApproved({ comments: [{ login: 'PMCP', body: '✅' }], owner: 'pmcp' }), true)
  assert.equal(ownerApproved({ reviews: [{ login: 'pmcp', state: 'APPROVED' }], owner: 'pmcp' }), true)
  assert.equal(ownerApproved({ reviews: [{ login: 'pmcp', state: 'CHANGES_REQUESTED' }], owner: 'pmcp' }), false)
  assert.equal(ownerApproved({ comments: [{ login: 'nuxt-harness[bot]', body: 'lgtm' }], owner: 'pmcp' }), false)
  assert.equal(ownerApproved({ comments: [{ login: 'pmcp', body: '> lgtm' }], owner: 'pmcp' }), false)
})

test('all packages-touching sub-PRs approved → one attestation line naming them', () => {
  const r = packagesApprovalCarry({ owner: 'pmcp', subPrs: [
    { number: 2470, files: PKG, comments: [OK] },
    { number: 2471, files: APP, comments: [] },
    { number: 2472, files: PKG, reviews: [{ login: 'pmcp', state: 'APPROVED' }] },
  ] })
  assert.deepEqual(r.packagesPrs, [2470, 2472])
  assert.deepEqual(r.approved, [2470, 2472])
  assert.deepEqual(r.unapproved, [])
  assert.match(r.line, /^Packages-approved: owner approved #2470, #2472/)
})

test('one unapproved packages sub-PR → no line, it is named', () => {
  const r = packagesApprovalCarry({ owner: 'pmcp', subPrs: [
    { number: 1, files: PKG, comments: [OK] },
    { number: 2, files: PKG, comments: [{ login: 'pmcp', body: 'change the padding first' }] },
  ] })
  assert.equal(r.line, null)
  assert.deepEqual(r.unapproved, [2])
})

test('no sub-PR touched packages → nothing to declare', () => {
  const r = packagesApprovalCarry({ owner: 'pmcp', subPrs: [{ number: 1, files: APP, comments: [OK] }] })
  assert.deepEqual(r, { packagesPrs: [], approved: [], unapproved: [], line: null })
})

test('the carried line satisfies packages-guard — the two agree (#2494 acceptance)', () => {
  const { line } = packagesApprovalCarry({ owner: 'pmcp', subPrs: [{ number: 7, files: PKG, comments: [OK] }] })
  assert.ok(ATTESTATION_RE.test(line))
  const g = evaluatePackagesGuard({ changedFiles: PKG, body: `Assembles epic\n\n${line}\n` })
  assert.equal(g.declared, true)
  assert.equal(g.signal, 'attestation')
})

import { collectApprovalLines } from './epic-ready.mjs'
test('collectApprovalLines copies Packages-approved lines from epic + children, de-duplicated', () => {
  const a = 'intro\nPackages-approved: owner ok #1\n'
  const b = 'x\n  Packages-approved: owner ok #1\nPackages-approved: other\n```\nPackages-approved: in fence\n```'
  assert.deepEqual(collectApprovalLines([a, b, null]), ['Packages-approved: owner ok #1', 'Packages-approved: other'])
  assert.deepEqual(collectApprovalLines(['nothing']), [])
})

// ── buildEpicMainPr (#3619) ──
import { buildEpicMainPr } from './epic-ready.mjs'
const noCarry = { packagesPrs: [], approved: [], unapproved: [], line: null }
const mk = o => buildEpicMainPr({ epicNumber: 7, epicBranch: 'epic/7-x', epicTitle: 'Epic: Thing', subIssues: [{ number: 1, title: 'a' }], carry: noCarry, declared: [], owner: 'pmcp', ...o })

test('buildEpicMainPr: no packages, no declared → plain body with footer', () => {
  const { title, body } = mk()
  assert.equal(title, 'Epic #7: Thing')
  assert.ok(!body.includes('Packages-approved') && !body.includes('🔒'))
  assert.ok(body.endsWith('<sub>🤖 agent pipeline (CI) · epic→main assembler (#1815) · review requested from @pmcp</sub>'))
  assert.ok(body.includes('**Children (1):**\n- #1 a\n\n'))
})
test('buildEpicMainPr: carry.line is embedded', () => {
  const line = 'Packages-approved: owner approved #3 (sub-PR sign-off carried by epic-ready-pr, #2494)'
  assert.ok(mk({ carry: { packagesPrs: [3], approved: [3], unapproved: [], line } }).body.includes(`\n\n${line}\n`))
})
test('buildEpicMainPr: unapproved packages PRs list the 🔒 section', () => {
  const { body } = mk({ carry: { packagesPrs: [1, 2], approved: [], unapproved: [1, 2], line: null } })
  assert.ok(body.includes('## 🔒 Shared code not yet signed off'))
  assert.ok(body.includes('#1, #2'))
})
test('buildEpicMainPr: declared line equal to carry.line appears once', () => {
  const line = 'Packages-approved: owner approved #3 (sub-PR sign-off carried by epic-ready-pr, #2494)'
  const { body } = mk({ carry: { packagesPrs: [3], approved: [3], unapproved: [], line }, declared: [line, 'Packages-approved: x'] })
  assert.equal(body.split(line).length - 1, 1)
  assert.ok(body.includes('Packages-approved: x'))
})
test('buildEpicMainPr: title strips Epic: and is cut to 250', () => {
  const { title } = mk({ epicTitle: 'EPIC: ' + 'z'.repeat(400) })
  assert.equal(title.length, 250)
  assert.ok(title.startsWith('Epic #7: zzz'))
})
// #3846 rule: a rolling epic is finished only when every step in its step list has a closed ticket.
test('10. decideOpen: pending steps of a rolling epic keep the epic→main PR closed', () => {
  const r = decideOpen({ subIssues: [CLOSED], aheadCount: 2, pendingSteps: 3 })
  assert.equal(r.open, false)
  assert.match(r.reason, /step/)
  assert.equal(decideOpen({ subIssues: [CLOSED], aheadCount: 2, pendingSteps: 0 }).open, true)
  assert.equal(decideOpen({ subIssues: [CLOSED], aheadCount: 2 }).open, true)
})

test('buildEpicMainPr: solo-leaf child renders "undefined" title', () => {
  // quirk preserved — see #3619
  assert.ok(mk({ subIssues: [{ number: 9, state: 'closed' }] }).body.includes('- #9 undefined'))
})
