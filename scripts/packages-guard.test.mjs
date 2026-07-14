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
  APPROVED_LABEL,
  COMMENT_MARKER,
} from './packages-guard.mjs'

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
