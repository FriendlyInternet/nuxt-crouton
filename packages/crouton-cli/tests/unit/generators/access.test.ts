import { describe, it, expect } from 'vitest'
import {
  generateGetEndpoint,
  generatePostEndpoint,
  generateMoveEndpoint,
  generateReorderEndpoint
} from '../../../lib/generators/api-endpoints.ts'
import { generateQueries } from '../../../lib/generators/database-queries.ts'
import { generateApiTest } from '../../../lib/generators/api-test.ts'
import { apiWithHierarchyData, minimalConfig } from '../../fixtures/sample-data.mjs'

type AnyConfig = any
const cfg = minimalConfig as AnyConfig
const withAccess = (access: any) => ({ ...apiWithHierarchyData, collectionConfig: { access } })
const none = { ...apiWithHierarchyData }

describe('per-collection access (#3148)', () => {
  it('no access → output identical to a collection with an empty collectionConfig', () => {
    const empty = { ...apiWithHierarchyData, collectionConfig: {} }
    for (const gen of [generateGetEndpoint, generatePostEndpoint, generateMoveEndpoint, generateReorderEndpoint]) {
      expect(gen(empty, cfg)).toBe(gen(none, cfg))
    }
    expect(generateQueries(empty, cfg)).toBe(generateQueries(none, cfg))
    expect(generateApiTest(empty, cfg)).toBe(generateApiTest(none, cfg))
    expect(generatePostEndpoint(none, cfg)).not.toContain('requireTeamRole')
    expect(generateQueries(none, cfg)).not.toContain('ownerId')
  })

  it('create: admin guards POST with requireTeamRole', () => {
    const out = generatePostEndpoint(withAccess({ create: 'admin' }), cfg)
    expect(out).toContain(`requireTeamRole(event, 'admin')`)
    expect(out).not.toContain('resolveTeamAndCheckMembership(event)')
  })

  it('create: member keeps the membership check', () => {
    const out = generatePostEndpoint(withAccess({ create: 'member' }), cfg)
    expect(out).toBe(generatePostEndpoint(none, cfg))
  })

  it('reorder: admin guards reorder AND move', () => {
    const a = withAccess({ reorder: 'admin' })
    expect(generateReorderEndpoint(a, cfg)).toContain(`requireTeamRole(event, 'admin')`)
    expect(generateMoveEndpoint(a, cfg)).toContain(`requireTeamRole(event, 'admin')`)
  })

  it('list: own filters the list handler, ?ids= and both queries', () => {
    const a = withAccess({ list: 'own' })
    const handler = generateGetEndpoint(a, cfg)
    expect(handler).toContain('const ownerId =')
    expect(handler).toMatch(/ByIds\(team\.id, ids, ownerId\)/)
    expect(handler).toMatch(/ownerId \}\)/)
    const q = generateQueries(a, cfg)
    expect(q).toContain('opts.ownerId')
    expect(q).toMatch(/ByIds\(teamId: string, \w+: string\[\], ownerId\?: string\)/)
    expect((q.match(/\.owner, (opts\.)?ownerId\)/g) || []).length).toBe(2)
  })

  it('list: team is the same as no declaration', () => {
    expect(generateGetEndpoint(withAccess({ list: 'team' }), cfg)).toBe(generateGetEndpoint(none, cfg))
  })

  it('rejects unknown keys and values instead of silently ignoring them', () => {
    expect(() => generatePostEndpoint(withAccess({ create: 'adm1n' }), cfg)).toThrow(/Invalid access\.create/)
    expect(() => generatePostEndpoint(withAccess({ creat: 'admin' }), cfg)).toThrow(/Invalid access key/)
  })

  it('generated handler test mocks requireTeamRole only when access needs it', () => {
    expect(generateApiTest(withAccess({ create: 'admin' }), cfg)).toContain('requireTeamRole: vi.fn()')
    expect(generateApiTest(none, cfg)).not.toContain('requireTeamRole')
    expect(generateApiTest(withAccess({ list: 'own' }), cfg)).toContain('ownerId: USER.id')
  })
})
