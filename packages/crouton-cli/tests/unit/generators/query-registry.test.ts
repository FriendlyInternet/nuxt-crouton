import { describe, it, expect } from 'vitest'
import { generateQueryRegistry } from '../../../lib/generators/query-registry.ts'

describe('generateQueryRegistry access loader (#3380)', () => {
  it('emits an access loader per entry', () => {
    const out = generateQueryRegistry([{
      layer: 'main',
      collection: 'membernotes',
      collectionKey: 'mainMembernotes',
      prefixedPascalCasePlural: 'MainMembernotes',
      importPath: '~~/layers/main/collections/membernotes/server/database/queries'
    } as any])
    expect(out).toContain("access: () => import('~~/layers/main/collections/membernotes/server/database/queries')")
    expect(out).toContain('.then((m: any) => m.MainMembernotesAccess)')
  })
})
