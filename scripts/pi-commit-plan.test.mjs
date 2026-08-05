// The commit-plan splitter (#1849) — the fix for #1830, where the generated collection was dropped.
// Pins the classification: inputs = ledger (hand-authored), generated = the rest minus junk, both
// committed. A false "generated" is at worst a noisy commit; DROPPING generated output is the bug
// we're fixing, so these lock that it can't happen again.
//   node --test scripts/pi-commit-plan.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planCommits, serializeBucket, writeBuckets } from './pi-commit-plan.mjs'

test('the #1830 case: generated collection lands in `generated`, config/schema in `inputs`', () => {
  // pi hand-authored (ledger) the config + schema; `crouton config` GENERATED the collection.
  const ledger = ['pocs/lend/crouton.config.js', 'pocs/lend/schemas/loans.json']
  const changed = [
    'pocs/lend/crouton.config.js',
    'pocs/lend/schemas/loans.json',
    // generated collection (NOT in the ledger — this is exactly what used to be dropped):
    'pocs/lend/layers/main/collections/loans/app/components/List.vue',
    'pocs/lend/layers/main/collections/loans/server/api/loans/index.get.ts',
    'pocs/lend/server/database/schema/loans.ts',
    // junk that must never be committed:
    'pocs/lend/node_modules/x/index.js',
    '.pi/npm/.gitignore',
    'pi-telemetry-out/trace.jsonl',
  ]
  const { inputs, generated } = planCommits({ ledger, changed })
  assert.deepEqual(inputs, ['pocs/lend/crouton.config.js', 'pocs/lend/schemas/loans.json'])
  assert.deepEqual(generated, [
    'pocs/lend/layers/main/collections/loans/app/components/List.vue',
    'pocs/lend/layers/main/collections/loans/server/api/loans/index.get.ts',
    'pocs/lend/server/database/schema/loans.ts',
  ])
  // the whole point: the generated collection is NOT empty this time.
  assert.ok(generated.length >= 3, 'generated collection must be committed, not dropped')
})

test('junk is excluded from BOTH buckets (node_modules/.nuxt/.output/dist/.pi/telemetry)', () => {
  const changed = ['app/real.ts', 'node_modules/a', 'app/.nuxt/x', 'dist/y', '.pi/z', 'pi-telemetry-out/t.jsonl', '.output/o']
  const { inputs, generated } = planCommits({ ledger: [], changed })
  assert.deepEqual(inputs, [])
  assert.deepEqual(generated, ['app/real.ts'])
})

test('empty ledger (no session) → everything real falls to `generated`, never lost', () => {
  const { inputs, generated } = planCommits({ ledger: [], changed: ['a.ts', 'b/c.vue', 'node_modules/x'] })
  assert.deepEqual(inputs, [])
  assert.deepEqual(generated, ['a.ts', 'b/c.vue'])
})

test('a pure hand-edit task (no generated output) puts everything in `inputs`', () => {
  const ledger = ['packages/x/util.ts', 'packages/x/util.test.ts']
  const { inputs, generated } = planCommits({ ledger, changed: [...ledger] })
  assert.deepEqual(inputs, ['packages/x/util.test.ts', 'packages/x/util.ts'])
  assert.deepEqual(generated, [])
})

test('dedupes and sorts; a ledger entry that did not actually change is not fabricated', () => {
  // ledger claims 3 files but only 2 show up in the working tree → only those 2 are inputs.
  const ledger = ['a.ts', 'b.ts', 'c.ts']
  const changed = ['b.ts', 'b.ts', 'a.ts', 'gen/d.ts']
  const { inputs, generated } = planCommits({ ledger, changed })
  assert.deepEqual(inputs, ['a.ts', 'b.ts'])        // c.ts absent from changed → not committed
  assert.deepEqual(generated, ['gen/d.ts'])
})

test('accepts Set or array for ledger', () => {
  const p = planCommits({ ledger: new Set(['a.ts']), changed: ['a.ts', 'g.ts'] })
  assert.deepEqual(p.inputs, ['a.ts'])
  assert.deepEqual(p.generated, ['g.ts'])
})

// ── #1876: the SERIALISATION, not just the classification ────────────────────────────────
// Every test above checks the pure function, which is why the bug that ate #1874's `nl.json`
// shipped green: the buckets were classified correctly and then written without a trailing
// newline, so the finish step's `while IFS= read -r` dropped the LAST path of each bucket.
// These exercise the round-trip THROUGH THE FILE — the boundary that actually broke.

test('#1876: a bucket file ends in a newline so `while read` sees the LAST entry', () => {
  assert.equal(serializeBucket(['a.ts', 'b.ts', 'c.ts']), 'a.ts\nb.ts\nc.ts\n')
  // The exact regression: `.join("\n")` alone leaves `c.ts` unterminated and invisible to `read`.
  assert.notEqual(['a.ts', 'b.ts', 'c.ts'].join('\n'), serializeBucket(['a.ts', 'b.ts', 'c.ts']))
})

test('#1876: an empty bucket is an EMPTY file, never a blank line', () => {
  // A blank line would make stage_bucket try to stage `$CONTENT/` — an empty file iterates zero times.
  assert.equal(serializeBucket([]), '')
  assert.equal(serializeBucket(undefined), '')
  assert.equal(serializeBucket(['', '  ']), '')
})

test('#1876: writeBuckets round-trips every path back out, last one included', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-buckets-'))
  writeBuckets({ inputs: ['en.json', 'fr.json', 'nl.json'], generated: [] }, dir)

  // Read the file the way the workflow's shell does: split on newline, drop the trailing empty
  // slot that a correctly-terminated file produces. `nl.json` sorts LAST — the #1874 victim.
  const readBack = f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)
  assert.deepEqual(readBack('inputs.txt'), ['en.json', 'fr.json', 'nl.json'])
  assert.deepEqual(readBack('generated.txt'), [])

  // The count the run record reports (`grep -c .`) must equal what the commit actually stages,
  // or the harness reports files it did not commit — the second half of the #1876 defect.
  assert.equal(readBack('inputs.txt').length, 3)
  fs.rmSync(dir, { recursive: true, force: true })
})
