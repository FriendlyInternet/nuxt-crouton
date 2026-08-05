/**
 * #1965 contract — a gate's rule is run over every file it would judge BEFORE the gate merges,
 * and the run cannot report "clean" without having actually looked at something.
 *
 *   node --test scripts/corpus-check.test.mjs
 *
 * The last two cases are themselves corpus runs against the REAL repo (the #1933 pattern:
 * assert against the actual tree, not a fixture), replaying the #1957 near-miss.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globToRegExp, findFiles, readCorpusFile, runCorpus, formatReport } from './corpus-check.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('globToRegExp anchors and respects directory boundaries', () => {
  assert.ok(globToRegExp('apps/*/schemas/*.json').test('apps/velo/schemas/booking.json'))
  // `*` must not cross a `/` — otherwise a one-level glob silently sweeps the whole tree
  assert.equal(globToRegExp('apps/*/schemas/*.json').test('apps/velo/a/schemas/b.json'), false)
  assert.equal(globToRegExp('*.json').test('apps/velo/package.json'), false)
  assert.ok(globToRegExp('**/*.json').test('apps/velo/package.json'))
  assert.ok(globToRegExp('scripts/**/*.mjs').test('scripts/lib/excalidraw.mjs'))
  assert.ok(globToRegExp('scripts/**/*.mjs').test('scripts/corpus-check.mjs'), '`**/` must also match zero directories')
})

test('runCorpus separates accepts, rejects and rules that throw', () => {
  const files = [
    { path: 'a.json', json: { ok: true } },
    { path: 'b.json', json: { ok: false } },
    { path: 'c.json', json: null },
  ]
  const result = runCorpus({
    files,
    rule: ({ json }) => {
      if (json === null) throw new Error('unparseable')
      return json.ok ? null : 'not ok'
    },
  })
  assert.equal(result.scanned, 3)
  assert.deepEqual(result.rejected, [{ path: 'b.json', reason: 'not ok' }])
  // A rule that throws on real input would crash the gate in CI — that is a finding, not a skip.
  assert.equal(result.errored.length, 1)
  assert.equal(result.errored[0].path, 'c.json')
})

test('an empty corpus reports loudly instead of reading as clean', () => {
  // The whole point of #1966: a run that matched nothing must not look like a pass.
  const report = formatReport(runCorpus({ files: [], rule: () => null }), { glob: 'nope/*.json' })
  assert.match(report, /MATCHED NOTHING/)
  assert.doesNotMatch(report, /clean/)
})

test('formatReport names every refused file', () => {
  const report = formatReport(
    { scanned: 47, rejected: [{ path: 'apps/velo/schemas/booking.json', reason: 'unknown target "locations"' }], errored: [] },
    { glob: 'apps/*/schemas/*.json' },
  )
  assert.match(report, /apps\/velo\/schemas\/booking\.json/)
  assert.match(report, /1\/47/)
})

// ── #1957 replay: the corpus catches what eight green unit tests did not ──────────────────────
// `refTarget` names the generated DIRECTORY (plural); the config is keyed by the collection name
// as written. velo configures `location` and correctly says `refTarget: "locations"`. The gate's
// first version compared against config keys only — green tests, and it would have refused this.
const VELO_BOOKING = 'apps/velo/schemas/booking.json'
const CONFIGURED = ['location', 'booking'] // as the config keys them — singular
const plural = (name) => (name.endsWith('s') ? name : `${name}s`)

function refTargetsOf({ json }) {
  return Object.values(json || {}).map(def => def?.refTarget).filter(Boolean)
}

test('the real velo schema still carries the plural refTarget this rule turns on', () => {
  // Asserted, not skipped: if this file moves, the two cases below would quietly stop testing
  // anything — a vacuous pass is the failure mode this whole issue is about.
  assert.ok(existsSync(join(ROOT, VELO_BOOKING)), `${VELO_BOOKING} is the #1957 corpus case — update this test if it moves`)
  assert.deepEqual(refTargetsOf(readCorpusFile(VELO_BOOKING)), ['locations'])
})

test('the config-keys-only rule refuses shipping schemas — the corpus says so, the tests did not', () => {
  const naive = file => refTargetsOf(file).find(t => !CONFIGURED.includes(t)) ?? null
  const result = runCorpus({ files: [readCorpusFile(VELO_BOOKING)], rule: f => naive(f) && `unknown target "${naive(f)}"` })
  assert.equal(result.rejected.length, 1, 'the first #1957 version would have refused apps/velo')

  // The shipped rule accepts both name forms, which is why velo generates today.
  const fixed = file => refTargetsOf(file).find(t => !CONFIGURED.some(c => c === t || plural(c) === t)) ?? null
  assert.equal(runCorpus({ files: [readCorpusFile(VELO_BOOKING)], rule: fixed }).rejected.length, 0)
})

test('findFiles reaches the real schema corpus', () => {
  const files = findFiles('apps/*/schemas/*.json')
  assert.ok(files.length > 0, 'the schema corpus is not empty — a zero match here means the walker is broken')
  assert.ok(files.includes(VELO_BOOKING))
})
