import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, installGlobals, type RequestState } from './setup-db'

// Rule: only an admin of the team may create, change or delete a product; any
// member may read. Runs the REAL route handlers over an in-memory SQLite. Only
// the auth helpers (switchable role) and the Nitro globals are stand-ins;
// requireTeamAdmin mirrors the real one: 403 unless admin/owner.
vi.mock('~~/server/db/schema', async () => {
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  return { user: sqliteTable('user', { id: text('id'), name: text('name'), email: text('email'), image: text('image') }) }
})
const h = vi.hoisted(() => ({ role: 'member' }))
const ctx = () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: h.role } })
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ctx(),
  requireTeamAdmin: async () => {
    if (h.role !== 'admin' && h.role !== 'owner') throw Object.assign(new Error('Forbidden'), { status: 403 })
    return ctx()
  },
}))

const { client, db } = createTestDb()
client.exec(`INSERT INTO catalog_products (id, teamId, owner, "order", title, active, createdAt, updatedAt, createdBy, updatedBy) VALUES ('p1','t1','u1',0,'Court',1,1,1,'u1','u1');`)
const req: RequestState = { params: {}, body: undefined, query: {} }
installGlobals(db, req)

const R = '../collections/products/server/api/teams/[id]/catalog-products'
const route = async (p: string) => (await import(`${R}/${p}`)).default
const status = (p: Promise<any>) => p.then(() => 200, (e: any) => e.status)

beforeEach(() => {
  h.role = 'member'
  req.params = { productId: 'p1' }
  req.body = { title: 'Changed' }
  req.query = {}
})

describe('catalog products access', () => {
  it('member: GET → 200 and lists the team\'s products', async () => {
    const rows = await (await route('index.get'))({})
    expect(rows.map((r: any) => r.id)).toEqual(['p1'])
  })

  for (const mod of ['index.post', '[productId].patch', '[productId].delete']) {
    it(`member: ${mod} → 403, row unchanged`, async () => {
      expect(await status((await route(mod))({}))).toBe(403)
      const row = client.prepare('SELECT title FROM catalog_products WHERE id = ?').get('p1') as any
      expect(row.title).toBe('Court')
      expect((client.prepare('SELECT count(*) AS n FROM catalog_products').get() as any).n).toBe(1)
    })
  }

  it('admin: POST creates the row under team t1', async () => {
    h.role = 'admin'
    req.body = { title: 'Kayak', teamId: 'other', active: true }
    const created = await (await route('index.post'))({})
    expect(created.teamId).toBe('t1')
    const row = client.prepare('SELECT teamId, title, owner FROM catalog_products WHERE id = ?').get(created.id) as any
    expect(row).toEqual({ teamId: 't1', title: 'Kayak', owner: 'u1' })
  })
})
