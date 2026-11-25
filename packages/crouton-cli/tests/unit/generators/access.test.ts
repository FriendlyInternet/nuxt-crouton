import { describe, it, expect } from 'vitest'
import {
  generateGetEndpoint,
  generatePostEndpoint,
  generatePatchEndpoint,
  generateDeleteEndpoint,
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
    expect(generatePostEndpoint(none, cfg)).not.toContain('requireCan')
    expect(generateQueries(none, cfg)).not.toContain('ownerId')
  })

  // Title kept from #3148 (the removed-test check keys on it); since #4108 the
  // guard is requireCan with the collection's action, never a role name.
  it('create: admin guards POST with requireTeamRole', () => {
    const out = generatePostEndpoint(withAccess({ create: 'admin' }), cfg)
    expect(out).toContain(`requireCan(event, 'collections:manage')`)
    expect(out).toContain(`import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'`)
    expect(out).not.toContain('requireTeamRole')
    expect(out).not.toContain('resolveTeamAndCheckMembership(event)')
  })

  it('create: member keeps the membership check', () => {
    const out = generatePostEndpoint(withAccess({ create: 'member' }), cfg)
    expect(out).toBe(generatePostEndpoint(none, cfg))
  })

  it('reorder: admin guards reorder AND move', () => {
    const a = withAccess({ reorder: 'admin' })
    expect(generateReorderEndpoint(a, cfg)).toContain(`requireCan(event, 'collections:manage')`)
    expect(generateMoveEndpoint(a, cfg)).toContain(`requireCan(event, 'collections:manage')`)
  })

  it('list: own filters the list handler, ?ids= and both queries', () => {
    const a = withAccess({ list: 'own' })
    const handler = generateGetEndpoint(a, cfg)
    expect(handler).toContain(`const ownerId = (await can(team.id, user.id, 'collections:manage', event)) ? undefined : user.id`)
    expect(handler).toContain(`import { can } from '@fyit/crouton-auth/server/utils/team-auth'`)
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

  // Title kept from #3148; since #4108 it mocks requireCan / can, never requireTeamRole.
  it('generated handler test mocks requireTeamRole only when access needs it', () => {
    const guarded = generateApiTest(withAccess({ create: 'admin' }), cfg)
    expect(guarded).toContain(`import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'`)
    expect(guarded).toContain('(requireCan as any).mockRejectedValueOnce')
    expect(guarded).not.toContain('requireTeamRole')
    const plain = generateApiTest(none, cfg)
    expect(plain).not.toContain('requireTeamRole')
    expect(plain).not.toContain('import { requireCan }')
    // update/delete always ask can(): every generated test mocks the team-auth module
    expect(plain).toContain(`vi.mock('@fyit/crouton-auth/server/utils/team-auth'`)
    expect(plain).toContain('can: vi.fn().mockResolvedValue(false)')
    expect(generateApiTest(withAccess({ list: 'own' }), cfg)).toContain('ownerId: USER.id')
  })
})

// #4108 — the generator writes an ACTION, never a role name.
describe('access action (#4108)', () => {
  const ROLE_NAME = /role\s*===|requireTeamRole|'owner'/
  const all = (d: any) => [
    generateGetEndpoint(d, cfg),
    generatePostEndpoint(d, cfg),
    generatePatchEndpoint(d, cfg),
    generateDeleteEndpoint(d, cfg),
    generateMoveEndpoint(d, cfg),
    generateReorderEndpoint(d, cfg),
    generateQueries(d, cfg)
  ]

  it('defaults to collections:manage for update/delete "sees all rows"', () => {
    expect(generatePatchEndpoint(none, cfg)).toContain(`{ seesAll: await can(team.id, user.id, 'collections:manage', event) }`)
    expect(generateDeleteEndpoint(none, cfg)).toContain(`{ seesAll: await can(team.id, user.id, 'collections:manage', event) }`)
    expect(generatePatchEndpoint(none, cfg)).toContain(`import { can } from '@fyit/crouton-auth/server/utils/team-auth'`)
  })

  it('access.action overrides the action on every guard and check', () => {
    const d = withAccess({ action: 'bookings:manage', create: 'admin', reorder: 'admin', list: 'own' })
    expect(generatePostEndpoint(d, cfg)).toContain(`requireCan(event, 'bookings:manage')`)
    expect(generateMoveEndpoint(d, cfg)).toContain(`requireCan(event, 'bookings:manage')`)
    expect(generateReorderEndpoint(d, cfg)).toContain(`requireCan(event, 'bookings:manage')`)
    expect(generateGetEndpoint(d, cfg)).toContain(`can(team.id, user.id, 'bookings:manage', event)`)
    expect(generatePatchEndpoint(d, cfg)).toContain(`can(team.id, user.id, 'bookings:manage', event)`)
    expect(generateDeleteEndpoint(d, cfg)).toContain(`can(team.id, user.id, 'bookings:manage', event)`)
    expect(all(d).join('\n')).not.toContain('collections:manage')
  })

  it('queries take a seesAll boolean, not a role', () => {
    const q = generateQueries(none, cfg)
    expect(q).toContain('options?: { seesAll?: boolean }')
    expect((q.match(/const seesAll = options\?\.seesAll === true/g) || []).length).toBe(2)
    expect(q).not.toContain('options?.role')
  })

  it('no generated output tests a role name', () => {
    for (const d of [none, withAccess({ create: 'admin', reorder: 'admin', list: 'own' }), withAccess({ action: 'sales:manage', list: 'own' })]) {
      for (const out of all(d)) expect(out).not.toMatch(ROLE_NAME)
    }
  })

  it('rejects a malformed access.action', () => {
    for (const bad of ['admin', 'Bookings:manage', 'bookings:', ':manage', 'a:b:c', 42]) {
      expect(() => generatePostEndpoint(withAccess({ action: bad }), cfg)).toThrow(/Invalid access\.action/)
    }
  })
})

describe('queries module exports its access (#3380)', () => {
  it('emits <X>Access when access is declared', () => {
    const out = generateQueries(withAccess({ list: 'own' }), cfg)
    expect(out).toMatch(/export const \w+Access = \{"list":"own"\} as const/)
  })

  it('emits no Access export without access', () => {
    expect(generateQueries(none, cfg)).not.toContain('Access =')
  })
})
