import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// covers: T7
// One builder names every collection cache slot (#4506). Any other file in
// crouton-core's app/ that builds `collection:${…}` or `collection-item:${…}`
// by hand can drift from it (that is how team-less keys refreshed other teams).
const appDir = resolve(import.meta.dirname, '../..')
const BUILDER = 'useCollectionCacheKeys.ts'
const PATTERNS = ['`collection:${', '`collection-item:${']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if ((name.endsWith('.ts') || name.endsWith('.vue')) && name !== BUILDER) out.push(full)
  }
  return out
}

describe('collection cache keys', () => {
  it('are built only by useCollectionCacheKeys', () => {
    const files = walk(appDir)
    expect(files.length).toBeGreaterThan(0)
    const offenders = files
      .filter(f => PATTERNS.some(p => readFileSync(f, 'utf8').includes(p)))
      .map(f => relative(appDir, f))
    expect(offenders).toEqual([])
  })
})
