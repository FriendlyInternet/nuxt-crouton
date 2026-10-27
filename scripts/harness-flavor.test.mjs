/**
 * #2884 contract — the flavor file answers every stack row with crouton's current
 * answers, the resolver prints them, and the values match the code they were lifted from.
 *
 *   node --test scripts/harness-flavor.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadFlavor, getKey, validate, render, REQUIRED_KEYS } from './harness-flavor.mjs'
import { planTestsGate } from './pi-finish.mjs'
import { DENY } from './pi-edited-files.mjs'

const CLI = fileURLToPath(new URL('./harness-flavor.mjs', import.meta.url))
const flavor = await loadFlavor()
const cli = (...a) => execFileSync('node', [CLI, ...a], { encoding: 'utf8' }).trimEnd()

test('the shipped crouton profile is valid and answers every row', () => {
  assert.deepEqual(validate(flavor), [])
  for (const k of REQUIRED_KEYS) assert.ok(k in flavor, k)
})

test('CLI prints the crouton answers verbatim', () => {
  assert.equal(cli('install'), 'pnpm install --frozen-lockfile')
  assert.equal(cli('typecheck.all'), 'pnpm typecheck')
  assert.equal(cli('warm.command'), 'pnpm build:packages')
  assert.equal(cli('bot.name'), 'nuxt-harness[bot]')
  assert.equal(cli('deploy.hosts.staging'), '{app}.pmcp.dev')
  assert.deepEqual(JSON.parse(cli('bot')), flavor.bot)
  for (const k of REQUIRED_KEYS) assert.ok(cli(k).length > 0, k)
})

test('unknown key exits 1 instead of silently printing nothing', () => {
  const r = spawnSync('node', [CLI, 'nope'], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /unknown flavor key/)
})

test('getKey walks dotted paths and returns undefined for misses', () => {
  assert.equal(getKey(flavor, 'bot.email'), 'nuxt-harness[bot]@users.noreply.github.com')
  assert.equal(getKey(flavor, 'bot.nope.deeper'), undefined)
  assert.equal(render('x'), 'x')
  assert.equal(render({ a: 1 }), '{\n  "a": 1\n}')
})

test('testsGate patterns agree with planTestsGate (#1885)', () => {
  const logic = new RegExp(flavor.testsGate.logicPaths)
  const test_ = new RegExp(flavor.testsGate.testPaths)
  const files = [
    'packages/a/src/x.ts', 'packages/a/test/x.test.ts', 'packages/a/i18n/locales/en.json',
    'packages/a/app/C.vue', 'apps/b/x.ts', 'packages/a/lib/y.spec.js'
  ]
  const { pkgLogic, testFiles } = planTestsGate({ committedFiles: files })
  assert.deepEqual(files.filter((f) => logic.test(f) && !test_.test(f)), pkgLogic)
  assert.deepEqual(files.filter((f) => test_.test(f)), testFiles)
})

test('generated.junk is the same denylist the commit planner uses', () => {
  assert.equal(new RegExp(flavor.generated.junk).source, DENY.source)
})

test('validate flags a broken profile', () => {
  assert.ok(validate({}).length > 0)
  assert.ok(validate({ ...flavor, bot: {} }).some((p) => /bot/.test(p)))
  assert.ok(validate({ ...flavor, reviewGates: { x: { paths: [] } } }).length >= 2)
})
