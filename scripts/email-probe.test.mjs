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
