import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildConfigEvent, captureConfigWrite } from '../server/utils/config-capture'
import { applyOutboxEvents } from '../server/utils/sync-ingest'
import { pushPendingOutbox } from '../server/utils/cloud-sync-pusher'
import { getClockOffset, setClockOffset } from '../server/utils/sync-clock'
import { salesSyncOutbox, salesSyncTombstones } from '../server/database/schema'
import { salesProducts } from '../collections/products/server/database/schema'
import { salesEvents } from '../collections/events/server/database/schema'

/** Real in-memory SQLite: a "till" and a "cloud", each with just the tables the sync touches. */
function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE sales_sync_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL DEFAULT 'upsert', order_id TEXT, team_id TEXT, event_id TEXT, payload TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), synced_at INTEGER);
    CREATE TABLE sales_sync_tombstones (id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, team_id TEXT NOT NULL, deleted_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX uq_t ON sales_sync_tombstones(entity_type, entity_id);
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

describe('config capture → ingest', () => {
  let till: ReturnType<typeof makeDb>
  let cloud: ReturnType<typeof makeDb>
  const tables: any = { product: salesProducts, event: salesEvents }
  const ingestOpts = { tombstones: salesSyncTombstones }

  /** Push the till's pending outbox to the cloud through the real pusher. */
  async function sync(opts: { serverNow?: number } = {}) {
    let conflicts: unknown[] = []
    await pushPendingOutbox(till, {
      url: 'http://cloud', secret: 'k',
      fetcher: async (_u, init: any) => {
        const res = await applyOutboxEvents(cloud, init.body.events, tables, 'A', ingestOpts)
        conflicts = res.conflicts ?? []
        return { ...res, serverNow: opts.serverNow ?? Date.now() } as any
      },
    })
    return conflicts
  }

  beforeEach(() => {
    vi.stubEnv('CROUTON_SALES_CLOUD_SYNC', '1')
    setClockOffset(0)
    till = makeDb()
    cloud = makeDb()
    cloud.insert(salesEvents).values({ id: 'ev1', teamId: 'A', owner: 'u', title: 'Fest', slug: 'fest', status: 'draft', createdBy: 'u', updatedBy: 'u', updatedAt: new Date(T0) } as any).run()
    cloud.insert(salesProducts).values({ ...product(), updatedAt: new Date(T0) } as any).run()
  })

  it('an offline price edit reaches the cloud', async () => {
    await captureConfigWrite(till, { entityType: 'product', operation: 'update', entityId: 'p1', teamId: 'A', data: { price: 4.5 }, now: T0 + 60_000 })
    expect(await sync()).toEqual([])
    const [row] = cloud.select().from(salesProducts).where(eq(salesProducts.id, 'p1')).all()
    expect(row.price).toBe(4.5)
    expect(row.title).toBe('Beer')
  })

  it('a product deleted on the till is deleted in the cloud, and leaves a marker', async () => {
    await captureConfigWrite(till, { entityType: 'product', operation: 'delete', entityId: 'p1', teamId: 'A', now: T0 + 60_000 })
    expect(till.select().from(salesSyncTombstones).all()).toHaveLength(1)
    await sync()
    expect(cloud.select().from(salesProducts).all()).toEqual([])
    expect(cloud.select().from(salesSyncTombstones).all()).toHaveLength(1)
  })

  it('a new product created on the till is inserted in the cloud', async () => {
    await captureConfigWrite(till, { entityType: 'product', operation: 'create', entityId: 'p2', teamId: 'A', data: product({ id: 'p2', title: 'Wine' }), now: T0 + 5_000 })
    await sync()
    expect(cloud.select().from(salesProducts).all().map(r => r.id).sort()).toEqual(['p1', 'p2'])
  })

  it('replaying the same batch changes nothing', async () => {
    await captureConfigWrite(till, [
      { entityType: 'product', operation: 'update', entityId: 'p1', teamId: 'A', data: { price: 5 }, now: T0 + 60_000 },
      { entityType: 'product', operation: 'create', entityId: 'p2', teamId: 'A', data: product({ id: 'p2' }), now: T0 + 61_000 },
    ])
    const events = (await till.select().from(salesSyncOutbox).all()).map(r => ({ id: r.id, entityType: r.entityType as any, entityId: r.entityId, operation: r.operation, payload: r.payload as any }))
    await applyOutboxEvents(cloud, events, tables, 'A', ingestOpts)
    const first = cloud.select().from(salesProducts).all()
    const res = await applyOutboxEvents(cloud, events, tables, 'A', ingestOpts)
    expect(res.skipped).toEqual([])
    expect(cloud.select().from(salesProducts).all()).toEqual(first)
  })

  it('a stale offline edit loses to a newer cloud edit and is reported', async () => {
    cloud.update(salesProducts).set({ price: 9, updatedAt: new Date(T0 + 120_000) } as any).run()
    await captureConfigWrite(till, { entityType: 'product', operation: 'update', entityId: 'p1', teamId: 'A', data: { price: 4 }, now: T0 + 60_000 })
    const conflicts = await sync()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ entityType: 'product', entityId: 'p1', reason: 'older' })
    expect(cloud.select().from(salesProducts).all()[0].price).toBe(9)
  })

  it('a stale edit cannot bring back a row deleted more recently', async () => {
    cloud.delete(salesProducts).run()
    cloud.insert(salesSyncTombstones).values({ entityType: 'product', entityId: 'p1', teamId: 'A', deletedAt: new Date(T0 + 120_000) }).run()
    await captureConfigWrite(till, { entityType: 'product', operation: 'update', entityId: 'p1', teamId: 'A', data: { price: 4 }, now: T0 + 60_000 })
    await sync()
    expect(cloud.select().from(salesProducts).all()).toEqual([])
  })

  it('while the event is live the till wins even with an older timestamp', async () => {
    cloud.update(salesEvents).set({ status: 'active' }).run()
    cloud.update(salesProducts).set({ price: 9, updatedAt: new Date(T0 + 120_000) } as any).run()
    await captureConfigWrite(till, { entityType: 'product', operation: 'update', entityId: 'p1', teamId: 'A', data: { price: 4 }, eventId: 'ev1', now: T0 + 60_000 })
    await sync()
    expect(cloud.select().from(salesProducts).all()[0].price).toBe(4)
  })
})

