// Guard: the "Node checks" CI job runs scripts/*.test.mjs + scripts/lib/*.test.mjs on bare Node
// with NO package install. A test (or any script it imports) that pulls in an npm package fails
// there with an opaque exit 1 while passing locally.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinModules } from 'node:module'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const core = new Set(builtinModules)
// Static imports and require() only: a lazy `await import('x')` is loaded on demand and is
// expected to be guarded (try/catch), so it cannot fail the whole file at load time.
const SPEC = /^\s*(?:import(?!\s+type\b)[^'"\n(]*?\bfrom\s*|import\s*|(?:const|let|var)[^\n=]*=\s*require\(\s*)(['"])([^'"\n]+)\1/gm

export function offenders(entries) {
  const seen = new Set(); const bad = []
  const queue = [...entries]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')
    for (const [, , spec] of src.matchAll(SPEC)) {
      if (spec.startsWith('.')) { if (/\.[cm]?js$/.test(spec)) queue.push(resolve(dirname(file), spec)) }
      else if (!spec.startsWith('node:') && !core.has(spec.split('/')[0]) && !core.has(spec)) bad.push(`${file.slice(root.length + 1)} imports "${spec}"`)
    }
  }
  return bad
}

test('bare-Node tests import only Node core or relative files', () => {
  const tests = ['scripts', 'scripts/lib'].flatMap(d =>
    readdirSync(join(root, d)).filter(f => f.endsWith('.test.mjs')).map(f => join(root, d, f)))
  const bad = offenders(tests)
  assert.deepEqual(bad, [], `Node checks runs with no install. Move it to a job that installs packages ` +
    `(rename to *.deps-test.mjs, run by the "Build packages" job):\n${bad.join('\n')}`)
})

test('guard catches an npm import', () => {
  const f = join(root, 'scripts/gen-api-reference.mjs')
  assert.ok(offenders([f]).some(m => m.includes('typescript')))
})
