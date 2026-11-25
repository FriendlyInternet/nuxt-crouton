import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// #3380 — a committed `list: 'own'` collection must have its access loader in the generated
// registry and its Access export in queries.ts, otherwise "no access info" would let the
// public endpoints serve other members' rows. Catches fixtures that were not regenerated.
const fixtures = path.resolve(__dirname, '../../../../../fixtures')

describe('fixtures: list: own collections carry their access loader', () => {
  it('minimal/membernotes', () => {
    const registry = fs.readFileSync(path.join(fixtures, 'minimal/server/utils/crouton-query-registry.ts'), 'utf8')
    const queries = fs.readFileSync(
      path.join(fixtures, 'minimal/layers/main/collections/membernotes/server/database/queries.ts'), 'utf8')
    expect(registry).toContain('m.MainMembernotesAccess')
    expect(queries).toMatch(/export const MainMembernotesAccess = \{[^}]*"list":"own"/)
  })
})