describe('team isolation of delete markers', () => {
  const tables: any = { product: salesProducts, event: salesEvents }
  const ingestOpts = { tombstones: salesSyncTombstones }

  it('a till on team A cannot revive or remove team B\'s delete marker', async () => {
    const cloud = makeDb()
    cloud.insert(salesSyncTombstones).values({ id: 'm1', entityType: 'product', entityId: 'pB', teamId: 'B', deletedAt: new Date(T0) } as any).run()
    const res = await applyOutboxEvents(cloud, [
      { id: 'x1', entityType: 'product', entityId: 'pB', operation: 'update', payload: product({ id: 'pB', teamId: 'A', updatedAt: T0 + 60_000 }) },
    ], tables, 'A', ingestOpts)
    expect(res.skipped).toEqual([{ id: 'x1', reason: 'team mismatch', permanent: true }])
    expect(cloud.select().from(salesProducts).all()).toEqual([])
    expect(cloud.select().from(salesSyncTombstones).all()).toHaveLength(1)
  })

  it('a delete with no team is a permanent skip, not an empty-team marker', async () => {
    const cloud = makeDb()
    const res = await applyOutboxEvents(cloud, [
      { id: 'x2', entityType: 'product', entityId: 'p1', operation: 'delete', payload: { deletedAt: T0 } },
    ], tables, undefined, ingestOpts)
    expect(res.skipped).toEqual([{ id: 'x2', reason: 'missing team', permanent: true }])
    expect(cloud.select().from(salesSyncTombstones).all()).toEqual([])
  })

  it('a config event without a timestamp is a permanent skip', async () => {
    const cloud = makeDb()
    const res = await applyOutboxEvents(cloud, [
      { id: 'x3', entityType: 'product', entityId: 'p1', operation: 'update', payload: { price: 9, teamId: 'A' } },
    ], tables, 'A', ingestOpts)
    expect(res.skipped).toEqual([{ id: 'x3', reason: 'missing timestamp', permanent: true }])
  })
})

describe('capture details', () => {
  it('stamps the edit time on the cloud clock', () => {
    const ev = buildConfigEvent({ entityType: 'product', operation: 'update', entityId: 'p1', teamId: 'A', data: { price: 1 }, now: 1000 }, 250)
    expect(ev.payload).toMatchObject({ price: 1, teamId: 'A', updatedAt: 1250 })
    expect(buildConfigEvent({ entityType: 'product', operation: 'delete', entityId: 'p1', teamId: 'A', now: 1000 }, 250))
      .toMatchObject({ operation: 'delete', payload: { deletedAt: 1250 } })
  })

  it('writes no outbox row unless cloud sync is on, and no marker for an edit', async () => {
    vi.stubEnv('CROUTON_SALES_CLOUD_SYNC', '')
    const db = makeDb()
    await captureConfigWrite(db, { entityType: 'product', operation: 'delete', entityId: 'p1', teamId: 'A' })
    await captureConfigWrite(db, { entityType: 'product', operation: 'update', entityId: 'p2', teamId: 'A', data: { price: 1 } })
    expect(db.select().from(salesSyncOutbox).all()).toEqual([])
    // Delete markers are written on the cloud too (#815), so only the delete leaves one.
    expect(db.select().from(salesSyncTombstones).all().map(m => m.entityId)).toEqual(['p1'])
  })

  it('the pusher learns the clock offset from the ingest reply', async () => {
    vi.stubEnv('CROUTON_SALES_CLOUD_SYNC', '1')
    setClockOffset(0)
    const db = makeDb()
    await captureConfigWrite(db, { entityType: 'product', operation: 'delete', entityId: 'p1', teamId: 'A' })
    await pushPendingOutbox(db, { url: 'http://x', secret: 'k', fetcher: async () => ({ serverNow: Date.now() + 60_000, applied: [] }) })
    expect(getClockOffset()).toBeGreaterThan(59_000)
    setClockOffset(0)
  })
})
