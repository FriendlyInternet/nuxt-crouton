import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fixture, installTeamFixture, fakeEvent } from './helpers/teamFixture'

vi.mock('#imports', () => ({ useRuntimeConfig: () => ({}) }))
vi.mock('@fyit/crouton-auth/server/utils/useServerAuth', () => ({
  requireServerSession: async () => ({ user: fixture.user, session: { activeOrganizationId: null } }),
  useServerAuth: () => ({})
}))

const inserted: any[] = []
let snapshot = true
let body: any = {}
const db = installTeamFixture()
;(db as any).insert = () => ({ values: async (v: any) => { inserted.push(v) } })
vi.stubGlobal('readBody', async () => body)
vi.stubGlobal('useRuntimeConfig', () => ({ public: { croutonEvents: { snapshotUserName: snapshot } } }))
vi.stubGlobal('getQuery', () => ({}))

const good = () => ({ operation: 'update', collectionName: 'posts', itemId: 'p1', changes: [{ fieldName: 'title', oldValue: 'a', newValue: 'b' }] })

async function post() {
  const h = (await import('../api/teams/[id]/crouton-collection-events/index.post')).default as any
  return h(fakeEvent())
}

beforeEach(() => {
  inserted.length = 0
  snapshot = true
  fixture.pathTeam = 'team-a'
  fixture.roles = { 'team-a': 'member' }
  body = good()
})

describe('collection-events POST', () => {
  it('stores server-derived identity and ignores body identity', async () => {
    body = { ...good(), id: 'evil', userId: 'x', userName: 'Mallory', teamId: 'team-b', timestamp: 1 }
    await post()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ userId: 'u1', userName: 'Una', teamId: 'team-a' })
    expect(inserted[0].id).not.toBe('evil')
    expect(inserted[0].timestamp.getTime()).toBeGreaterThan(1000)
  })
  it('blank userName when snapshotUserName is false', async () => {
    snapshot = false
    await post()
    expect(inserted[0].userName).toBe('')
  })
  it('non-member of the path team is refused, nothing written', async () => {
    fixture.roles = { 'team-b': 'member' }
    await expect(post()).rejects.toSatisfy((e: any) => (e.statusCode ?? e.status) === 403)
    expect(inserted).toHaveLength(0)
  })
  it('operation outside the list -> 400; allowed values pass', async () => {
    body = { ...good(), operation: 'drop' }
    await expect(post()).rejects.toSatisfy((e: any) => (e.statusCode ?? e.status) === 400)
    for (const operation of ['create', 'update', 'delete']) {
      body = { ...good(), operation }
      await post()
    }
    expect(inserted).toHaveLength(3)
  })
  it('malformed or oversized changes -> 400', async () => {
    body = { ...good(), changes: [{ fieldName: 1 }] }
    await expect(post()).rejects.toSatisfy((e: any) => (e.statusCode ?? e.status) === 400)
    body = { ...good(), changes: Array.from({ length: 500 }, () => ({ fieldName: 'f', oldValue: null, newValue: null })) }
    await expect(post()).rejects.toSatisfy((e: any) => (e.statusCode ?? e.status) === 400)
    expect(inserted).toHaveLength(0)
  })
})

describe('events read routes are admin-only', () => {
  const routes = [
    '../api/teams/[id]/crouton-events/index.get',
    '../api/teams/[id]/crouton-events/export.get',
    '../api/teams/[id]/crouton-operations/index.get'
  ]
  for (const r of routes) {
    it(`${r}: member 403, admin of another team 403, admin passes the gate`, async () => {
      const h = (await import(/* @vite-ignore */ r)).default as any
      fixture.roles = { 'team-a': 'member' }
      await expect(h(fakeEvent())).rejects.toSatisfy((e: any) => (e.statusCode ?? e.status) === 403)
      fixture.roles = { 'team-b': 'admin' }
      await expect(h(fakeEvent())).rejects.toSatisfy((e: any) => (e.statusCode ?? e.status) === 403)
      fixture.roles = { 'team-a': 'admin' }
      // Past the gate the handler touches the (fake) query builder; any non-403 outcome proves access.
      const out = await h(fakeEvent()).then(() => 0, (e: any) => e?.statusCode ?? e?.status ?? 0)
      expect(out).not.toBe(403)
    })
  }
})
