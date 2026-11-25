import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

// covers: T7
// One builder names every collection cache slot (#4506). Any other file in
// crouton-core's app/ that builds `collection:${…}` or `collection-item:${…}`
// by hand can drift from it (that is how team-less keys refreshed other teams).
const appDir = resolve(import.meta.dirname, '../..')
const BUILDER = 'useCollectionCacheKeys.ts'
const PATTERNS = ['`collection:${', '`collection-item:${']
const SKIP_DIRS = ['__tests__', 'node_modules']

const isScanned = (rel: string) =>
  (rel.endsWith('.ts') || rel.endsWith('.vue'))
  && basename(rel) !== BUILDER
  && !rel.split(sep).some(part => SKIP_DIRS.includes(part))

describe('collection cache keys', () => {
  it('are built only by useCollectionCacheKeys', () => {
    const files = readdirSync(appDir, { recursive: true, encoding: 'utf8' })
      .filter(isScanned)
      .map(rel => join(appDir, rel))
    expect(files.length).toBeGreaterThan(0)
    const offenders = files
      .filter(f => PATTERNS.some(p => readFileSync(f, 'utf8').includes(p)))
      .map(f => relative(appDir, f))
    expect(offenders).toEqual([])
  })
})
