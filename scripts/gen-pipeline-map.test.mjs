// node --test scripts/gen-pipeline-map.test.mjs — the generated workflow map in
// docs/pipeline/how-it-works.md always matches the workflow files (#3730).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWorkflow, renderSection } from './gen-pipeline-map.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/gen-pipeline-map.mjs')
const cli = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })

const PAGE = '# Map\n\n<!-- pipeline-map:start -->\n<!-- pipeline-map:end -->\n'

// A temp dir with two workflows, a lines.json listing them, and a page generated from them.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-map-'))
  const wf = join(dir, 'workflows')
  mkdirSync(wf)
  writeFileSync(join(wf, 'a.yml'), 'name: Alpha\non: [push]\njobs:\n  x:\n    runs-on: ubuntu-latest\n')
  writeFileSync(join(wf, 'b.yml'), 'name: Beta\non:\n  issue_comment:\n    types: [created]\njobs: {}\n')
  writeFileSync(join(dir, 'lines.json'), JSON.stringify({ lines: { tickets: ['a.yml'], building: ['b.yml'] } }))
  writeFileSync(join(dir, 'page.md'), PAGE)
  const args = ['--workflows', wf, '--lines', join(dir, 'lines.json'), '--page', join(dir, 'page.md')]
  const gen = cli(args)
  assert.equal(gen.status, 0, gen.stderr)
  return { dir, wf, args }
}

test('committed page is up to date', () => {
  const r = cli(['--check'])
  assert.equal(r.status, 0, r.stderr)
})

test('an extra workflow fails --check and is named', () => {
  const { wf, args } = fixture()
  assert.equal(cli(['--check', ...args]).status, 0)
  writeFileSync(join(wf, 'extra.yml'), 'name: Extra\non:\n  push:\njobs: {}\n')
  const r = cli(['--check', ...args])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /extra\.yml/)
})

test('triggers per on: shape', () => {
  assert.deepEqual(parseWorkflow('name: A\non: [push]\njobs:').triggers, ['push'])
  assert.deepEqual(parseWorkflow('name: B\non:\n  issue_comment:\n    types: [created]\njobs:').triggers, ['issue_comment'])
  const c = parseWorkflow('name: C\non:\n  workflow_dispatch:\n    inputs:\n      pr:\n        type: string\n  push:\njobs:')
  assert.deepEqual(c, { name: 'C', triggers: ['workflow_dispatch', 'push'] })
  const md = renderSection({ scheduled: ['c.yml'] }, { 'c.yml': c })
  assert.ok(md.includes('`workflow_dispatch`, `push`'), md)
})

test('generated page shows the right triggers per row', () => {
  const { wf, dir, args } = fixture()
  writeFileSync(join(wf, 'c.yml'), 'name: Gamma\non:\n  workflow_dispatch:\n    inputs:\n      pr:\n        type: string\n        required: true\n  schedule:\n    - cron: "0 6 * * *"\njobs: {}\n')
  writeFileSync(join(dir, 'lines.json'), JSON.stringify({ lines: { tickets: ['a.yml'], building: ['b.yml', 'c.yml'] } }))
  assert.equal(cli(args).status, 0)
  const page = readFileSync(join(dir, 'page.md'), 'utf8')
  const row = f => page.split('\n').find(l => l.startsWith(`| [${f}]`))
  assert.match(row('a.yml'), /\| Alpha \| `push` \|$/)
  assert.match(row('b.yml'), /\| Beta \| `issue_comment` \|$/)
  assert.match(row('c.yml'), /\| Gamma \| `workflow_dispatch`, `schedule` \|$/)
  assert.doesNotMatch(page, /`inputs`|`pr`|`types`|`cron`/)
})

test('a stale page fails --check', () => {
  const { wf, dir, args } = fixture()
  writeFileSync(join(wf, 'a.yml'), 'name: Alpha renamed\non: [push]\njobs: {}\n')
  assert.equal(cli(['--check', ...args]).status, 1)
  assert.equal(cli(args).status, 0)
  assert.match(readFileSync(join(dir, 'page.md'), 'utf8'), /Alpha renamed/)
  assert.equal(cli(['--check', ...args]).status, 0)
})
