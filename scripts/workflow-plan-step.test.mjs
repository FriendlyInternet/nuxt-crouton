// The `plan` step of work-issue-pidev.yml run for real under `bash -e` (#3028).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const YML = readFileSync(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8').split('\n')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

function block(anchor, key, from = 0) {
  let i = YML.findIndex((l, n) => n >= from && l.includes(anchor))
  assert.ok(i >= 0, anchor)
  while (!new RegExp(`^\\s+${key}: \\|`).test(YML[i])) i++
  const indent = YML[i + 1].match(/^ */)[0].length
  const out = []
  for (i++; i < YML.length && (YML[i] === '' || YML[i].match(/^ */)[0].length >= indent); i++) out.push(YML[i].slice(indent))
  return out.join('\n')
}
const STEP = block('- id: plan', 'run').replaceAll('${{ github.repository }}', 'o/r')

const A_OK = '- The bug is in foo — Why: the stack trace ends there — Evidence: https://github.com/o/r/blob/abc/foo.ts#L10 — Status: verified'
const GOOD = '<!-- pipeline-plan:v1 -->\n' + Object.entries({
  Reproduced: 'yes — ran it', Cause: 'foo.ts:10', Fix: 'guard', Files: '- foo.ts', Test: 'foo.test.ts', Assumptions: A_OK, 'Needs owner': 'no — mechanical',
}).map(([k, v]) => `### ${k}\n${v}`).join('\n\n')

function run(fixture) {
  const dir = mkdtempSync(join(tmpdir(), 'pstep-'))
  const bin = join(dir, 'bin'); mkdirSync(bin)
  const log = join(dir, 'gh.log'); const out = join(dir, 'out.txt'); const tmp = join(dir, 'tmp'); mkdirSync(tmp)
  writeFileSync(join(dir, 'fixture.md'), fixture)
  writeFileSync(join(bin, 'gh'), `#!/bin/bash\nif [ "$1" = api ]; then cat "${dir}/fixture.md"; exit 0; fi\necho "$@" >> "${log}"\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  writeFileSync(join(dir, 'step.sh'), STEP)
  const r = spawnSync('bash', ['-e', join(dir, 'step.sh')], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: out, RUNNER_TEMP: tmp, ISSUE: '1', SINCE: '2020-01-01T00:00:00Z', REVISED: '', GH_TOKEN: 'x' },
  })
  return { status: r.status, log: existsSync(log) ? readFileSync(log, 'utf8') : '', outputs: existsSync(out) ? readFileSync(out, 'utf8') : '' }
}

test('malformed plan: one "malformed" comment, ok=0 + explained=1', () => {
  const r = run('<!-- pipeline-plan:v1 -->\n### Reproduced\nyes')
  assert.equal(r.status, 1)
  assert.equal((r.log.match(/^issue comment/gm) || []).length, 1)
  assert.match(r.log, /plan above is malformed/)
  assert.match(r.outputs, /ok=0/)
  assert.match(r.outputs, /explained=1/)
})

test('no plan comment: no issue comment, ok=0, no explained', () => {
  const r = run('')
  assert.equal(r.status, 1)
  assert.ok(!/issue comment/.test(r.log))
  assert.match(r.outputs, /ok=0/)
  assert.ok(!/explained/.test(r.outputs))
})

test('valid plan: ok=1, no malformed comment', () => {
  const r = run(GOOD)
  assert.equal(r.status, 0)
  assert.match(r.outputs, /ok=1/)
  assert.ok(!/malformed/.test(r.log))
})
