// build-review.yml runs trusted default-branch scripts from a "safe folder" ($RUNNER_TEMP/trusted).
// A hand-kept per-file copy list broke silently every time a script gained an import (#4206), so the
// workflow copies the whole scripts/ tree. These checks pin that, the paths it runs, and that no
// trusted script imports from outside scripts/ (which a whole-tree copy would not carry).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wf = readFileSync(resolve(root, '.github/workflows/build-review.yml'), 'utf8')

// covers: T1
test('build-review copies the whole scripts/ tree, never a hand-kept file list (#4206)', () => {
  assert.doesNotMatch(wf, /git show "[^"]*:scripts\/[^"]+"\s*>\s*"\$RUNNER_TEMP\/trusted/)
  assert.doesNotMatch(wf, /for [fF] in [^;\n]*\.mjs/)
  const archives = wf.match(/git archive "[^"]+" scripts \| tar -x -C "\$RUNNER_TEMP\/trusted"/g) || []
  assert.ok(archives.length >= 2, `expected a whole-tree copy in both steps, found ${archives.length}`)
})

// covers: T2
test('every node call into the safe folder names a real repo file', () => {
  const paths = [...wf.matchAll(/node "\$RUNNER_TEMP\/trusted\/([^"]+)"/g)].map(m => m[1])
  assert.ok(paths.length > 0, 'found no trusted node calls')
  for (const p of paths) {
    assert.ok(existsSync(resolve(root, p)), `trusted/${p} has no repo file at ${p}`)
  }
})

const importRe = /(?:\bimport\s[^'"`;]*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s[^'"`;]*?\bfrom\s*)['"](\.{1,2}\/[^'"]+)['"]/g

function walk(entry, seen = new Set()) {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const src = readFileSync(entry, 'utf8')
  for (const m of src.matchAll(importRe)) {
    const target = resolve(dirname(entry), m[1])
    const rel = relative(resolve(root, 'scripts'), target)
    assert.ok(!rel.startsWith('..'), `${relative(root, entry)} imports ${m[1]}, outside scripts/`)
    assert.ok(existsSync(target), `${relative(root, entry)} imports ${m[1]}, which does not exist`)
    walk(target, seen)
  }
  return seen
}

// covers: T3
test('every relative import reachable from the trusted entry scripts stays inside scripts/', () => {
  const entries = [
    'scripts/handoff-exec.mjs',
    'scripts/lib/build-verdict.mjs',
    'scripts/lib/build-review-prompt.mjs',
    'scripts/lib/earlier-owner-ok.mjs',
    'scripts/lib/ok-reply.mjs',
    'scripts/flow-checklist.mjs',
  ]
  const seen = new Set()
  for (const e of entries) walk(resolve(root, e), seen)
  // handoff-exec pulls in plan-shape (the import that broke #4206) — prove the walk actually followed it.
  assert.ok(seen.has(resolve(root, 'scripts/lib/plan-shape.mjs')), 'walk did not reach lib/plan-shape.mjs')
  assert.ok(seen.has(resolve(root, 'scripts/lib/owner-screens.mjs')), 'walk did not reach lib/owner-screens.mjs')
})
