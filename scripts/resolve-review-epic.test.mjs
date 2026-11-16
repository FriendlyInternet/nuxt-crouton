import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chooseReviewTarget } from './resolve-review-epic.mjs'

const epics = [
  { number: 40, labels: ['epic', 'poc:status'] },
  { number: 30, labels: ['epic', 'app:velo'] },
  { number: 20, labels: ['epic', 'app:velo'] }
]

test('explicit review-pr wins', () => {
  assert.deepEqual(chooseReviewTarget({ app: 'velo', reviewPr: '7', epics }), { number: '7', source: 'review-pr' })
})
test('picks the app\'s to-test epic (lowest number)', () => {
  assert.equal(chooseReviewTarget({ app: 'velo', epics }).number, '20')
  assert.equal(chooseReviewTarget({ app: 'status', epics }).number, '40')
})
test('no epic for the app → empty (overlay off)', () => {
  assert.deepEqual(chooseReviewTarget({ app: 'kassa', epics }), { number: '', source: 'none' })
  assert.equal(chooseReviewTarget({ app: 'velo', epics: [] }).number, '')
})

// Real entry point: the workflow must gate the overlay on the resolved target, not on the raw input.
test('deploy-app.yml enables the overlay from the resolved target', () => {
  const wf = readFileSync(new URL('../.github/workflows/deploy-app.yml', import.meta.url), 'utf8')
  assert.match(wf, /id: review-target/)
  assert.match(wf, /NUXT_PUBLIC_CROUTON_REVIEW: \$\{\{ \(inputs\.environment == 'staging' && steps\.review-target\.outputs\.number != ''\)/)
  assert.doesNotMatch(wf, /NUXT_PUBLIC_CROUTON_REVIEW: \$\{\{[^}]*review-pr/)
})

// The lookup runs with the workflow token: every job that reaches deploy-app.yml must grant issues: read,
// or the epic lookup 403s and main silently gets no overlay.
test('deploy callers and deploy-app grant issues: read', () => {
  for (const f of ['deploy-app.yml', 'deploy-apps.yml', 'deploy-pocs.yml']) {
    const wf = readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8')
    assert.match(wf, /^\s+issues: read\b/m, f)
  }
})

// Real CLI entry point (what the workflow step runs) with a fake `gh` on PATH.
function runCli(args, ghJson, { fail = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fakegh-'))
  const gh = join(dir, 'gh')
  writeFileSync(gh, fail ? '#!/bin/sh\necho denied >&2\nexit 1\n' : `#!/bin/sh\necho '${ghJson}'\n`)
  chmodSync(gh, 0o755)
  return spawnSync('node', [fileURLToPath(new URL('./resolve-review-epic.mjs', import.meta.url)), ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }
  })
}
const listJson = JSON.stringify([
  { number: 30, labels: [{ name: 'epic' }, { name: 'app:velo' }] },
  { number: 20, labels: [{ name: 'epic' }, { name: 'app:velo' }] }
])
test('CLI: main deploy (no review-pr) resolves the app\'s to-test epic via gh', () => {
  assert.equal(runCli(['velo'], listJson).stdout.trim(), '20')
})
test('CLI: no epic for the app → prints nothing (overlay off)', () => {
  assert.equal(runCli(['kassa'], listJson).stdout.trim(), '')
})
test('CLI: gh failure → nothing printed and a visible ::warning::', () => {
  const r = runCli(['velo'], '', { fail: true })
  assert.equal(r.stdout.trim(), '')
  assert.match(r.stderr, /::warning::/)
})
