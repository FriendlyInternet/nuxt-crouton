/**
 * #3441 contract — the production email-key check runs as tested code, not workflow bash.
 *
 *   node --test scripts/email-key-check.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { emailKeyDecision } from './email-key-check.mjs'

const BUNDLE_KEY = '{"NUXT_EMAIL_RESEND_API_KEY":"re_secret_value_123"}'
const WORKER_KEY = '[{"name":"NUXT_EMAIL_RESEND_API_KEY","type":"secret_text"}]'
const d = o => emailKeyDecision({ app: 'velo', isEmail: true, bundleJson: '', workerListJson: '[]', ...o })

test('T1 before: key only in WORKER_SECRETS_JSON → pass', () => {
  const r = d({ phase: 'before', bundleJson: BUNDLE_KEY, workerListJson: '[]' })
  assert.equal(r.result, 'pass')
  assert.match(r.message, /WORKER_SECRETS_JSON/)
})

test('T2 before: key only on the Worker → pass', () => {
  const r = d({ phase: 'before', bundleJson: '{"OTHER":"x"}', workerListJson: WORKER_KEY })
  assert.equal(r.result, 'pass')
  assert.match(r.message, /production Worker/)
})

test('T3 before: key nowhere → stop, names the app, no secret value', () => {
  const r = d({ phase: 'before', bundleJson: '{"OTHER":"s3cr3t-other"}', workerListJson: '[{"name":"BETTER_AUTH_SECRET"}]' })
  assert.equal(r.result, 'stop')
  assert.ok(r.message.includes('velo'))
  assert.ok(r.message.includes('Deploy stopped.'))
  assert.ok(!r.message.includes('s3cr3t-other'))
  assert.equal(d({ phase: 'before', bundleJson: '', workerListJson: '' }).result, 'stop')
})

test('T4 after: ignores the bundle — Worker missing → stop, Worker present → pass', () => {
  const miss = d({ phase: 'after', bundleJson: BUNDLE_KEY, workerListJson: '[]' })
  assert.equal(miss.result, 'stop')
  assert.ok(miss.message.includes('velo') && !miss.message.includes('re_secret_value_123'))
  assert.equal(d({ phase: 'after', bundleJson: '', workerListJson: WORKER_KEY }).result, 'pass')
})

test('T5 non-email app → skip in both phases, even with no key anywhere', () => {
  for (const phase of ['before', 'after']) {
    assert.equal(d({ phase, isEmail: false, bundleJson: '', workerListJson: '' }).result, 'skip')
  }
  assert.throws(() => d({ phase: 'sideways' }), /unknown phase/)
})

const CLI = new URL('./email-key-check.mjs', import.meta.url).pathname
function run(args, { stdin = '[]', secrets = '', email = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'email-key-check-'))
  const cfg = join(dir, 'deploy.config.json')
  writeFileSync(cfg, JSON.stringify({ layerPackages: email ? '@fyit/crouton-core @fyit/crouton-email' : '@fyit/crouton-core' }))
  return spawnSync(process.execPath, [CLI, ...args.map(a => (a === '<cfg>' ? cfg : a))], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, SECRETS_JSON: secrets, APP: 'velo' },
  })
}

test('T6 CLI: exit 0 on pass/skip, 1 with ::error:: on stop, 2 on bad phase', () => {
  const pass = run(['before', '<cfg>'], { secrets: BUNDLE_KEY })
  assert.equal(pass.status, 0)
  assert.match(pass.stdout, /^✓ /)
  assert.equal(run(['after', '<cfg>'], { stdin: WORKER_KEY }).status, 0)
  assert.equal(run(['before', '<cfg>'], { email: false, stdin: '' }).status, 0)
  const stop = run(['before', '<cfg>'], { stdin: '[]', secrets: '{}' })
  assert.equal(stop.status, 1)
  assert.match(stop.stdout, /::error::email key missing for PRODUCTION — velo/)
  const after = run(['after', '<cfg>'], { stdin: '[]', secrets: BUNDLE_KEY })
  assert.equal(after.status, 1)
  assert.match(after.stdout, /::error::/)
  assert.equal(run(['sideways', '<cfg>']).status, 2)
  assert.equal(run(['before']).status, 2)
})

const wf = readFileSync(new URL('../.github/workflows/deploy-app.yml', import.meta.url), 'utf8')
function stepBlock(name) {
  const start = wf.indexOf(`- name: ${name}`)
  assert.notEqual(start, -1, `step not found: ${name}`)
  const next = wf.indexOf('\n      - name:', start + 1)
  return wf.slice(start, next === -1 ? undefined : next)
}

test('T7 wiring: both production steps call the script, APP in env, no ${{ in run', () => {
  for (const [name, phase] of [['Require email key for production (before deploy)', 'before'], ['Confirm email key on the production Worker', 'after']]) {
    const blk = stepBlock(name)
    assert.ok(blk.includes("inputs.environment == 'production'"), `${name}: production only`)
    assert.ok(blk.includes(`email-key-check.mjs" ${phase} deploy.config.json`), `${name}: calls the check`)
    assert.match(blk, /\n {10}APP: \$\{\{ inputs\.app \}\}/, `${name}: APP in env`)
    const run = blk.slice(blk.indexOf('run: |'))
    assert.ok(!run.includes('${{'), `${name}: no expression inside run`)
    assert.ok(run.includes('| node "$GITHUB_WORKSPACE/scripts/email-key-check.mjs"'), `${name}: Worker list piped on stdin`)
  }
  assert.ok(stepBlock('Require email key for production (before deploy)').includes('SECRETS_JSON: ${{ secrets.WORKER_SECRETS_JSON }}'))
  assert.ok(!wf.includes('bundle-has-key'), 'orphaned bundle-has-key CLI no longer called')
})
