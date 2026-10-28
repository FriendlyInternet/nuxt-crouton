// layer: harness
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
