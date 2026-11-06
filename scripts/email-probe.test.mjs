/**
 * #3418 contract — the email-send probe.
 *
 *   node --test scripts/email-probe.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isEmailApp, probeMode, probeAddress, hasEmailKey, verdict } from './email-probe.mjs'

test('isEmailApp', () => {
  const velo = JSON.parse(readFileSync(new URL('../apps/velo/deploy.config.json', import.meta.url), 'utf8'))
  assert.equal(isEmailApp(velo), true)
  assert.equal(isEmailApp({ layerPackages: '@fyit/crouton-core' }), false)
  assert.equal(isEmailApp({}), false)
  assert.equal(isEmailApp({ layerPackages: '@fyit/crouton-core @fyit/crouton-email-extra' }), false)
})

test('probeMode', () => {
  assert.equal(probeMode({}), 'password-reset')
  assert.equal(probeMode({ emailProbe: 'magic-link' }), 'magic-link')
  assert.throws(() => probeMode({ emailProbe: 'carrier-pigeon' }))
})

test('probeAddress', () => {
  assert.equal(probeAddress('velo'), 'delivered+velo@resend.dev')
})

test('hasEmailKey', () => {
  assert.equal(hasEmailKey('[{"name":"NUXT_EMAIL_RESEND_API_KEY","type":"secret_text"}]'), true)
  assert.equal(hasEmailKey('[{"name":"RESEND_API_KEY"}]'), true)
  assert.equal(hasEmailKey('[{"name":"BETTER_AUTH_SECRET"}]'), false)
  assert.equal(hasEmailKey(''), false)
  assert.equal(hasEmailKey('not json'), false)
})

test('verdict', () => {
  const wrap = results => JSON.stringify([{ results, success: true }])
  assert.deepEqual(verdict(wrap([{ status: 'sent', error: null }])), { ok: true })
  assert.deepEqual(verdict(wrap([{ status: 'failed', error: 'boom' }])), { ok: false, reason: 'boom' })
  assert.deepEqual(verdict(wrap([{ status: 'pending', error: null }])), { ok: false, reason: 'never confirmed' })
  assert.deepEqual(verdict(wrap([])), { ok: false, reason: 'no send recorded' })
})

// Workflow-shape rules: protect against the "probe silently skipped" ordering bug.
const wf = readFileSync(new URL('../.github/workflows/deploy-app.yml', import.meta.url), 'utf8')
const names = [...wf.matchAll(/^ {6}- name: (.+)$/gm)].map(m => ({ name: m[1].trim(), idx: m.index }))
const at = n => {
  const hit = names.findIndex(s => s.name.startsWith(n))
  assert.ok(hit >= 0, `step "${n}" missing`)
  return hit
}

test('step order: detect → key → probe, after all secret steps; gate last', () => {
  const detect = at('Email app? (crouton-email)')
  const key = at('Ensure email key on the Worker')
  const probe = at('Probe email send')
  assert.ok(detect < key && key < probe)
  for (const before of ['Ensure BETTER_AUTH_SECRET', 'Push status-app secrets']) assert.ok(at(before) < detect)
  assert.equal(at('Gate on email probe'), names.length - 1)
  assert.ok(!names.some(s => s.name.startsWith('Probe status magic-link send')))
  assert.ok(!wf.slice(0, names[detect].idx).includes('steps.email-app'))
})

test('gate fires on anything but pass (a skipped probe goes red)', () => {
  const g = wf.slice(names[at('Gate on email probe')].idx)
  assert.ok(g.includes("steps.email-probe.outputs.result != 'pass'"))
  assert.ok(!g.includes("== 'fail'"))
})

// #3437 — production checks the email key BEFORE the deploy and never sends.
const wfText = readFileSync(new URL('../.github/workflows/deploy-app.yml', import.meta.url), 'utf8')
function stepBlock(name) {
  const start = wfText.indexOf(`- name: ${name}`)
  assert.notEqual(start, -1, `step not found: ${name}`)
  const next = wfText.indexOf('\n      - name:', start + 1)
  return wfText.slice(start, next === -1 ? undefined : next)
}

test('production: key check runs before deploy; staging steps and send stay non-production', () => {
  const check = 'Require email key for production (before deploy)'
  const deploy = 'Deploy (build'
  assert.ok(wfText.indexOf(`- name: ${check}`) < wfText.indexOf(`- name: ${deploy}`), 'check must precede deploy')
  const blk = stepBlock(check)
  assert.ok(blk.includes("inputs.environment == 'production'"))
  assert.ok(blk.includes('has-key') && blk.includes('exit 1'))
  assert.ok(!blk.includes('secret put NUXT') || !/\|\s*npx wrangler secret put/.test(blk), 'never pushes a key')
  assert.ok(stepBlock('Ensure email key on the Worker').includes("inputs.environment != 'production'"))
  assert.ok(stepBlock('Probe email send').includes("inputs.environment != 'production'"))
})

test('bundleHasEmailKey: key only in WORKER_SECRETS_JSON → deploy proceeds', async () => {
  const { bundleHasEmailKey, hasEmailKey } = await import('./email-probe.mjs')
  assert.equal(bundleHasEmailKey('{"NUXT_EMAIL_RESEND_API_KEY":"x"}'), true)
  assert.equal(bundleHasEmailKey('{"OTHER":"x"}'), false) // key nowhere (+ none on Worker) → stops
  assert.equal(bundleHasEmailKey(''), false)
  assert.equal(bundleHasEmailKey('[1]'), false)
  assert.equal(hasEmailKey('[{"name":"NUXT_EMAIL_RESEND_API_KEY"}]'), true) // Worker only → proceeds
  assert.equal(hasEmailKey('[]'), false)
})

test('production: pre-deploy accepts bundle or Worker, post-sync confirms Worker', () => {
  const pre = stepBlock('Require email key for production (before deploy)')
  assert.ok(pre.includes('bundle-has-key') && pre.includes('has-key') && pre.includes('WORKER_SECRETS_JSON') && pre.includes('exit 1'))
  const post = stepBlock('Confirm email key on the production Worker')
  assert.ok(post.includes("inputs.environment == 'production'") && post.includes('has-key') && post.includes('exit 1'))
  assert.ok(wfText.indexOf('- name: Sync explicit Worker secrets') < wfText.indexOf('- name: Confirm email key on the production Worker'))
})
