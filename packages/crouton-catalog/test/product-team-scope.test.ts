import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, installGlobals, type RequestState } from './setup-db'

// Rule: no request can read, change or delete another team's product. Runs the
// real queries over an in-memory SQLite.
vi.mock('~~/server/db/schema', async () => {
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  return { user: sqliteTable('user', { id: text('id'), name: text('name'), email: text('email'), image: text('image') }) }
})

const { client, db } = createTestDb()
const req: RequestState = { params: {}, body: undefined, query: {} }
installGlobals(db, req)

const q = () => import('../collections/products/server/database/queries')
const row = () => client.prepare('SELECT teamId, title FROM catalog_products WHERE id = ?').get('p1') as any

beforeEach(() => {
  client.exec(`DELETE FROM catalog_products; INSERT INTO catalog_products (id, teamId, owner, "order", title, active, createdAt, updatedAt, createdBy, updatedBy) VALUES ('p1','t1','u1',0,'Court',1,1,1,'u1','u1');`)
})

describe('catalog products team scope', () => {
  it('team t2 reads none of t1\'s products', async () => {
    const { getAllCatalogProducts, getCatalogProductsByIds } = await q()
    expect(await getAllCatalogProducts('t2')).toEqual([])
    expect(await getCatalogProductsByIds('t2', ['p1'])).toEqual([])
  })

  it('team t2 cannot change t1\'s product: 404, row unchanged', async () => {
    const { updateCatalogProduct } = await q()
    await expect(updateCatalogProduct('p1', 't2', 'u1', { title: 'X' }, { role: 'admin' })).rejects.toMatchObject({ status: 404 })
    expect(row()).toEqual({ teamId: 't1', title: 'Court' })
  })

  it('team t2 cannot delete t1\'s product: 404, row kept', async () => {
    const { deleteCatalogProduct } = await q()
    await expect(deleteCatalogProduct('p1', 't2', 'u1', { role: 'admin' })).rejects.toMatchObject({ status: 404 })
    expect(row()).toEqual({ teamId: 't1', title: 'Court' })
  })

  it('team t1 can read, change and delete its own product', async () => {
    const { getAllCatalogProducts, getCatalogProductsByIds, updateCatalogProduct, deleteCatalogProduct } = await q()
    expect((await getAllCatalogProducts('t1')).map((r: any) => r.id)).toEqual(['p1'])
    expect((await getCatalogProductsByIds('t1', ['p1'])).map((r: any) => r.id)).toEqual(['p1'])
    const updated = await updateCatalogProduct('p1', 't1', 'u1', { title: 'X' }, { role: 'admin' })
    expect(updated.title).toBe('X')
    expect(row().title).toBe('X')
    expect(await deleteCatalogProduct('p1', 't1', 'u1', { role: 'admin' })).toEqual({ success: true })
    expect(row()).toBeUndefined()
  })
})
