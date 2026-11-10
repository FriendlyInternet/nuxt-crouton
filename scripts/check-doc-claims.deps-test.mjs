// Needs `typescript` + `vue-component-meta` (via scripts/gen-api-reference.mjs), so it runs in the
// "Build packages" job that installs packages, not in the bare-Node set.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'check-doc-claims.mjs')
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

test('unknown CLI flag is reported; real flags, aliases and --no-<boolean> pass', () => {
  const bad = run('```bash\nnpx crouton rollback shop products --bogus-flag\n```\n', '--strict')
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /page\.md:2 .*`crouton rollback` has no flag `--bogus-flag`/)
  const good = run('```bash\nnpx crouton rollback shop products --dry-run --keep-files\nnpx crouton generate shop products -f x.json --no-db --no-hierarchy --help\n```\n', '--strict')
  assert.equal(good.status, 0, good.stdout)
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

test('field type aliases from the manifests pass', () => {
  assert.equal(run('```json\n{ "n": { "type": "integer" }, "d": { "type": "datetime" } }\n```\n', '--strict').status, 0)
})

test('ts block with a syntax error is reported; fragments are skipped', () => {
  assert.equal(run('```ts\nconst = ;\n```\n', '--strict').status, 1)
  assert.equal(run('```ts\nconst = ...\n```\n', '--strict').status, 0)
})

test('could not run is a failure: without typescript installed the checker exits non-zero', () => {
  // A copy of the scripts outside the repo cannot resolve `typescript` — exactly the bare-job shape.
  const dir = join(mkdtempSync(join(tmpdir(), 'docclaims-nodeps-')), 'scripts')
  mkdirSync(dir)
  for (const f of ['check-doc-claims.mjs', 'gen-api-reference.mjs']) copyFileSync(join(here, f), join(dir, f))
  const docs = mkdtempSync(join(tmpdir(), 'docclaims-'))
  writeFileSync(join(docs, 'page.md'), '# nothing wrong here\n')
  const r = spawnSync('node', [join(dir, 'check-doc-claims.mjs'), docs], { encoding: 'utf8' })
  assert.notEqual(r.status, 0, r.stdout)
  assert.doesNotMatch(r.stdout, /Total: 0/)
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

test('unknown prop on a crouton-core component is reported; real props, events, slots and class pass', () => {
  const bad = run('```vue\n<CroutonConfirmButton\n  :confirm-text="x"\n/>\n```\n', '--strict')
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /page\.md:3 .*<CroutonConfirmButton>` has no prop `confirmText`/)
  const good = run('```vue\n<CroutonConfirmButton :confirm-label="x" class="a" @confirm="go" <!-- note --> />\n```\n', '--strict')
  assert.equal(good.status, 0, good.stdout)
})
