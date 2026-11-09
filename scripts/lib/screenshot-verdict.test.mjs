import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RECORD_STEP_NAME, countExpectedRecords, screenshotVerdict } from './screenshot-verdict.mjs'

const job = (name, deploy, record) => ({
  name,
  steps: [
    { name: 'Deploy', conclusion: deploy },
    { name: RECORD_STEP_NAME, conclusion: record },
    { name: 'Upload preview record', conclusion: 'skipped' },
  ],
})

test('deploy ok + capture ok → success', () => {
  const v = screenshotVerdict({ expected: 1, records: 1, result: 'ok', summary: 'posted 1 shot(s): a.png' })
  assert.equal(v.conclusion, 'success')
  assert.equal(v.summary, 'posted 1 shot(s): a.png')
})

test('deploy ok + no record → failure', () => {
  const v = screenshotVerdict({ expected: 1, records: 0, result: '' })
  assert.equal(v.conclusion, 'failure')
  assert.match(v.summary, /^preview deployed, but no screenshot captured/)
})

test('deploy ok + capture failed → failure', () => {
  const v = screenshotVerdict({ expected: 1, records: 1, result: 'miss', summary: 'no usable shot — x' })
  assert.equal(v.conclusion, 'failure')
  assert.match(v.summary, /no usable shot — x/)
})

test('deploy ok + capture did not finish → failure', () => {
  const v = screenshotVerdict({ expected: 1, records: 1, result: '' })
  assert.equal(v.conclusion, 'failure')
  assert.match(v.summary, /capture step did not finish/)
})

test('no deploy for the head → neutral', () => {
  assert.equal(screenshotVerdict({ expected: 0, records: 0, result: '' }).conclusion, 'neutral')
})

test('jobs lookup failed → failure', () => {
  const v = screenshotVerdict({ expected: undefined, records: 0, result: '' })
  assert.equal(v.conclusion, 'failure')
  assert.match(v.summary, /could not read the deploy run's jobs/)
})

test('countExpectedRecords counts only record steps that ran', () => {
  const jobs = [
    job('gallery', 'success', 'success'),
    job('status', 'success', 'success'),
    job('loop-station', 'success', 'skipped'),
    { name: 'other', steps: [{ name: 'Deploy', conclusion: 'success' }] },
  ]
  assert.equal(countExpectedRecords(jobs), 2)
  assert.equal(countExpectedRecords([job('a', 'success', 'failure')]), 1)
  assert.equal(countExpectedRecords([]), 0)
})

test('no-login app only → neutral (both functions)', () => {
  const expected = countExpectedRecords([job('loop-station', 'success', 'skipped')])
  assert.equal(expected, 0)
  assert.equal(screenshotVerdict({ expected, records: 0, result: '' }).conclusion, 'neutral')
})

const deploy = readFileSync(new URL('../../.github/workflows/deploy-app.yml', import.meta.url), 'utf8')

test('deploy-app.yml still names the record step the verdict matches on', () => {
  assert.ok(deploy.includes(`- name: ${RECORD_STEP_NAME}`))
})

test('upload step is gated on the record step output, not hashFiles', () => {
  const i = deploy.indexOf('- name: Upload preview record')
  const block = deploy.slice(i, deploy.indexOf('uses:', i))
  assert.ok(!block.includes('hashFiles('))
  assert.ok(block.includes('steps.preview_record.outputs.recorded'))
})

import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cli = fileURLToPath(new URL('./screenshot-verdict.mjs', import.meta.url))
import { fileURLToPath } from 'node:url'

test('CLI verdict with empty EXPECTED (jobs lookup failed) → failure', () => {
  const r = spawnSync('node', [cli, 'verdict'], { env: { ...process.env, EXPECTED: '', RECORDS: '0', RESULT: '', SUMMARY: '' }, encoding: 'utf8' })
  assert.match(r.stdout, /conclusion=failure/)
})

test('CLI count reads a jobs file like the workflow does', () => {
  const d = mkdtempSync(join(tmpdir(), 'sv-'))
  const f = join(d, 'jobs-1.json')
  writeFileSync(f, JSON.stringify([job('a', 'success', 'success')]))
  const r = spawnSync('node', [cli, 'count', f], { encoding: 'utf8' })
  assert.equal(r.stdout.trim(), '1')
})

test('preview-screenshot.yml does not pipe gh api into jq for the jobs lookup', () => {
  const w = readFileSync(new URL('../../.github/workflows/preview-screenshot.yml', import.meta.url), 'utf8')
  assert.ok(!/gh api[^\n]*\|\s*jq -s/.test(w))
})

test('preview-screenshot.yml installs repo Playwright before the capture (#3593)', () => {
  const yml = readFileSync(new URL('../../.github/workflows/preview-screenshot.yml', import.meta.url), 'utf8')
  const install = yml.indexOf('pnpm install --frozen-lockfile --ignore-scripts --filter nuxt-crouton-workspace')
  const capture = yml.indexOf('node scripts/capture-review-surfaces.mjs')
  assert.ok(install >= 0 && capture >= 0 && install < capture)
  assert.ok(yml.includes('pnpm exec playwright install chromium'))
  assert.ok(!yml.includes('npx --yes playwright'))
  assert.ok(!yml.split('\n').some(l => l.includes('playwright install') && /\|\|\s*true\s*$/.test(l)))
  assert.ok(!/playwright install[^\n]*--with-deps/.test(yml))
})
