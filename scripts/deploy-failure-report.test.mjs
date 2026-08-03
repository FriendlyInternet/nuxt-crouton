/**
 * Contract for scripts/deploy-failure-report.mjs (#1639). Proves the watchdog decision:
 *   • classifies the real #1548 (D1 7429) / #1535 (fetch failed) logs as transient, and the
 *     #1620 (NOT NULL constraint) log as a real failure (hard signature wins),
 *   • dedups: an existing rolling ticket → comment (or skip an already-recorded run), else create,
 *   • transient → no @-ping + `transient-infra` label; and
 *   • a workflow_dispatch run caveats its commit attribution (the #1617 misattribution).
 *
 *   node --test scripts/deploy-failure-report.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyLogs, slugFromPath, decideReport, runMarker, keyMarker } from './deploy-failure-report.mjs'

const runBase = {
  id: 999, name: 'Deploy Apps (Cloudflare Workers)', event: 'push', path: '.github/workflows/deploy-apps.yml',
  head_sha: 'abcdef1234567890', head_commit: { message: 'fix(x): thing\n\nbody' },
  html_url: 'https://github.com/O/R/actions/runs/999', head_branch: 'main', repoFullName: 'O/R'
}

// ── classifyLogs (against the real failure signatures) ────────────────────────
test('#1548 D1-overload log → transient', () => {
  const log = '✘ [ERROR] A request to the Cloudflare API (…/d1/…/query) failed.\n  D1 DB is overloaded. Requests queued for too long. [code: 7429]'
  assert.equal(classifyLogs(log).transient, true)
})

test('#1535 fetch-failed log → transient', () => {
  const log = '▲ [WARNING] A fetch request failed, likely due to a connectivity issue.\n✘ [ERROR] fetch failed'
  assert.equal(classifyLogs(log).transient, true)
})

test('#1620 NOT NULL constraint log → NOT transient (real failure)', () => {
  const log = '✘ [ERROR] NOT NULL constraint failed: __new_sales_printers.locationId: SQLITE_CONSTRAINT'
  assert.equal(classifyLogs(log).transient, false)
})

test('a hard signature wins even when a transient one is also present', () => {
  const log = 'A fetch request failed, likely due to a connectivity issue.\n… error TS2345: Type error: nope'
  assert.equal(classifyLogs(log).transient, false)
})

test('an unrecognised failure is treated as real (not silently transient)', () => {
  assert.equal(classifyLogs('some brand new error nobody has seen').transient, false)
})

// ── slugFromPath ──────────────────────────────────────────────────────────────
test('generic deploy-apps/pocs workflows carry no slug; a per-app one does', () => {
  assert.equal(slugFromPath('.github/workflows/deploy-apps.yml'), null)
  assert.equal(slugFromPath('.github/workflows/deploy-pocs.yml'), null)
  assert.equal(slugFromPath('.github/workflows/deploy-velo.yml'), 'velo')
})

// ── decideReport: dedup ───────────────────────────────────────────────────────
test('no existing ticket → create (with the rolling key marker)', () => {
  const d = decideReport({ run: runBase, classification: { transient: false, reason: null } })
  assert.equal(d.action, 'create')
  assert.match(d.body, new RegExp(keyMarker('Deploy Apps (Cloudflare Workers)', null).replace(/[()|]/g, '\\$&')))
  assert.match(d.body, new RegExp(runMarker(999)))
})

test('an existing rolling ticket → comment the new occurrence (not a new issue)', () => {
  const d = decideReport({ run: runBase, classification: { transient: false, reason: null }, existing: { number: 42, text: 'prior body with other run' } })
  assert.equal(d.action, 'comment')
  assert.equal(d.issueNumber, 42)
  assert.match(d.body, new RegExp(runMarker(999)))
})

test('an already-recorded run id on the ticket → skip (no duplicate occurrence)', () => {
  const existing = { number: 42, text: `body… ${runMarker(999)} …` }
  const d = decideReport({ run: runBase, classification: { transient: false, reason: null }, existing })
  assert.equal(d.action, 'skip')
})

// ── decideReport: transient handling ──────────────────────────────────────────
test('transient failure → no ping + transient-infra label', () => {
  const d = decideReport({ run: runBase, classification: { transient: true, reason: 'x' } })
  assert.equal(d.action, 'create')
  assert.equal(d.ping, false)
  assert.ok(d.labels.includes('transient-infra'))
  assert.match(d.body, /likely transient/i)
})

test('real failure → ping + no transient-infra label', () => {
  const d = decideReport({ run: runBase, classification: { transient: false, reason: null }, appLabel: 'app:fanfare' })
  assert.equal(d.ping, true)
  assert.ok(!d.labels.includes('transient-infra'))
  assert.ok(d.labels.includes('app:fanfare'))
  assert.match(d.body, /@pmcp/)
})

// ── decideReport: honest attribution ──────────────────────────────────────────
test('a push run states the commit plainly', () => {
  const d = decideReport({ run: { ...runBase, event: 'push' }, classification: { transient: false, reason: null } })
  assert.doesNotMatch(d.body, /not necessarily the cause/)
})

test('a workflow_dispatch run caveats the attribution (the #1617 trap)', () => {
  const d = decideReport({ run: { ...runBase, event: 'workflow_dispatch' }, classification: { transient: false, reason: null } })
  assert.match(d.body, /not necessarily the cause/)
})
