// Tests the "reviewer token is read-only" probe step of build-review.yml / plan-review.yml (#3057).
// The step runs under `bash -e`; it must decide on gh's exit code, not abort and not grep the body.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STEP = 'Probe — the reviewer token is read-only'

function probeScript(file) {
  const lines = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8').split('\n')
  const i = lines.findIndex(l => l.includes(`name: ${STEP}`))
  assert.ok(i >= 0, `probe step missing in ${file}`)
  const r = lines.findIndex((l, k) => k > i && /^\s+run: \|\s*$/.test(l))
  const out = []
  for (let k = r + 1; k < lines.length && (lines[k] === '' || /^ {10}/.test(lines[k])); k++) out.push(lines[k].slice(10))
  return out.join('\n').replaceAll('${{ github.repository }}', 'o/r')
}

function run(file, { code, stdout = '', stderr = '' }) {
  const dir = mkdtempSync(join(tmpdir(), 'probe-'))
  const gh = join(dir, 'gh')
  writeFileSync(gh, `#!/bin/sh\ncat >/dev/null\nprintf '%s' '${stdout}'\nprintf '%s\\n' '${stderr}' >&2\nexit ${code}\n`)
  chmodSync(gh, 0o755)
  return spawnSync('bash', ['-e', '-c', probeScript(file)], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PROBE_ISSUE: '1' },
  })
}

for (const file of ['build-review.yml', 'plan-review.yml']) {
  test(`${file}: exit 1 + HTTP 403 → expected, exit 0`, () => {
    const r = run(file, { code: 1, stderr: 'gh: Forbidden (HTTP 403)' })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /cannot write \(expected\)/)
  })
  test(`${file}: exit 1 + HTTP 404 → exit 0`, () => {
    assert.equal(run(file, { code: 1, stderr: 'gh: Not Found (HTTP 404)' }).status, 0)
  })
  test(`${file}: exit 1 + HTTP 401 → exit 0 (rule is the exit code)`, () => {
    assert.equal(run(file, { code: 1, stderr: 'gh: Bad credentials (HTTP 401)' }).status, 0)
  })
  test(`${file}: exit 0 with HTTP 403 in body → fails`, () => {
    const r = run(file, { code: 0, stdout: '{"message":"HTTP 403"}' })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /::error::/)
  })
  test(`${file}: exit 0, empty body → fails`, () => {
    assert.equal(run(file, { code: 0 }).status, 1)
  })
}
