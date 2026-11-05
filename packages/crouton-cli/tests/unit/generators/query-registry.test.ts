import { describe, it, expect } from 'vitest'
import { generateQueryRegistry } from '../../../lib/generators/query-registry.ts'

describe('generateQueryRegistry access loader (#3380)', () => {
  it('emits an access loader per entry', () => {
    const out = generateQueryRegistry([{
      collectionKey: 'shopNotes',
      importPath: './layers/shop/collections/notes/server/database/queries',
      prefixedPascalCasePlural: 'ShopNotes',
      layer: 'shop',
      collection: 'notes',
    } as any])
    expect(out).toContain(`access: () => import('./layers/shop/collections/notes/server/database/queries')`)
    expect(out).toContain('.then(m => m.ShopNotesAccess)')
  })
})
