/**
 * #2309 — which of this package's collections are reachable through crouton-pages' PUBLIC
 * collection endpoints. Pinned both ways: every registered key must be a real collection
 * directory (under its generated key), and the set must be exactly the public-safe list —
 * an admin can bind any registered key on a public page (red-team finding on PR #2317).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pagesQueryRegistry } from '../server/query-registry'

const PUBLIC = ['pages']
const key = (dir: string) => 'pages' + dir.charAt(0).toUpperCase() + dir.slice(1)

describe('pagesQueryRegistry', () => {
  it('registers exactly the public-safe collections, under their generated keys', () => {
    expect(Object.keys(pagesQueryRegistry).sort()).toEqual(PUBLIC.map(key).sort())
  })

  it('every registered key is a shipping collection directory', () => {
    const dirs = readdirSync(resolve(__dirname, '../collections'), { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name)
    for (const dir of PUBLIC) expect(dirs, dir).toContain(dir)
  })

  it('exposes a lazy getAll and getByIds for each', () => {
    for (const [k, q] of Object.entries(pagesQueryRegistry)) {
      expect(typeof q.getAll, k).toBe('function')
      expect(typeof q.getByIds, k).toBe('function')
    }
  })
})
