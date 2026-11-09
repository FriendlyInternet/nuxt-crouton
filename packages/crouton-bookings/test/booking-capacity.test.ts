import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, quantity integer, inventoryMode integer, offerFullDay integer);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
`

const hoisted = vi.hoisted(() => ({ role: 'admin' as string, body: {} as any, params: { bookingId: 'b1' } as any }))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: hoisted.role } }),
}))

// Reference checks (#3378) are covered in team-references.test.ts; the DB here has no auth/team tables
vi.mock('../collections/bookings/server/database/queries', () => ({ assertBookingsBookingReferences: async () => undefined }))

let db: any
const rows = () => db.$client.prepare('select * from bookings_bookings order by id').all()
const DAY = Date.parse('2026-11-09T23:00:00Z') / 1000
const book = (id: string, over: Record<string, unknown> = {}) =>
  db.$client.prepare(`insert into bookings_bookings values (@id,'t1','u1',0,@location,@date,@slot,null,@quantity,@status,1,1,'u1','u1')`)
    .run({ id, location: 's', date: DAY, slot: '["am"]', quantity: 1, status: 'active', ...over })

type Handler = (e: any) => Promise<any>
const handlers: Record<string, Handler> = {}

beforeEach(async () => {
  const client = new Database(':memory:')
  client.exec(DDL)
  db = drizzle(client)
  client.prepare(`insert into bookings_locations (id,teamId,title,slots,inventoryMode) values ('s','t1','s',?,0)`).run(JSON.stringify([{ id: 'am' }, { id: 'pm' }]))
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
