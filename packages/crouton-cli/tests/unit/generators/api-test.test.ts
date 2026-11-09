import { describe, it, expect } from 'vitest'
import { generateApiTest } from '../../../lib/generators/api-test.ts'
import { buildFieldsSchema } from '../../../lib/generate-collection.ts'

// Minimal `data` shape the orchestrator passes to generators (see buildGeneratorData
// in generate-collection.ts). The API test imports the generated route handlers and
// the queries module by relative path, so the fixtures carry the case variants +
// hierarchy/sortable flags the path/name derivation needs.
const baseData = {
  layer: 'shop',
  singular: 'product',
  plural: 'products',
  camelCase: 'product',
  camelCasePlural: 'products',
  pascalCase: 'Product',
  pascalCasePlural: 'Products',
  layerPascalCase: 'Shop',
  layerCamelCase: 'shop',
  hierarchy: { enabled: false },
  sortable: { enabled: false },
  fields: [
    { name: 'id', type: 'string', zod: 'z.string()', meta: { primaryKey: true } },
    { name: 'name', type: 'string', zod: 'z.string()', meta: { required: true } },
    { name: 'price', type: 'decimal', zod: 'z.number()', meta: { required: true } },
    { name: 'inStock', type: 'boolean', zod: 'z.boolean()', meta: {} },
  ],
}

