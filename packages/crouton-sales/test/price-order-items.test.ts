import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { orderClient, priceOrderItems } from '../server/utils/price-order-items'
import { salesProducts } from '../collections/products/server/database/schema'
import { salesClients } from '../collections/clients/server/database/schema'

/** Real in-memory SQLite with the real generated schemas, two teams (#4481). */
let db: ReturnType<typeof drizzle>

beforeEach(async () => {
  vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusText), o))
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE sales_products (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, owner TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0, eventId TEXT NOT NULL, categoryId TEXT NOT NULL, locationId TEXT NOT NULL, title TEXT NOT NULL, description TEXT, price REAL NOT NULL, isActive INTEGER, requiresRemark INTEGER, remarkPrompt TEXT, hasOptions INTEGER, multipleOptionsAllowed INTEGER, options TEXT, createdAt INTEGER, updatedAt INTEGER NOT NULL, createdBy TEXT, updatedBy TEXT);
    CREATE TABLE sales_clients (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, owner TEXT NOT NULL, title TEXT NOT NULL, isReusable INTEGER, isActive INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, createdBy TEXT NOT NULL, updatedBy TEXT NOT NULL);
  `)
  db = drizzle(sqlite)
  const base = { owner: 'u', categoryId: 'c', locationId: 'l', createdBy: 'u', updatedBy: 'u' }
  await db.insert(salesProducts).values([
    { ...base, id: 'beer', teamId: 'A', eventId: 'evA', title: 'Beer', price: 3 },
    { ...base, id: 'fries', teamId: 'A', eventId: 'evA', title: 'Fries', price: 2.5, hasOptions: true, options: [{ id: 'big', label: 'Big', priceModifier: 1.5 }] },
    { ...base, id: 'wine', teamId: 'B', eventId: 'evB', title: 'Wine', price: 5 }
  ] as any)
  await db.insert(salesClients).values([
    { id: 'clientA', teamId: 'A', owner: 'u', title: 'Table 4', isActive: true, createdBy: 'u', updatedBy: 'u' },
    { id: 'clientB', teamId: 'B', owner: 'u', title: 'Other team', isActive: true, createdBy: 'u', updatedBy: 'u' }
  ] as any)
})

const priceA = (items: any[]) =>
  priceOrderItems(db, { products: salesProducts, eventId: 'evA', teamId: 'A', items })

describe('priceOrderItems — prices come from this event\'s products, never the body', () => {
  // covers: T2
  it('prices an item from the product + option, ignoring the sent price', async () => {
    const [fries, beer] = await priceA([
      { productId: 'fries', quantity: 2, price: 0.01, selectedOptions: ['big'] },
      { productId: 'beer', quantity: 1, price: 0.01 }
    ])
    expect(fries).toEqual({ productId: 'fries', quantity: 2, unitPrice: 4, totalPrice: 8 })
    expect(beer).toEqual({ productId: 'beer', quantity: 1, unitPrice: 3, totalPrice: 3 })
  })

  // covers: T2
  it('a product of another event/team is a 400', async () => {
    await expect(priceA([{ productId: 'wine', quantity: 1 }])).rejects.toMatchObject({ status: 400, statusText: 'Unknown product' })
  })

  // covers: T2
  it('an unknown product id is a 400', async () => {
    await expect(priceA([{ productId: 'nope', quantity: 1 }])).rejects.toMatchObject({ status: 400, statusText: 'Unknown product' })
  })

  // covers: T2
  it('a quantity of 0, 1.5 or a negative number is a 400', async () => {
    for (const quantity of [0, 1.5, -1, '2' as any]) {
      await expect(priceA([{ productId: 'beer', quantity }])).rejects.toMatchObject({ status: 400, statusText: 'Invalid quantity' })
    }
  })
})

const clientA = (clientId?: unknown, clientName?: unknown) =>
  orderClient(db, { clients: salesClients, teamId: 'A', clientId, clientName })

describe('orderClient — the client must be this team\'s; its name comes from the db', () => {
  // covers: T3
  it('another team\'s client id is a 400', async () => {
    await expect(clientA('clientB', 'Other team')).rejects.toMatchObject({ status: 400, statusText: 'Unknown client' })
  })

  // covers: T3
  it('this team\'s client returns its title, not the sent name', async () => {
    expect(await clientA('clientA', 'Fake')).toEqual({ clientId: 'clientA', clientName: 'Table 4' })
  })

  // covers: T3
  it('without an id, a walk-in name is trimmed', async () => {
    expect(await clientA(undefined, '  Walk-in  ')).toEqual({ clientId: null, clientName: 'Walk-in' })
  })

  // covers: T3
  it('without an id and with a blank name, the name is null', async () => {
    expect(await clientA(undefined, '   ')).toEqual({ clientId: null, clientName: null })
    expect(await clientA('', undefined)).toEqual({ clientId: null, clientName: null })
  })
})
