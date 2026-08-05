/**
 * #1894 contract — teardown must target the resources an app ACTUALLY has.
 *
 * The case that minted these: tearing down the retired `bookmark-stash` POC. The documented-safe
 * `--scope staging` resolved `bookmark-stash-staging`, which never existed — so the run reported
 * success and the live worker at `bookmark-stash.pmcp.dev` kept serving. The only path that
 * reached it was `--scope both` with a typed PROD confirmation, on a POC that was never
 * production. That trains an operator to type a prod confirm as routine, which is the whole
 * point of the guard gone.
 *
 * A POC deployed by `deploy-pocs.yml` has exactly ONE deploy, at the BASE name, carrying the
 * `<app>.pmcp.dev` route. There is no prod counterpart to protect.
 *
 *   node --test scripts/teardown-app.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectAppKind, resolveScope, plannedEnvs, needsProdGuard } from './teardown-app.mjs'

// ── detectAppKind ─────────────────────────────────────────────────────────────────
test('a live pocs/ directory identifies a POC', () => {
  assert.equal(detectAppKind({ app: 'quotes', hasPocDir: true }), 'poc')
})

test('a live apps/ directory identifies a launched app', () => {
  assert.equal(detectAppKind({ app: 'velo', hasAppDir: true }), 'app')
})

test('the poc: label identifies a POC after its directory is gone — the bookmark-stash case', () => {
  // Teardown usually runs AFTER the code PR closed, so the directory is the one signal
  // that has already disappeared. The label in .github/labels.yml outlives it.
  const labels = '- name: "poc:bookmark-stash"\n  color: "c5def5"\n- name: "app:velo"\n'
  assert.equal(detectAppKind({ app: 'bookmark-stash', labelsText: labels }), 'poc')
})

test('an app: label identifies a launched app after its directory is gone', () => {
  const labels = '- name: "app:velo"\n- name: "poc:quotes"\n'
  assert.equal(detectAppKind({ app: 'velo', labelsText: labels }), 'app')
})

test('a directory outranks a label (the label may be stale after promotion)', () => {
  const labels = '- name: "poc:velo"\n'
  assert.equal(detectAppKind({ app: 'velo', hasAppDir: true, labelsText: labels }), 'app')
})

test('no directory and no label is unknown — must not be guessed as either', () => {
  assert.equal(detectAppKind({ app: 'ghost' }), 'unknown')
})

// ── resolveScope: a POC's only deploy is at the BASE name ─────────────────────────
test('a POC resolves the BASE worker name, not <app>-staging — the #1894 bug', () => {
  const r = resolveScope('bookmark-stash', 'staging', null, 'poc')
  assert.equal(r.worker, 'bookmark-stash')
  assert.equal(r.d1, 'bookmark-stash-db')
  assert.equal(r.kvTitle, 'bookmark-stash-kv')
})

test('a POC reads its real names off the BASE wrangler block, not env.staging', () => {
  const config = {
    name: 'bookmark-stash',
    d1_databases: [{ binding: 'DB', database_name: 'bookmark-stash-db' }],
    env: { staging: { d1_databases: [{ database_name: 'bookmark-stash-staging-db' }] } },
  }
  assert.equal(resolveScope('bookmark-stash', 'staging', config, 'poc').d1, 'bookmark-stash-db')
})

test('a launched app keeps the existing staging/prod split', () => {
  assert.equal(resolveScope('velo', 'staging', null, 'app').worker, 'velo-staging')
  assert.equal(resolveScope('velo', 'prod', null, 'app').worker, 'velo')
})

test('an unknown kind keeps the conservative app split', () => {
  // Fail safe: treat an unidentifiable app like a launched one, so the prod guard still applies.
  assert.equal(resolveScope('ghost', 'staging', null, 'unknown').worker, 'ghost-staging')
})

// ── plannedEnvs / needsProdGuard ──────────────────────────────────────────────────
test('a POC has exactly one env whatever scope was asked for', () => {
  assert.deepEqual(plannedEnvs('poc', 'staging'), ['staging'])
  assert.deepEqual(plannedEnvs('poc', 'both'), ['staging'])
  assert.deepEqual(plannedEnvs('poc', 'prod'), ['staging'])
})

test('a launched app expands scopes as before', () => {
  assert.deepEqual(plannedEnvs('app', 'staging'), ['staging'])
  assert.deepEqual(plannedEnvs('app', 'prod'), ['prod'])
  assert.deepEqual(plannedEnvs('app', 'both'), ['staging', 'prod'])
})

test('a POC never trips the prod guard — it has no production to protect', () => {
  assert.equal(needsProdGuard('poc', 'both'), false)
  assert.equal(needsProdGuard('poc', 'prod'), false)
})

test('a launched app still trips the prod guard', () => {
  assert.equal(needsProdGuard('app', 'prod'), true)
  assert.equal(needsProdGuard('app', 'both'), true)
  assert.equal(needsProdGuard('app', 'staging'), false)
})

test('an UNKNOWN app still trips the prod guard — fail closed on the destructive path', () => {
  assert.equal(needsProdGuard('unknown', 'prod'), true)
  assert.equal(needsProdGuard('unknown', 'both'), true)
})