describe('generateApiTest (#791)', () => {
  const code = generateApiTest(baseData, null)

  it('mocks the team-auth util and the generated queries module', () => {
    expect(code).toContain("vi.mock('@fyit/crouton-auth/server/utils/team'")
    expect(code).toContain("vi.mock('./server/database/queries'")
  })

  it('provides the H3/Nitro auto-imports before the route modules load (vi.hoisted)', () => {
    expect(code).toContain('vi.hoisted(')
    expect(code).toContain('defineEventHandler')
    expect(code).toContain('readValidatedBody')
  })

  it('imports the four CRUD handlers by their exact generated paths', () => {
    expect(code).toContain("from './server/api/teams/[id]/shop-products/index.get.ts'")
    expect(code).toContain("from './server/api/teams/[id]/shop-products/index.post.ts'")
    expect(code).toContain("from './server/api/teams/[id]/shop-products/[productId].patch.ts'")
    expect(code).toContain("from './server/api/teams/[id]/shop-products/[productId].delete.ts'")
  })

  it('exports the query functions the routes import from the mock factory', () => {
    expect(code).toMatch(/createShopProduct:\s*vi\.fn\(\)/)
    expect(code).toMatch(/getAllShopProducts:\s*vi\.fn\(\)/)
    expect(code).toMatch(/updateShopProduct:\s*vi\.fn\(\)/)
    expect(code).toMatch(/deleteShopProduct:\s*vi\.fn\(\)/)
  })

  it('asserts an unauthenticated request is rejected and never writes', () => {
    // resolveTeamAndCheckMembership is made to reject; the create query must not run
    expect(code).toMatch(/mockRejected/)
    expect(code).toContain('expect(createShopProduct).not.toHaveBeenCalled()')
  })

  it('asserts the create is scoped to the resolved team (flipping team-scope turns it red)', () => {
    expect(code).toMatch(/toHaveBeenCalledWith\(expect\.objectContaining\(\{ teamId: TEAM\.id/)
  })

  it('asserts the list query receives the resolved team id', () => {
    expect(code).toContain('getAllShopProducts')
    expect(code).toMatch(/toBe\(TEAM\.id\)/)
  })

  it('asserts a missing id param 400s on patch/delete', () => {
    expect(code).toMatch(/status:\s*400/)
  })

  it('asserts a not-found from the query surfaces as a 404', () => {
    expect(code).toMatch(/status:\s*404/)
    expect(code).toMatch(/toMatchObject\(\{ status: 404 \}\)/)
  })

  it('rejects an invalid body before writing (collection has a required field)', () => {
    // required `name` omitted → readValidatedBody throws → create never runs
    expect(code).toMatch(/invalid body|before writing/i)
  })

  it('omits move/reorder cases for a non-hierarchy, non-sortable collection', () => {
    expect(code).not.toContain('move.patch.ts')
    expect(code).not.toContain('reorder.patch.ts')
    expect(code).not.toContain('updatePositionShopProduct')
    expect(code).not.toContain('reorderSiblingsShopProducts')
  })

  it('emits move + reorder cases when hierarchy is enabled', () => {
    const h = generateApiTest({
      ...baseData,
      hierarchy: { enabled: true, parentField: 'parentId', orderField: 'order', pathField: 'path', depthField: 'depth' },
    }, null)
    expect(h).toContain("from './server/api/teams/[id]/shop-products/[productId]/move.patch.ts'")
    expect(h).toContain("from './server/api/teams/[id]/shop-products/reorder.patch.ts'")
    expect(h).toMatch(/updatePositionShopProduct:\s*vi\.fn\(\)/)
    expect(h).toMatch(/reorderSiblingsShopProducts:\s*vi\.fn\(\)/)
  })

  it('emits a reorder case (no move) for a sortable-only collection', () => {
    const s = generateApiTest({
      ...baseData,
      sortable: { enabled: true, orderField: 'order' },
    }, null)
    expect(s).toContain('reorder.patch.ts')
    expect(s).not.toContain('move.patch.ts')
    expect(s).toMatch(/reorderSiblingsShopProducts:\s*vi\.fn\(\)/)
  })

  it('emits no nondeterministic calls', () => {
    expect(code).not.toContain('Date.now(')
    expect(code).not.toContain('Math.random(')
  })
})

describe('generateApiTest — team references (#3378)', () => {
  it('mocks assert<X>References only when the collection has reference fields', () => {
    const withRef = {
      ...baseData,
      fields: [...baseData.fields, { name: 'categoryId', type: 'string', refTarget: 'categories', zod: 'z.string()', meta: {} }],
    }
    expect(generateApiTest(withRef, null)).toContain('assertShopProductReferences: vi.fn()')
    expect(generateApiTest(baseData, null)).not.toContain('References')
  })
})

describe('generateApiTest — same-team reference cases (#3424)', () => {
  const withRef = {
    ...baseData,
    fields: [...baseData.fields, { name: 'categoryId', type: 'string', refTarget: 'categories', zod: 'z.string()', meta: {} }],
  }
  const code = generateApiTest(withRef, null)

  it('POST and PATCH each get other-team, missing-id, same-team and null cases', () => {
    expect(code.match(/rejects a reference to another team\\'s record \(400\)/g)).toHaveLength(2)
    expect(code.match(/rejects a reference id that does not exist \(400\)/g)).toHaveLength(2)
    expect(code.match(/accepts references that belong to the team/g)).toHaveLength(2)
    expect(code.match(/accepts null for the optional reference `categoryId`/g)).toHaveLength(2)
    expect(code).toContain('expect(createShopProduct).not.toHaveBeenCalled()')
    expect(code).toContain('expect(updateShopProduct).not.toHaveBeenCalled()')
    expect(code).toMatch(/import \{[^}]*assertShopProductReferences[^}]*\} from '.\/server\/database\/queries'/)
  })

  it('sends the reference value and asserts the check received it', () => {
    expect(code).toContain("categoryId: 'ref_1'")
    expect(code).toContain("expect.objectContaining({ categoryId: 'ref_1' })")
    expect(code).toContain("categoryId: 'other_team_ref'")
    expect(code).toContain("categoryId: 'missing_ref'")
  })

  it('emits a list reference as an array, never a bare string', () => {
    const list = { ...baseData, fields: [...baseData.fields, { name: 'tags', type: 'array', refTarget: 'tags', zod: 'z.array(z.string())', meta: {} }] }
    const out = generateApiTest(list, null)
    expect(out).toContain("tags: ['ref_1']")
    expect(out).not.toContain("tags: 'ref_1'")
  })

  it('uses once-only rejections so a failing check cannot leak into later cases', () => {
    expect(code).not.toMatch(/assertShopProductReferences as any\)\.mockRejectedValue\(/)
  })

  it('omits the null case when every reference is required, and all cases without references', () => {
    const required = { ...withRef, fields: withRef.fields.map(f => (f.name === 'categoryId' ? { ...f, meta: { required: true } } : f)) }
    expect(generateApiTest(required, null)).not.toContain('accepts null for the optional reference')
    expect(generateApiTest(baseData, null)).not.toContain('another team')
  })
})

describe('generateApiTest — list references use the schema generator\'s list rule (#3600)', () => {
  const ref = (extra: Record<string, any>) => ({ type: 'string', zod: 'z.string()', meta: {}, ...extra })
  const cases = [
    ['zod list', ref({ name: 'tags', refTarget: 'tags', zod: 'z.array(z.string())' })],
    ['dependsOn', ref({ name: 'slots', refTarget: 'slots', meta: { dependsOn: 'location', dependsOnCollection: 'locations', dependsOnField: 'slots' } })],
    ['slotButtonGroup', ref({ name: 'slots', refTarget: 'slots', meta: { displayAs: 'slotButtonGroup' } })],
  ] as const

  it.each(cases)('%s: sends a list, keeps the null case, and matches the server schema', (_label, field) => {
    const out = generateApiTest({ ...baseData, fields: [...baseData.fields, field] }, null)
    for (const id of ['ref_1', 'other_team_ref', 'missing_ref']) {
      expect(out).toContain(`${field.name}: ['${id}']`)
      expect(out).not.toContain(`${field.name}: '${id}'`)
    }
    expect(out).toContain(`accepts null for the optional reference \`${field.name}\``)
    expect(out).toContain(`${field.name}: null`)
    const schema = buildFieldsSchema({ fields: [...baseData.fields, field] as any, config: null, hierarchy: { enabled: false } as any, cases: { plural: 'products' }, layerCamelCase: 'shop', mode: 'server' })
    expect(schema).toMatch(new RegExp(`${field.name}: z\\.array\\(.*\\.nullish\\(\\)`))
  })

  it('a type: array ref gets the null case', () => {
    const out = generateApiTest({ ...baseData, fields: [...baseData.fields, ref({ name: 'tags', type: 'array', refTarget: 'tags', zod: 'z.array(z.string())' })] }, null)
    expect(out).toContain('accepts null for the optional reference `tags`')
  })

  it('prefers an optional single ref for the null case', () => {
    const out = generateApiTest({ ...baseData, fields: [...baseData.fields, ref({ name: 'tags', type: 'array', refTarget: 'tags', zod: 'z.array(z.string())' }), ref({ name: 'categoryId', refTarget: 'categories' })] }, null)
    expect(out).toContain('accepts null for the optional reference `categoryId`')
    expect(out).not.toContain('accepts null for the optional reference `tags`')
  })

  it('dependsOn without dependsOnCollection stays a single value', () => {
    const out = generateApiTest({ ...baseData, fields: [...baseData.fields, ref({ name: 'slots', refTarget: 'slots', meta: { dependsOn: 'location' } })] }, null)
    expect(out).toContain("slots: 'ref_1'")
  })
})
