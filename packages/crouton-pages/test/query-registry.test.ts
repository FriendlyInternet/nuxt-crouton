/**
 * #2309 — every collection this package ships is registered for the public query registry,
 * under the key the generator would have written for it (`pages` + PascalCase directory).
 * Derived from the `collections/` directory so adding a collection without registering it fails.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pagesQueryRegistry } from '../server/query-registry'

describe('pagesQueryRegistry', () => {
  it('registers every collection directory under its generated key', () => {
    const dirs = readdirSync(resolve(__dirname, '../collections'), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
    const expected = dirs.map(d => 'pages' + d.charAt(0).toUpperCase() + d.slice(1)).sort()
    expect(Object.keys(pagesQueryRegistry).sort()).toEqual(expected)
  })

  it('exposes a lazy getAll and getByIds for each', () => {
    for (const [key, q] of Object.entries(pagesQueryRegistry)) {
      expect(typeof q.getAll, key).toBe('function')
      expect(typeof q.getByIds, key).toBe('function')
    }
  })
})
