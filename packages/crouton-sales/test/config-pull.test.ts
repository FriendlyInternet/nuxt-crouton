import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureConfigWrite } from '../server/utils/config-capture'
import { applyOutboxEvents } from '../server/utils/sync-ingest'
import { pushPendingOutbox } from '../server/utils/cloud-sync-pusher'
import { collectConfigChanges, pullConfigChanges } from '../server/utils/sync-pull'
import { setClockOffset } from '../server/utils/sync-clock'
import { salesSyncOutbox, salesSyncPullState, salesSyncTombstones } from '../server/database/schema'
import { salesProducts } from '../collections/products/server/database/schema'
import { salesEvents } from '../collections/events/server/database/schema'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE sales_sync_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL DEFAULT 'upsert', order_id TEXT, team_id TEXT, event_id TEXT, payload TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), synced_at INTEGER);
    CREATE TABLE sales_sync_tombstones (id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, team_id TEXT NOT NULL, deleted_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX uq_t ON sales_sync_tombstones(entity_type, entity_id);
    CREATE TABLE sales_sync_pull_state (id TEXT PRIMARY KEY NOT NULL, cursor INTEGER NOT NULL, skip INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
    CREATE TABLE sales_products (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, owner TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0, eventId TEXT NOT NULL, categoryId TEXT NOT NULL, locationId TEXT NOT NULL, title TEXT NOT NULL, description TEXT, price REAL NOT NULL, isActive INTEGER, requiresRemark INTEGER, remarkPrompt TEXT, hasOptions INTEGER, multipleOptionsAllowed INTEGER, options TEXT, createdAt INTEGER, updatedAt INTEGER NOT NULL, createdBy TEXT, updatedBy TEXT);
    CREATE TABLE sales_events (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, owner TEXT NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL, description TEXT, eventType TEXT, startDate INTEGER, endDate INTEGER, status TEXT NOT NULL, isCurrent INTEGER, requiresClient INTEGER, helperPin TEXT, currency TEXT, metadata TEXT, archivedAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, createdBy TEXT NOT NULL, updatedBy TEXT NOT NULL);
  `)
  return drizzle(sqlite)
}

const T0 = 1_700_000_000_000
const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', teamId: 'A', owner: 'u', eventId: 'ev1', categoryId: 'c', locationId: 'l',
  title: 'Beer', price: 3, createdBy: 'u', updatedBy: 'u', ...over,
})

describe('cloud → till config pull', () => {
  let till: ReturnType<typeof makeDb>
  let cloud: ReturnType<typeof makeDb>
  const tables: any = { event: salesEvents, product: salesProducts }
  const tombstones = salesSyncTombstones

  const prices = (db: ReturnType<typeof makeDb>) =>
    Object.fromEntries(db.select().from(salesProducts).all().map(r => [r.id, r.price]))
  const ids = (db: ReturnType<typeof makeDb>) => db.select().from(salesProducts).all().map(r => r.id).sort()

  /** Pull through the real pull loop, with the cloud answered by collectConfigChanges. */
  const pull = (limit?: number, maxPages?: number) => pullConfigChanges(till, {
    url: 'http://cloud/ingest', deviceId: 'till-1', deviceSecret: 's', limit, maxPages, tables, tombstones,
    pullFetcher: async (_u, init: any) => collectConfigChanges(cloud, 'A', Number(init.query.since), { limit: init.query.limit, skip: init.query.skip, tables, tombstones }),
  })

  /** Push the till's outbox to the cloud through the real pusher. */
  const push = () => pushPendingOutbox(till, {
    url: 'http://cloud/ingest', deviceId: 'till-1', deviceSecret: 's',
    fetcher: async (_u, init: any) => {
      const res = await applyOutboxEvents(cloud, init.body.events, tables, 'A', { deviceId: 'till-1', tombstones })
      return { ...res, serverNow: Date.now() } as any
    },
  })

  beforeEach(() => {
    vi.stubEnv('CROUTON_SALES_CLOUD_SYNC', '1')
    setClockOffset(0)
    till = makeDb()
    cloud = makeDb()
    for (const db of [till, cloud]) {
      db.insert(salesEvents).values({ id: 'ev1', teamId: 'A', owner: 'u', title: 'Fest', slug: 'fest', status: 'draft', createdBy: 'u', updatedBy: 'u', createdAt: new Date(T0), updatedAt: new Date(T0) } as any).run()
      db.insert(salesProducts).values({ ...product(), updatedAt: new Date(T0) } as any).run()
    }
  })

  it('a product added online appears on the till within one pull', async () => {
    cloud.insert(salesProducts).values({ ...product({ id: 'p2', title: 'Wine' }), updatedAt: new Date(T0 + 60_000) } as any).run()
    const res = await pull()
    expect(res.applied).toBeGreaterThanOrEqual(1)
    expect(ids(till)).toEqual(['p1', 'p2'])
    expect(till.select().from(salesProducts).where(eq(salesProducts.id, 'p2')).all()[0].title).toBe('Wine')
  })

  it('a product deleted online disappears from the till and stays gone', async () => {
    await captureConfigWrite(cloud, { entityType: 'product', operation: 'delete', entityId: 'p1', teamId: 'A', now: T0 + 60_000 })
    cloud.delete(salesProducts).run()
    await pull()
    expect(ids(till)).toEqual([])
    expect(till.select().from(salesSyncTombstones).all()).toHaveLength(1)
    // A second pull changes nothing and does not bring it back.
    await pull()
    expect(ids(till)).toEqual([])
  })

  it('a cloud delete marker is written even though cloud sync is off there', async () => {
    vi.stubEnv('CROUTON_SALES_CLOUD_SYNC', '')
    await captureConfigWrite(cloud, { entityType: 'product', operation: 'delete', entityId: 'p1', teamId: 'A', now: T0 + 60_000 })
    expect(cloud.select().from(salesSyncTombstones).all()).toHaveLength(1)
    expect(cloud.select().from(salesSyncOutbox).all()).toEqual([])
  })

  it('pulled changes are not echoed back into the outbox', async () => {
    cloud.update(salesProducts).set({ price: 8, updatedAt: new Date(T0 + 60_000) } as any).run()
    await pull()
    expect(prices(till)).toEqual({ p1: 8 })
    expect(till.select().from(salesSyncOutbox).all()).toEqual([])
  })

  it('a newer till edit survives an older cloud edit', async () => {
    cloud.update(salesProducts).set({ price: 8, updatedAt: new Date(T0 + 60_000) } as any).run()
    till.update(salesProducts).set({ price: 4, updatedAt: new Date(T0 + 120_000) } as any).run()
    const res = await pull()
    expect(prices(till)).toEqual({ p1: 4 })
    expect(res.kept.filter(k => k.entityType === 'product')).toMatchObject([{ entityId: 'p1', reason: 'older' }])
  })

  it('a till edit made during a live event survives a newer cloud edit', async () => {
    for (const db of [till, cloud]) db.update(salesEvents).set({ status: 'active' }).run()
    till.update(salesProducts).set({ price: 4, updatedAt: new Date(T0 + 60_000) } as any).run()
    cloud.update(salesProducts).set({ price: 8, updatedAt: new Date(T0 + 120_000) } as any).run()
    const res = await pull()
    expect(prices(till)).toEqual({ p1: 4 })
    expect(res.kept.find(k => k.entityId === 'p1')?.reason).toBe('till-wins-live')
  })

  it('an equal timestamp keeps the till version on both sides', async () => {
    till.update(salesProducts).set({ price: 4, updatedAt: new Date(T0 + 60_000) } as any).run()
    cloud.update(salesProducts).set({ price: 8, updatedAt: new Date(T0 + 60_000) } as any).run()
    await pull()
    expect(prices(till)).toEqual({ p1: 4 })
    // Pushing the till's row to the cloud makes the cloud take it (tie → the till's device id wins).
    await captureConfigWrite(till, { entityType: 'product', operation: 'update', entityId: 'p1', teamId: 'A', data: { price: 4 }, now: T0 + 60_000 })
    await push()
    expect(prices(cloud)).toEqual({ p1: 4 })
  })

  it('a stale cloud edit cannot bring back a row the till deleted more recently', async () => {
    await captureConfigWrite(till, { entityType: 'product', operation: 'delete', entityId: 'p1', teamId: 'A', now: T0 + 120_000 })
    till.delete(salesProducts).run()
    cloud.update(salesProducts).set({ price: 8, updatedAt: new Date(T0 + 60_000) } as any).run()
    await pull()
    expect(ids(till)).toEqual([])
  })

  it('both sides edit the same rows and converge to identical state', async () => {
    // Cloud: edits p1, adds p2, adds p3. Till: edits p1 later, deletes nothing, adds p4.
    cloud.update(salesProducts).set({ price: 8, updatedAt: new Date(T0 + 60_000) } as any).run()
    cloud.insert(salesProducts).values({ ...product({ id: 'p2', title: 'Wine' }), updatedAt: new Date(T0 + 61_000) } as any).run()
    cloud.insert(salesProducts).values({ ...product({ id: 'p3', title: 'Cola' }), updatedAt: new Date(T0 + 62_000) } as any).run()
    await captureConfigWrite(till, { entityType: 'product', operation: 'update', entityId: 'p1', teamId: 'A', data: { price: 4 }, now: T0 + 120_000 })
    till.update(salesProducts).set({ price: 4, updatedAt: new Date(T0 + 120_000) } as any).run()
    const p4 = product({ id: 'p4', title: 'Fries' })
    till.insert(salesProducts).values({ ...p4, updatedAt: new Date(T0 + 121_000) } as any).run()
    await captureConfigWrite(till, { entityType: 'product', operation: 'create', entityId: 'p4', teamId: 'A', data: p4, now: T0 + 121_000 })
    // Cloud then deletes p3 at T0+130s.
    await captureConfigWrite(cloud, { entityType: 'product', operation: 'delete', entityId: 'p3', teamId: 'A', now: T0 + 130_000 })
    cloud.delete(salesProducts).where(eq(salesProducts.id, 'p3')).run()

    await push()
    await pull()
    await push()
    await pull()

    const rows = (db: ReturnType<typeof makeDb>) => db.select().from(salesProducts).all()
      .map(r => ({ id: r.id, title: r.title, price: r.price })).sort((a, b) => a.id.localeCompare(b.id))
    expect(rows(till)).toEqual(rows(cloud))
    expect(rows(cloud)).toEqual([
      { id: 'p1', title: 'Beer', price: 4 },
      { id: 'p2', title: 'Wine', price: 3 },
      { id: 'p4', title: 'Fries', price: 3 },
    ])
    const marks = (db: ReturnType<typeof makeDb>) => db.select().from(salesSyncTombstones).all().map(m => m.entityId)
    expect(marks(till)).toEqual(['p3'])
    expect(marks(cloud)).toEqual(['p3'])
  })

  it('pages through more changes than one page holds and saves the cursor', async () => {
    for (let i = 0; i < 5; i++) {
      cloud.insert(salesProducts).values({ ...product({ id: `n${i}` }), updatedAt: new Date(T0 + (i + 1) * 60_000) } as any).run()
    }
    const res = await pull(2, 10)
    expect(res.pages).toBeGreaterThan(1)
    expect(ids(till)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'p1'])
    const [state] = till.select().from(salesSyncPullState).all()
    expect(state.cursor).toBe(T0 + 5 * 60_000)
    // The next pull starts from the saved cursor and finds nothing new.
    const again = await pull()
    expect(again.cursor).toBe(T0 + 5 * 60_000)
  })

  it('only the device team\'s rows come down', async () => {
    cloud.insert(salesProducts).values({ ...product({ id: 'x1', teamId: 'B' }), updatedAt: new Date(T0 + 60_000) } as any).run()
    await pull()
    expect(ids(till)).toEqual(['p1'])
  })

  it('a till without a device identity does not pull', async () => {
    const res = await pullConfigChanges(till, {
      url: 'http://cloud/ingest', secret: 'k', tables, tombstones,
      pullFetcher: async () => { throw new Error('should not be called') },
    })
    expect(res.pages).toBe(0)
  })
})
