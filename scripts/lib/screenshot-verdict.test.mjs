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

test('T8 — preview-screenshot.yml reads both deploy runs and shoots only the picked apps (#3970)', () => {
  const yml = readFileSync(new URL('../../.github/workflows/preview-screenshot.yml', import.meta.url), 'utf8')
  const resolve = yml.slice(yml.indexOf('- name: Resolve target'), yml.indexOf('- name: Open check run'))
  // The deploy-run lookup runs for every event, not only inside the workflow_dispatch branch.
  const loop = resolve.indexOf('for wf in deploy-apps.yml deploy-pocs.yml')
  const branch = resolve.indexOf('if [ "$EVENT" = workflow_dispatch ]')
  assert.ok(loop >= 0 && branch >= 0 && loop < branch, 'deploy-run loop must sit outside the dispatch branch')
  assert.ok(resolve.includes('$RUN_ID $(deploy_runs "$HEAD_SHA")'), 'triggering run unioned with both deploy runs')
  // A "Pick apps to shoot" step runs the tested script before the capture.
  const pick = yml.indexOf('- name: Pick apps to shoot')
  const pickRun = yml.indexOf('node scripts/screenshot-targets.mjs')
  const capture = yml.indexOf('node scripts/capture-review-surfaces.mjs')
  assert.ok(pick >= 0 && pick < pickRun && pickRun < capture)
  assert.ok(yml.includes('id: pick'))
  // The capture loop reads the picked list, never every downloaded record.
  assert.ok(yml.includes('done < "$RUNNER_TEMP/targets.txt"'))
  assert.ok(!yml.includes('done < <(find "$RUNNER_TEMP/records" -name meta.json)'))
  // A failed pick (file list or PR body) fails the step: no `|| true` on its lines.
  const pickBlock = yml.slice(pick, yml.indexOf('- name: Capture + post'))
  assert.ok(!pickBlock.includes('|| true'))
  assert.ok(pickBlock.includes('pulls/$PR_NUMBER/files'))
  assert.ok(yml.includes('CAPTURE_NOTE: ${{ steps.pick.outputs.note }}'))
  assert.ok(yml.includes("steps.pick.outcome == 'failure'"))
})
