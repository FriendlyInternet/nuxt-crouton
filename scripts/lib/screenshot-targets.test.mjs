// "Preview screenshot" targets (#4535): which deploy runs, which apps, which check run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deployRunState, declaredApps, selectApps, pickCheckRun, decide } from './screenshot-targets.mjs'
import { screenshotVerdict } from './screenshot-verdict.mjs'

const cli = fileURLToPath(new URL('./screenshot-targets.mjs', import.meta.url))
const MARKER = 'Closes #4527\n<!-- review-surface: kassa /admin/test1/team/look-and-feel -->'
const RECORDS = ['kassa', 'gallery', 'snippets', 'pins']
const run = (workflow, id, status, conclusion = null, event = 'pull_request') => ({ workflow, id, status, conclusion, event })
const APPS = 'deploy-apps.yml'
const POCS = 'deploy-pocs.yml'

// covers: T1
test('T1 two finished deploy runs, review-surface kassa → [kassa], no wait, green on ok', () => {
  const d = decide({
    runs: [run(APPS, 10, 'completed', 'success'), run(POCS, 11, 'completed', 'success')],
    recordApps: RECORDS,
    prBody: MARKER,
    changedFiles: ['packages/crouton-themes/x.css'],
  })
  assert.equal(d.wait, false)
  assert.deepEqual(d.runIds, ['10', '11'])
  assert.deepEqual(d.apps, ['kassa'])
  assert.equal(d.missing, '')
  assert.equal(screenshotVerdict({ expected: 4, records: 4, result: 'ok', summary: 'posted 1 shot(s)' }).conclusion, 'success')
})

// covers: T2
test('T2 only the POC run finished → wait, never "declares no review-surface"', () => {
  const runs = [run(APPS, 20, 'in_progress'), run(APPS, 5, 'completed', 'success'), run(POCS, 21, 'completed', 'success')]
  const d = decide({ runs, recordApps: ['gallery', 'snippets', 'pins'], prBody: MARKER })
  assert.equal(d.wait, true)
  assert.doesNotMatch(JSON.stringify(d), /declares no review-surface/)
  const s = deployRunState(runs)
  assert.deepEqual(s.pending, [APPS])
  assert.deepEqual(s.runIds, ['21'], 'the in-progress newest Apps run is left out, older success ignored')
})

test('deployRunState ignores non-pull_request runs', () => {
  const s = deployRunState([run(APPS, 30, 'in_progress', null, 'push'), run(POCS, 31, 'completed', 'success')])
  assert.equal(s.wait, false)
  assert.deepEqual(s.runIds, ['31'])
})

// covers: T3
test('T3 no marker: own-folder changes narrow; packages-only or record-less apps keep every record app', () => {
  const five = ['kassa', 'gallery', 'snippets', 'pins', 'booking-demo', 'crouton-builder']
  assert.deepEqual(selectApps({ recordApps: five, changedFiles: ['packages/crouton-themes/x.css', 'apps/kassa/app/app.config.ts'] }),
    { apps: ['kassa'], missing: '' })
  assert.deepEqual(selectApps({ recordApps: five, changedFiles: ['packages/crouton-themes/x.css'] }), { apps: five, missing: '' })
  assert.deepEqual(selectApps({ recordApps: ['kassa', 'gallery'], changedFiles: ['pocs/notes/x.vue', 'packages/crouton-core/y.ts'] }),
    { apps: ['kassa', 'gallery'], missing: '' })
})

test('declaredApps reads the review-surface marker, not review-surface-none', () => {
  assert.deepEqual(declaredApps(`${MARKER}\n<!-- review-surface: kassa /x name:y -->\n<!-- review-surface: velo /a -->`), ['kassa', 'velo'])
  assert.deepEqual(declaredApps('<!-- review-surface-none: no screen -->'), [])
})

// covers: T4
test('T4 pickCheckRun returns the newest Preview screenshot id, or empty', () => {
  const list = [
    { id: 5, name: 'Preview screenshot' },
    { id: 9, name: 'Status' },
    { id: 7, name: 'Preview screenshot' },
    { id: 8, name: 'Preview screenshot (old)' },
  ]
  assert.equal(pickCheckRun(list), '7')
  assert.equal(pickCheckRun({ check_runs: list }), '7')
  assert.equal(pickCheckRun([]), '')
})

