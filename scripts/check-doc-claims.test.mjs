import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-doc-claims.mjs')
const run = (md, ...flags) => {
  const dir = mkdtempSync(join(tmpdir(), 'docclaims-'))
  writeFileSync(join(dir, 'page.md'), md)
  return spawnSync('node', [script, ...flags, dir], { encoding: 'utf8' })
}

test('unknown CLI command is reported with page and line, strict exits 1', () => {
  const r = run('# T\n\nRun `npx crouton frobnicate` now\n', '--strict')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /page\.md:3 .*crouton frobnicate/)
})

test('real CLI command passes', () => {
  const r = run('Run `npx crouton config` now\n', '--strict')
  assert.equal(r.status, 0, r.stdout)
})

test('schema block with unknown field type is reported', () => {
  const r = run('x\n\n```json\n{ "title": { "type": "nonsense" } }\n```\n', '--strict')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /unknown type "nonsense"/)
})

test('valid schema block passes; skip marker is honoured', () => {
  assert.equal(run('```json\n{ "title": { "type": "string" } }\n```\n', '--strict').status, 0)
  assert.equal(run('<!-- doc-check: skip -->\n```json\n{ "t": { "type": "nonsense" } }\n```\n', '--strict').status, 0)
})

// The Node-checks CI job installs no deps, so `typescript` may be absent there; the script
// then reports the code check as NOT RUN (visible in its output). Skip with that reason.
const hasTs = (() => { try { createRequire(import.meta.url)('typescript'); return true } catch { return false } })()

test('ts block with a syntax error is reported; fragments are skipped', { skip: hasTs ? false : 'typescript not installed in this job' }, () => {
  assert.equal(run('```ts\nconst = ;\n```\n', '--strict').status, 1)
  assert.equal(run('```ts\nconst = ...\n```\n', '--strict').status, 0)
})

test('report-only by default (exit 0 with findings)', () => {
  assert.equal(run('`npx crouton frobnicate`\n').status, 0)
})

test('missing component / composable is reported with page and line; real ones pass', () => {
  const r = run('# T\n\nUse <CroutonDoesNotExistXyz /> here\n', '--strict')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /page\.md:3 .*CroutonDoesNotExistXyz/)
  assert.equal(run('Call useCroutonNopeXyz() now\n', '--strict').status, 1)
  assert.equal(run('Call useCrouton() or <CroutonFormLayout /> now\n', '--strict').status, 0)
})
