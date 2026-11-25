/**
 * #1611 contract — the PR-time packages/ gate: a diff touching `packages/**` fails unless the
 * edit is *declared* (a `packages:approved` label, a `Packages-approved:` body line, or a linked
 * `pkg:*` issue), and the blast-radius comment names every changed package file.
 *
 *   node --test scripts/packages-guard.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  packagesTouched,
  blastRadius,
  evaluatePackagesGuard,
  formatComment,
  packagesApprovalFor,
  formatPackagesNotice,
  finishStepBody,
  APPROVED_LABEL,
  COMMENT_MARKER,
} from './packages-guard.mjs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_FILE = 'packages/crouton-sales/app/components/EventWorkspace/DataPanel.vue'
const APP_FILE = 'apps/fanfare/nuxt.config.ts'

test('packagesTouched filters to packages/ only', () => {
  assert.deepEqual(
    packagesTouched([APP_FILE, PKG_FILE, 'scripts/x.mjs']),
    [PKG_FILE],
  )
})

test('blastRadius groups changed files by package name', () => {
  const r = blastRadius([PKG_FILE, 'packages/crouton-core/a.ts', 'packages/crouton-sales/b.ts', APP_FILE])
  assert.deepEqual(Object.keys(r).sort(), ['crouton-core', 'crouton-sales'])
  assert.equal(r['crouton-sales'].length, 2)
})

test('no packages/** changed → declared (no-op), signal none', () => {
  const r = evaluatePackagesGuard({ changedFiles: [APP_FILE, 'scripts/x.mjs'] })
  assert.equal(r.declared, true)
  assert.equal(r.signal, 'none')
  assert.deepEqual(r.touched, [])
})

test('packages/** changed with NO signal → NOT declared (the gate fires)', () => {
  const r = evaluatePackagesGuard({ changedFiles: [PKG_FILE], prLabels: ['type:chore'], body: 'just a fix' })
  assert.equal(r.declared, false)
  assert.equal(r.signal, null)
  assert.deepEqual(r.packages, ['crouton-sales'])
})

test('the packages:approved label declares the edit', () => {
  const r = evaluatePackagesGuard({ changedFiles: [PKG_FILE], prLabels: [APPROVED_LABEL] })
  assert.equal(r.declared, true)
  assert.equal(r.signal, 'label')
})

test('a Packages-approved: body line declares the edit', () => {
  const r = evaluatePackagesGuard({ changedFiles: [PKG_FILE], body: 'Fixes it.\n\nPackages-approved: signed off by owner' })
  assert.equal(r.declared, true)
  assert.equal(r.signal, 'attestation')
})

test('a linked pkg:* issue declares the edit', () => {
  const r = evaluatePackagesGuard({ changedFiles: [PKG_FILE], linkedIssueLabels: ['type:feat', 'pkg:crouton-sales'] })
  assert.equal(r.declared, true)
  assert.equal(r.signal, 'pkg-issue')
})

test('signal precedence: label wins over attestation + pkg-issue', () => {
  const r = evaluatePackagesGuard({
    changedFiles: [PKG_FILE],
    prLabels: [APPROVED_LABEL],
    body: 'Packages-approved: x',
    linkedIssueLabels: ['pkg:crouton-sales'],
  })
  assert.equal(r.signal, 'label')
})

test('formatComment carries the marker, every touched file, and the 🤖 provenance', () => {
  const body = formatComment([PKG_FILE, 'packages/crouton-core/a.ts', APP_FILE])
  assert.match(body, new RegExp(COMMENT_MARKER))
  assert.match(body, /crouton-sales/)
  assert.match(body, /crouton-core/)
  assert.ok(body.includes(PKG_FILE), 'names the exact changed package file')
  assert.ok(!body.includes(APP_FILE), 'does not list non-package files')
  assert.match(body, /🤖 agent pipeline \(CI\)/)
})

// ── #3701 — the run-time notice + the finish step's PR-body line ───────────────────────────────────────
const LINE = 'Packages-approved: owner yes 2026-11-10'
const CORE = 'packages/crouton-core/a.ts'

test('#3701 case 1: approved ticket → allowed, returns the exact line to copy', () => {
  const r = packagesApprovalFor({ changedFiles: [CORE], ticketBody: `Intro\n${LINE}\nmore`, ticketLabels: [] })
  assert.equal(r.status, 'approved')
  assert.equal(r.via, 'line')
  assert.equal(r.line, LINE)
  assert.equal(r.prNote, `\n\n${LINE}`)
  assert.deepEqual(r.approved, ['crouton-core'])
  assert.ok(formatPackagesNotice(r, 'crouton-core').includes(LINE))
})

test('#3701 case 2: same path, no line → not approved', () => {
  const r = packagesApprovalFor({ changedFiles: [CORE], ticketBody: 'no approval here', ticketLabels: ['type:fix', 'work-this'] })
  assert.equal(r.status, 'not-approved')
  assert.deepEqual(r.unapproved, ['crouton-core'])
  assert.equal(r.line, null)
  assert.equal(r.prNote, '')
  assert.match(formatPackagesNotice(r, 'crouton-core'), /no package approval for `crouton-core`: undo the change under packages\/crouton-core\//)
})

test('#3701 case 3: only paths outside packages/ → nothing to say', () => {
  const r = packagesApprovalFor({ changedFiles: ['apps/velo/x.vue', 'scripts/y.mjs'], ticketBody: LINE })
  assert.equal(r.status, 'none')
  assert.equal(r.prNote, '')
})

test('#3701 case 4: approval names one package, diff touches another → not approved for the other', () => {
  const byLabel = packagesApprovalFor({ changedFiles: [CORE], ticketBody: LINE, ticketLabels: ['pkg:crouton-assets'] })
  const byLine = packagesApprovalFor({ changedFiles: [CORE], ticketBody: 'Packages-approved: `packages/crouton-assets/x.ts` only' })
  for (const r of [byLabel, byLine]) {
    assert.equal(r.status, 'partial')
    assert.deepEqual(r.approved, [])
    assert.deepEqual(r.unapproved, ['crouton-core'])
    assert.deepEqual(r.scope, ['crouton-assets'])
    assert.match(formatPackagesNotice(r, 'crouton-core'), /approves `crouton-assets`, not `crouton-core`: undo/)
  }
  assert.equal(byLabel.prNote, `\n\n${LINE}`, 'the line is still copied — CI stays the one that decides')
})

test('#3701: a pkg:* label alone approves (CI accepts a linked pkg:* ticket) — no line, no undo', () => {
  const r = packagesApprovalFor({ changedFiles: ['packages/crouton-layout/x.vue'], ticketBody: 'Closes nothing', ticketLabels: ['pkg:crouton-layout'] })
  assert.equal(r.status, 'approved')
  assert.equal(r.via, 'pkg-label')
  assert.equal(r.prNote, '')
  const msg = formatPackagesNotice(r, 'crouton-layout')
  assert.match(msg, /allowed/)
  assert.doesNotMatch(msg, /undo/)
})

test('#3701: a fenced or backticked example line is not an approval', () => {
  const fenced = packagesApprovalFor({ changedFiles: [CORE], ticketBody: '```\nPackages-approved: example\n```\n`Packages-approved: x`' })
  assert.equal(fenced.status, 'not-approved')
  assert.equal(fenced.line, null)
})

test('#3701: the wildcard line from #3673 (`packages/*/build.config.ts` only) approves every package', () => {
  const r = packagesApprovalFor({
    changedFiles: ['packages/crouton-core/build.config.ts', 'packages/crouton-auth/build.config.ts'],
    ticketBody: 'Packages-approved: owner yes 2026-11-10 — `packages/*/build.config.ts` only',
    ticketLabels: ['type:fix', 'work-this', 'plan:approved'],
  })
  assert.equal(r.status, 'approved')
  assert.equal(r.scope, null)
})

test('#3701 rule: the notice never disagrees with the CI check, on real ticket shapes', () => {
  const rows = [
    { name: 'case 1', changedFiles: [CORE], ticketBody: LINE, ticketLabels: [] },
    { name: 'case 2', changedFiles: [CORE], ticketBody: 'x', ticketLabels: ['type:fix', 'work-this'] },
    { name: 'case 3', changedFiles: ['apps/velo/x.vue'], ticketBody: 'x', ticketLabels: [] },
    { name: 'case 4', changedFiles: [CORE], ticketBody: LINE, ticketLabels: ['pkg:crouton-assets'] },
    { name: '#3673', changedFiles: ['packages/crouton-core/build.config.ts'], ticketBody: 'Packages-approved: owner yes — `packages/*/build.config.ts` only', ticketLabels: ['type:fix', 'work-this', 'plan:approved'], expect: 'approved' },
    { name: '#3708', changedFiles: ['packages/crouton-layout/app/a.vue'], ticketBody: 'refactor', ticketLabels: ['type:refactor', 'pkg:crouton-layout'], expect: 'approved' },
    { name: '#3635', changedFiles: ['packages/crouton-core/b.ts'], ticketBody: 'fix', ticketLabels: ['pkg:crouton-core'], expect: 'approved' },
    { name: '#3396/#3687', changedFiles: ['packages/crouton-cli/README.md'], ticketBody: 'docs', ticketLabels: ['app:docs', 'type:feat', 'work-this'], expect: 'not-approved' },
    { name: 'label for another package, no line', changedFiles: [CORE], ticketBody: 'x', ticketLabels: ['pkg:crouton-assets'], expect: 'partial' },
  ]
  for (const row of rows) {
    const r = packagesApprovalFor(row)
    const ci = evaluatePackagesGuard({ changedFiles: row.changedFiles, body: finishStepBody(1, r.prNote.trim()), linkedIssueLabels: row.ticketLabels })
    assert.equal(ci.declared, r.status !== 'not-approved', `${row.name}: notice ${r.status} vs CI declared=${ci.declared}`)
    if (row.expect) assert.equal(r.status, row.expect, row.name)
  }
  assert.equal(packagesApprovalFor(rows[5]).via, 'pkg-label')
  assert.equal(packagesApprovalFor(rows[6]).via, 'pkg-label')
})

const SCRIPT = fileURLToPath(new URL('./packages-guard.mjs', import.meta.url))
const runPrNote = (args, input) => spawnSync(process.execPath, [SCRIPT, '--pr-note', ...args], { input, encoding: 'utf8' })

test('#3701 CLI --pr-note: prints the line for an approved ticket, nothing otherwise, always exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pkg-note-'))
  const approved = join(dir, 'approved.txt'); writeFileSync(approved, `Body\n${LINE}\n`)
  const plain = join(dir, 'plain.txt'); writeFileSync(plain, 'Body without approval\n')
  const labels = join(dir, 'labels.json'); writeFileSync(labels, JSON.stringify(['type:fix']))
  const stdin = `${CORE}\napps/x.vue\n`

  const ok = runPrNote(['--body', approved, '--labels', labels], stdin)
  assert.equal(ok.status, 0)
  assert.equal(ok.stdout, `\n\n${LINE}`)

  const no = runPrNote(['--body', plain, '--labels', labels], stdin)
  assert.equal(no.status, 0)
  assert.equal(no.stdout, '')

  const missing = runPrNote(['--body', join(dir, 'nope.txt')], stdin)
  assert.equal(missing.status, 0)
  assert.equal(missing.stdout, '')
  assert.match(missing.stderr, /ignored/)

  const noLabelsFile = runPrNote(['--body', approved, '--labels', join(dir, 'absent.json')], stdin)
  assert.equal(noLabelsFile.status, 0)
  assert.equal(noLabelsFile.stdout, `\n\n${LINE}`)
})
