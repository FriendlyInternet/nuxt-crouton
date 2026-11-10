// The status app bundles pocs/status/server/utils/now-core.ts with Rollup, which cannot parse a
// `#!/usr/bin/env node` line ("Expected ident"). Walk the real import chain and fail on any shebang.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(root, 'pocs/status/server/utils/now-core.ts')

function walk(file, seen = new Set()) {
  if (seen.has(file)) return seen
  seen.add(file)
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s+['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g)) {
    const spec = m[1] || m[2]
    const target = resolve(dirname(file), spec)
    if (existsSync(target)) walk(target, seen)
  }
  return seen
}

test('now-core.ts import chain has no file starting with #!', () => {
  const files = [...walk(entry)]
  assert.ok(files.length > 3, 'import walk found the chain')
  const bad = files.filter(f => readFileSync(f, 'utf8').startsWith('#!')).map(f => relative(root, f))
  assert.deepEqual(bad, [])
})
