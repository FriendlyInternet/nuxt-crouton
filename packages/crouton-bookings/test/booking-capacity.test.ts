import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sql } from 'drizzle-orm'

const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, offerFullDay integer, products text);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null, product text);
`

const hoisted = vi.hoisted(() => ({ role: 'admin' as string, body: {} as any, params: { bookingId: 'b1' } as any }))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: hoisted.role } }),
  requireTeamAdmin: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: hoisted.role } }),
}))

// Reference checks (#3378) are covered in team-references.test.ts; the DB here has no auth/team tables
vi.mock('../collections/bookings/server/database/queries', () => ({ assertBookingsBookingReferences: async () => undefined }))

let db: any
const rows = () => db.$client.prepare('select * from bookings_bookings order by id').all()
const DAY = Date.parse('2026-11-09T23:00:00Z') / 1000
// Hand-built bookings carry their location's product (#4061); pass product: null for an old row
const book = (id: string, over: Record<string, unknown> = {}) =>
  db.$client.prepare(`insert into bookings_bookings values (@id,'t1','u1',0,@location,@date,@slot,null,@quantity,@status,1,1,'u1','u1',@product)`)
    .run({ id, location: 's', date: DAY, slot: '["am"]', quantity: 1, status: 'active', product: 'loc-s', ...over })

/** A location `id` with slots (none = slotless) and products */
const mkLoc = (id: string, slotIds: string[], products: { product: string, stock: number }[], over: { offerFullDay?: number } = {}) =>
  db.$client.prepare(`insert into bookings_locations (id,teamId,title,slots,offerFullDay,products) values (?,?,?,?,?,?)`)
    .run(id, 't1', id, JSON.stringify(slotIds.map(s => ({ id: s }))), over.offerFullDay ?? 1, JSON.stringify(products))

type Handler = (e: any) => Promise<any>
const handlers: Record<string, Handler> = {}

beforeEach(async () => {
  const client = new Database(':memory:')
  client.exec(DDL)
  db = drizzle(client)
  client.prepare(`insert into bookings_locations (id,teamId,title,slots,products) values ('s','t1','s',?,?)`).run(JSON.stringify([{ id: 'am' }, { id: 'pm' }]), JSON.stringify([{ product: 'loc-s', stock: 1 }]))
  hoisted.role = 'admin'
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.statusText), e, { statusCode: e.status }))
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('assertRefsInTeam', async () => undefined)
  vi.stubGlobal('useRuntimeConfig', () => ({}))
  vi.stubGlobal('readBody', async () => hoisted.body)
  vi.stubGlobal('readValidatedBody', async () => hoisted.body)
  vi.stubGlobal('getRouterParams', () => hoisted.params)
  vi.stubGlobal('getRouterParam', (_e: any, k: string) => hoisted.params[k])
  handlers.post = (await import('../collections/bookings/server/api/teams/[id]/bookings-bookings/index.post')).default as any
  handlers.patchA = (await import('../collections/bookings/server/api/teams/[id]/bookings-bookings/[bookingId].patch')).default as any
  handlers.patchB = (await import('../server/api/crouton-bookings/teams/[id]/bookings/[bookingId]/index.patch')).default as any
})
afterEach(() => { db.$client.close(); vi.unstubAllGlobals() })

const send = (h: string, body: any) => { hoisted.body = body; return handlers[h]!({}) }

/** Does the real SQL guard let `qty` of `product` into `slotIds` at `loc` on DAY? */
async function fits(loc: string, slotIds: string[], qty: number, product = 'P'): Promise<boolean> {
  const { LOCATION_COLS, validateSelection, guardSql, dayRange } = await import('../server/utils/booking-capacity')
  const { bookingsLocations } = await import('../collections/locations/server/database/schema')
  const { eq } = await import('drizzle-orm')
  const [l] = await db.select(LOCATION_COLS).from(bookingsLocations).where(eq(bookingsLocations.id as any, loc))
  const selection = validateSelection(l, slotIds, qty, product)
  const range = dayRange('2026-11-10', 'Europe/Brussels')!
  const [r] = await db.all(sql`SELECT (${guardSql({ teamId: 't1', locationId: loc, range, selection })}) AS ok`)
  return r.ok === 1
}
/** How many of `product` the SQL guard still lets into `slotId` ('' = no slot sent); largest qty that fits, up to 20 */
async function left(loc: string, slotId: string, product = 'P'): Promise<number> {
  let n = 0
  while (n < 20 && await fits(loc, slotId ? [slotId] : [], n + 1, product)) n++
  return n
}

describe('SQL guard counts stock per product, per slot (#4061)', () => {
  // covers: T3
  it('reproduction: stock 3 takes a 2nd am booking; product Q fits where P is full', async () => {
    mkLoc('c', ['am', 'pm'], [{ product: 'P', stock: 3 }])
    mkLoc('pq', ['am', 'pm'], [{ product: 'P', stock: 1 }, { product: 'Q', stock: 1 }])
    await send('post', { location: 'c', date: '2026-11-10', slot: ['am'], product: 'P' })
    await send('post', { location: 'c', date: '2026-11-10', slot: ['am'], product: 'P' })
    await send('post', { location: 'pq', date: '2026-11-10', slot: ['am'], product: 'P' })
    await send('post', { location: 'pq', date: '2026-11-10', slot: ['am'], product: 'Q' })
    await expect(send('post', { location: 'pq', date: '2026-11-10', slot: ['am'], product: 'Q' })).rejects.toMatchObject({ status: 409 })
    expect(rows().filter((r: any) => r.location === 'c')).toHaveLength(2)
  })

  // covers: T3
  it('C1 stock 3, 2 booked in am → am 1, pm 3, full day 1', async () => {
    mkLoc('c', ['am', 'pm'], [{ product: 'P', stock: 3 }])
    book('a', { location: 'c', product: 'P' }); book('b', { location: 'c', product: 'P' })
    expect([await left('c', 'am'), await left('c', 'pm'), await left('c', 'all-day')]).toEqual([1, 3, 1])
  })

  // covers: T3
  it('C2 stock 5, 1 full-day booking → am 4, pm 4, full day 4 (all-day, [] and null slot)', async () => {
    for (const [i, slot] of ['["all-day"]', '[]', 'null'].entries()) {
      mkLoc(`c${i}`, ['am', 'pm'], [{ product: 'P', stock: 5 }])
      book(`f${i}`, { location: `c${i}`, product: 'P', slot })
      expect([await left(`c${i}`, 'am'), await left(`c${i}`, 'pm'), await left(`c${i}`, 'all-day')]).toEqual([4, 4, 4])
    }
  })

  // covers: T3
  it('C3 stock 3, 2 in am then 1 full day → am 0, pm 2, full day 0', async () => {
    mkLoc('c', ['am', 'pm'], [{ product: 'P', stock: 3 }])
    book('a', { location: 'c', product: 'P' }); book('b', { location: 'c', product: 'P' })
    book('f', { location: 'c', product: 'P', slot: '["all-day"]' })
    expect([await left('c', 'am'), await left('c', 'pm'), await left('c', 'all-day')]).toEqual([0, 2, 0])
  })

  // covers: T3
  it('C4 no slots, stock 8, 2 booked → 6 (stored slot null or all-day)', async () => {
    mkLoc('inv', [], [{ product: 'P', stock: 8 }], { offerFullDay: 0 })
    mkLoc('day', [], [{ product: 'P', stock: 8 }], { offerFullDay: 0 })
    book('i', { location: 'inv', product: 'P', slot: 'null', quantity: 2 })
    book('d', { location: 'day', product: 'P', slot: '["all-day"]', quantity: 2 })
    expect(await left('inv', '')).toBe(6)
    expect(await left('day', '')).toBe(6)
  })

  // covers: T3
  it('C5 stock 1, three slots, the first booked → first 0, others 1, full day 0', async () => {
    mkLoc('c', ['s1', 's2', 's3'], [{ product: 'P', stock: 1 }])
    book('a', { location: 'c', product: 'P', slot: '["s1"]' })
    expect([await left('c', 's1'), await left('c', 's2'), await left('c', 's3'), await left('c', 'all-day')]).toEqual([0, 1, 1, 0])
  })

  // covers: T3
  it('C6 one booking holding am and pm counts once in each', async () => {
    mkLoc('c', ['am', 'pm'], [{ product: 'P', stock: 2 }])
    book('a', { location: 'c', product: 'P', slot: '["am","pm"]' })
    expect([await left('c', 'am'), await left('c', 'pm')]).toEqual([1, 1])
  })

  // covers: T3
  it('C7 cancelled, other-product and other-day bookings do not count', async () => {
    mkLoc('c', ['am'], [{ product: 'P', stock: 1 }, { product: 'Q', stock: 1 }])
    book('x', { location: 'c', product: 'P', status: 'cancelled' })
    book('q', { location: 'c', product: 'Q' })
    book('d', { location: 'c', product: 'P', date: DAY + 86400 })
    expect(await left('c', 'am')).toBe(1)
    expect(await left('c', 'am', 'Q')).toBe(0)
  })

  // covers: T3
  it('C10b full-day request at stock 1 with the morning booked → 409', async () => {
    mkLoc('c', ['am', 'pm'], [{ product: 'P', stock: 1 }])
    book('a', { location: 'c', product: 'P' })
    await expect(send('post', { location: 'c', date: '2026-11-10', slot: ['all-day'], product: 'P' })).rejects.toMatchObject({ status: 409 })
    expect(rows()).toHaveLength(1)
  })

  // covers: T3
  it('C13 full-day request at stock 2 with one am booked → stored', async () => {
    mkLoc('c', ['am', 'pm'], [{ product: 'P', stock: 2 }])
    book('a', { location: 'c', product: 'P' })
    const r = await send('post', { location: 'c', date: '2026-11-10', slot: ['all-day'], product: 'P' })
    expect(r.slot).toEqual(['all-day'])
    expect(await left('c', 'am')).toBe(0)
    expect(await left('c', 'pm')).toBe(1)
  })

  // covers: T3
  it('C10c a booking with product NULL counts against every product', async () => {
    mkLoc('c', ['am'], [{ product: 'P', stock: 1 }, { product: 'Q', stock: 2 }])
    book('n', { location: 'c', product: null })
    expect(await left('c', 'am')).toBe(0)
    expect(await left('c', 'am', 'Q')).toBe(1)
  })

  // covers: T3
  it('C11 product unlisted between validation and insert → 409, no row', async () => {
    mkLoc('c', ['am'], [{ product: 'P', stock: 5 }])
    const { LOCATION_COLS, validateSelection, guardSql, guardedInsert, runAtomic, dayRange } = await import('../server/utils/booking-capacity')
    const { bookingsLocations } = await import('../collections/locations/server/database/schema')
    const { eq } = await import('drizzle-orm')
    const [l] = await db.select(LOCATION_COLS).from(bookingsLocations).where(eq(bookingsLocations.id as any, 'c'))
    const selection = validateSelection(l, ['am'], 1, 'P')
    db.$client.prepare(`update bookings_locations set products = ? where id = 'c'`).run(JSON.stringify([{ product: 'Q', stock: 5 }]))
    const range = dayRange('2026-11-10', 'Europe/Brussels')!
    const insert = guardedInsert({ id: 'n', teamId: 't1', owner: 'u1', location: 'c', storedTs: range.storedTs, slot: selection.slot, group: null, quantity: 1, status: 'active', product: 'P', by: 'u1', nowTs: 1 }, guardSql({ teamId: 't1', locationId: 'c', range, selection }))
    await expect(runAtomic(db, [insert])).rejects.toMatchObject({ status: 409 })
    expect(rows()).toHaveLength(0)
  })

  // covers: T3
  it('C12 generic POST at a slot location with the admin form default (quantity 1) → stored; quantity 0 → 400', async () => {
    mkLoc('c', ['am'], [{ product: 'P', stock: 1 }])
    const r = await send('post', { location: 'c', date: '2026-11-10', slot: ['am'], quantity: 1, status: 'active', group: '' })
    expect(r).toMatchObject({ location: 'c', quantity: 1, product: 'P' })
    await expect(send('post', { location: 'c', date: '2026-11-10', slot: ['am'], quantity: 0, status: 'active' })).rejects.toMatchObject({ status: 400 })
  })

  // covers: T3
  it('moving an old quantity-0 row works and stores quantity 1', async () => {
    book('b1', { slot: '["pm"]', quantity: 0 })
    const r = await send('patchA', { slot: ['am'] })
    expect(r).toMatchObject({ slot: ['am'], quantity: 1 })
  })

  // covers: T3
  it('moving an old quantity-0 row while sending its stored quantity 0 back (admin form) works and stores quantity 1', async () => {
    book('b1', { slot: '["pm"]', quantity: 0 })
    const r = await send('patchA', { location: 's', date: '2026-11-10', slot: ['am'], quantity: 0, status: 'active' })
    expect(r).toMatchObject({ slot: ['am'], quantity: 1 })
    expect(rows().find((x: any) => x.id === 'b1').quantity).toBe(1)
  })
})

describe('generic booking writes respect capacity (#3379)', () => {
  it('POST refuses a booking over capacity and ignores teamId/owner in the body', async () => {
    book('x')
    await expect(send('post', { location: 's', date: '2026-11-10', slot: ['am'] })).rejects.toMatchObject({ status: 409 })
    await send('post', { location: 's', date: '2026-11-10', slot: ['pm'], teamId: 'evil', owner: 'evil' })
    const r = rows().find((x: any) => x.id !== 'x')
    expect(r).toMatchObject({ teamId: 't1', owner: 'u1', date: DAY })
  })

  for (const h of ['patchA', 'patchB'] as const) {
    describe(h, () => {
      it('moving onto a full slot is 409', async () => {
        book('b1', { slot: '["pm"]' }); book('b2')
        await expect(send(h, { slot: h === 'patchB' ? 'am' : ['am'] })).rejects.toMatchObject({ status: 409 })
        expect(rows().find((x: any) => x.id === 'b1').slot).toBe('["pm"]')
      })
      it('re-activating a cancelled booking on a full slot is 409', async () => {
        book('b1', { status: 'cancelled' }); book('b2')
        await expect(send(h, { status: h === 'patchB' ? 'confirmed' : 'active' })).rejects.toMatchObject({ status: 409 })
      })
      it('changing only the group on a full slot is fine (no self-count)', async () => {
        book('b1')
        const r = await send(h, { group: 'g1' })
        expect(r.group).toBe('g1')
      })
      it('moving to a free slot works', async () => {
        book('b1')
        const r = await send(h, { slot: h === 'patchB' ? 'pm' : ['pm'] })
        expect(r.slot).toEqual(['pm'])
      })
    })
  }
})