// Simulate two deploys finishing in a given order; each completion starts a capture.
function captures(order, finals, prBody) {
  const state = { [APPS]: run(APPS, 100, 'in_progress'), [POCS]: run(POCS, 101, 'in_progress') }
  const recordsOf = { [APPS]: ['kassa'], [POCS]: ['gallery', 'snippets', 'pins'] }
  const out = []
  for (const wf of order) {
    state[wf] = run(wf, state[wf].id, 'completed', finals[wf])
    const recordApps = Object.values(state)
      .filter(r => r.status === 'completed' && r.conclusion === 'success')
      .sort((a, b) => a.workflow.localeCompare(b.workflow))
      .flatMap(r => recordsOf[r.workflow])
    out.push(decide({ runs: Object.values(state), recordApps, prBody, changedFiles: ['packages/crouton-themes/x.css', 'apps/kassa/a.ts'] }))
  }
  return out
}

// covers: T6
test('T6 the final decision is the same whichever deploy finishes last', () => {
  const ok = { [APPS]: 'success', [POCS]: 'success' }
  for (const body of [MARKER, 'no marker here']) {
    const a = captures([POCS, APPS], ok, body)
    const b = captures([APPS, POCS], ok, body)
    assert.equal(a[0].wait, true)
    assert.equal(b[0].wait, true)
    assert.deepEqual(a.at(-1), b.at(-1))
    assert.deepEqual(a.at(-1).apps, ['kassa'])
    assert.equal(a.at(-1).wait, false)
  }
})

// covers: T7
test('T7 a started check always ends: after the last deploy, wait is false for every order × conclusion', () => {
  const ends = ['success', 'failure', 'cancelled']
  for (const order of [[POCS, APPS], [APPS, POCS]]) {
    for (const ca of ends) {
      for (const cp of ends) {
        const last = captures(order, { [APPS]: ca, [POCS]: cp }, MARKER).at(-1)
        assert.equal(last.wait, false, `${order.join('>')} apps=${ca} pocs=${cp}`)
      }
    }
  }
  const last = captures([POCS, APPS], { [APPS]: 'failure', [POCS]: 'success' }, MARKER).at(-1)
  assert.match(last.missing, /kassa/)
  assert.match(last.missing, /deploy-apps\.yml did not succeed/)
  assert.equal(screenshotVerdict({ records: 0, expected: 0, missing: last.missing }).conclusion, 'failure')
})

test('CLI runs / select / check print the workflow outputs', () => {
  const d = mkdtempSync(join(tmpdir(), 'st-'))
  const runsFile = join(d, 'runs.json')
  writeFileSync(runsFile, JSON.stringify([run(APPS, 1, 'completed', 'success'), run(POCS, 2, 'completed', 'failure')]))
  const r1 = spawnSync('node', [cli, 'runs', runsFile], { encoding: 'utf8' })
  assert.match(r1.stdout, /^run_ids=1$/m)
  assert.match(r1.stdout, /^failed=deploy-pocs\.yml$/m)
  assert.match(r1.stdout, /^wait=false$/m)

  const recs = join(d, 'records')
  for (const [id, app] of [['1', 'kassa'], ['2', 'gallery']]) {
    mkdirSync(join(recs, id, `preview-meta-${app}`), { recursive: true })
    writeFileSync(join(recs, id, `preview-meta-${app}`, 'meta.json'), JSON.stringify({ app }))
  }
  const out = join(d, 'selected.txt')
  const r2 = spawnSync('node', [cli, 'select', recs, '--out', out], { env: { ...process.env, PR_BODY: MARKER, CHANGED_FILES: '', FAILED: '' }, encoding: 'utf8' })
  assert.match(r2.stdout, /^count=1$/m)
  assert.match(r2.stdout, /^apps=kassa$/m)
  assert.match(r2.stdout, /^missing=$/m)
  assert.match(readFileSync(out, 'utf8'), /preview-meta-kassa\/meta\.json\n$/)

  const cf = join(d, 'checks.json')
  writeFileSync(cf, JSON.stringify({ check_runs: [{ id: 3, name: 'Preview screenshot' }] }))
  assert.match(spawnSync('node', [cli, 'check', cf], { encoding: 'utf8' }).stdout, /^id=3$/m)
})
