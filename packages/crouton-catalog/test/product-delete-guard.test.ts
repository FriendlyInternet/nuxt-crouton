import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb, installGlobals, listeners, type RequestState } from './setup-db'

// #4278 — the REAL delete route asks `crouton:catalog:before-delete-product`
// before deleting. A blocker or a throwing listener refuses with a 409 and the
// row stays. Only auth and the Nitro globals (incl. the hook bus) are stand-ins.
vi.mock('~~/server/db/schema', async () => {
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  return { user: sqliteTable('user', { id: text('id'), name: text('name'), email: text('email'), image: text('image') }) }
})
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  requireTeamAdmin: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'admin' } }),
}))

const { client, db } = createTestDb()
const req: RequestState = { params: {}, body: undefined, query: {} }
installGlobals(db, req)

const route = async () => (await import('../collections/products/server/api/teams/[id]/catalog-products/[productId].delete')).default
const rowCount = () => (client.prepare('SELECT count(*) AS n FROM catalog_products WHERE id = ?').get('kayak') as any).n
const BLOCKER = 'Still offered by 1 location: X. Remove it there first.'

beforeEach(() => {
  client.exec(`DELETE FROM catalog_products; INSERT INTO catalog_products (id, teamId, owner, "order", title, active, createdAt, updatedAt, createdBy, updatedBy) VALUES ('kayak','t1','u1',0,'Kayak',1,1,1,'u1','u1');`)
  req.params = { productId: 'kayak' }
  listeners.length = 0
})
afterEach(() => { listeners.length = 0; vi.restoreAllMocks() })

describe('catalog product delete asks before-delete-product first (#4278)', () => {
  // covers: T1
  it('G1a a listener that pushes a blocker → 409 with that message, row kept', async () => {
    const seen: any[] = []
    listeners.push((p) => { seen.push({ ...p }); p.blockers.push(BLOCKER) })
    await expect((await route())({})).rejects.toMatchObject({ status: 409, statusText: 'Product in use', message: BLOCKER })
    expect(seen[0]).toMatchObject({ teamId: 't1', productId: 'kayak' })
    expect(rowCount()).toBe(1)
  })

  // covers: T1
  it('G1b no listener → { success: true }, row gone', async () => {
    expect(await (await route())({})).toEqual({ success: true })
    expect(rowCount()).toBe(0)
  })

  // covers: T1
  it('G1c a listener that throws → 409 "could not check", row kept', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    listeners.push(() => { throw new Error('db down') })
    await expect((await route())({})).rejects.toMatchObject({
      status: 409,
      statusText: 'Product in use check failed',
      message: 'Could not check whether this product is still in use. Nothing was deleted.',
    })
    expect(rowCount()).toBe(1)
  })

  // covers: T1
  it('G1d the blockers 409 is not turned into the "could not check" one; several blockers are joined', async () => {
    listeners.push((p) => { p.blockers.push(BLOCKER) })
    listeners.push((p) => { p.blockers.push('Also used elsewhere.') })
    const err: any = await (await route())({}).catch((e: any) => e)
    expect(err.status).toBe(409)
    expect(err.statusText).toBe('Product in use')
    expect(err.message).toBe(`${BLOCKER} Also used elsewhere.`)
    expect(rowCount()).toBe(1)
  })
})
