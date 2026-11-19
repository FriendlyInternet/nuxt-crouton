/**
 * #4161 T5 — the pi session record is redacted before it is uploaded as a public artifact.
 *
 *   node --test scripts/pi-session-redact.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./pi-session-redact.mjs', import.meta.url))
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'redact-'))

const FOO = 'foo-secret-value-1234'
const GHS = 'ghs_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'
const PAT = 'github_pat_' + '11ABCDEFG0123456789_abcdefghijklmnop'
const OAT = 'sk-ant-oat01-' + 'abcDEF123_-xyzXYZ789abcDEF123'
const BASIC = 'AUTHORIZATION: basic ' + 'eC1hY2Nlc3MtdG9rZW46Z2hzX0FCQ0RFRg=='
const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabc==\n-----END RSA PRIVATE KEY-----'

function run(src, out, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, src, out], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REDACT_VARS: 'FOO,SHORT,UNSET', FOO, SHORT: 'abc', ...env },
  })
}

test('T5: env values and token shapes are redacted; nested paths kept; other text byte-identical', () => {
  const src = tmp()
  const out = path.join(tmp(), 'pi-session-out')
  fs.mkdirSync(path.join(src, 'subagent-artifacts', 'deep'), { recursive: true })
  const line = (t) => JSON.stringify({ type: 'toolResult', message: { content: [{ type: 'text', text: t }] } })
  fs.writeFileSync(path.join(src, 's.jsonl'), [
    line(`env FOO=${FOO} done`),
    line(`token ${GHS} and ${PAT}`),
    line(`claude ${OAT}`),
    line(`[http "https://github.com/"]\n\textraheader = ${BASIC}`),
    line(PEM),
    line('plain abc text stays'),
    '',
  ].join('\n'))
  const plain = 'nothing secret here, abc, ghs_short\n'
  fs.writeFileSync(path.join(src, 'subagent-artifacts', 'deep', 'n.jsonl'), plain)

  const r = run(src, out)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /redacted 6 value\(s\) in 1 file\(s\)/)

  const got = fs.readFileSync(path.join(out, 's.jsonl'), 'utf8')
  for (const secret of [FOO, GHS, PAT, OAT, 'eC1hY2Nlc3MtdG9rZW46Z2hzX0FCQ0RFRg==', 'MIIEowIBAAKCAQEA']) {
    assert.ok(!got.includes(secret), `leaked: ${secret}`)
  }
  assert.match(got, /env FOO=\[REDACTED:FOO\] done/)
  assert.match(got, /token \[REDACTED\] and \[REDACTED\]/)
  assert.match(got, /claude \[REDACTED\]/)
  assert.ok(got.includes('extraheader = [REDACTED]'))
  assert.ok(got.includes('plain abc text stays'), 'a short REDACT_VARS value (<8 chars) is ignored')
  // Untouched file is byte-identical, at the same nested path.
  assert.equal(fs.readFileSync(path.join(out, 'subagent-artifacts', 'deep', 'n.jsonl'), 'utf8'), plain)
})

// Reads the workflow as text (no YAML dependency — the root workspace does not list one, and the
// other workflow-wiring tests read the file the same way): the job is cut out by its top-level
// key, then split into steps at each `      - ` list item.
function workerJob() {
  const wf = fs.readFileSync(fileURLToPath(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url)), 'utf8')
  const jobs = wf.slice(wf.indexOf('\njobs:\n')).split(/\n(?=  [A-Za-z0-9_-]+:\n)/)
  const text = jobs.find((j) => /\n      - id: baseline\n/.test(j))
  const steps = text.split(/\n(?=      - )/).slice(1)
  return { timeout: Number(/\n    timeout-minutes: (\d+)/.exec(text)[1]), steps }
}
const field = (step, key) => (new RegExp(`^ {6}(?:- |  )${key}: (.+)$`, 'm').exec(step) || [])[1]
const nested = (step, key) => (new RegExp(`^ {10}${key}: (.+?)(?: +#.*)?$`, 'm').exec(step) || [])[1]

test('wiring: the worker redacts then uploads the record on every outcome, and the gate gets the job status', () => {
  const { timeout, steps } = workerJob()
  const idx = (pred) => steps.findIndex(pred)
  const baseline = steps.find((s) => field(s, 'id') === 'baseline')
  assert.match(baseline, /cp scripts\/pi-session-redact\.mjs "\$RUNNER_TEMP\/pi-session-redact\.mjs"/)
  assert.match(baseline, /SCRATCH='[^']*\|pi-session-out'/)
  const ri = idx((s) => field(s, 'name') === 'Redact pi session record')
  const ui = idx((s) => field(s, 'name') === 'Upload pi session record')
  const gi = idx((s) => /^Artifact-gate/.test(field(s, 'name') || ''))
  assert.ok(ri > idx((s) => field(s, 'id') === 'pi') && ri < ui, 'redact runs after pi and before the upload')
  assert.ok(gi > ui, 'the artifact gate runs after the upload')
  assert.equal(field(steps[ri], 'if'), 'always()')
  assert.equal(field(steps[ui], 'if'), 'always()')
  assert.match(field(steps[ri], 'run'), /pi-session-redact\.mjs" "\$RUNNER_TEMP\/pi-session" pi-session-out/)
  for (const v of nested(steps[ri], 'REDACT_VARS').split(',')) assert.ok(nested(steps[ri], v), `REDACT_VARS names ${v} but the step does not set it`)
  assert.equal(nested(steps[ui], 'path'), 'pi-session-out/')
  assert.equal(nested(steps[ui], 'name'), 'pi-session-${{ github.run_id }}')
  assert.equal(Number(nested(steps[ui], 'retention-days')), 3)
  assert.equal(nested(steps[gi], 'JOB_STATUS'), '${{ job.status }}')
  assert.equal(Number(nested(steps[gi], 'JOB_TIMEOUT_MIN').replace(/'/g, '')), timeout, 'JOB_TIMEOUT_MIN must equal the job time limit')
})

test('T5: a missing src exits 0 and writes nothing', () => {
  const out = path.join(tmp(), 'pi-session-out')
  const r = run(path.join(tmp(), 'absent'), out)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /redacted 0 value\(s\) in 0 file\(s\)/)
  assert.equal(fs.existsSync(out), false)
})
