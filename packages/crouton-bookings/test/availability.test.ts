import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

// #3139: availability only counts the requested team's bookings
const DDL = `
CREATE TABLE organization (id text primary key);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text, "group" text, quantity integer not null, product text, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
`
let handler: any
let raw: any

beforeEach(async () => {
  const client = new Database(':memory:')
  client.exec(DDL)
  const db = drizzle(client)
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.statusText), e))
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('getRouterParam', () => 't1')
  vi.stubGlobal('getQuery', () => ({ locationId: 'loc', startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-30T00:00:00.000Z' }))
  client.prepare('insert into organization values (?)').run('t1')
  const ins = client.prepare(`insert into bookings_bookings values (?,?,'u',0,'loc',1794268800,'["am"]',NULL,?,NULL,'active',1,1,'u','u')`)
  ins.run('a', 't1', 1)
  ins.run('b', 't2', 4)
  raw = client
  handler = (await import('../server/api/crouton-bookings/teams/[id]/availability.get')).default
})

describe('availability.get (#3139)', () => {
  it("another team's bookings do not appear", async () => {
    const res = await handler({})
    const days = Object.values(res) as any[]
    expect(days).toHaveLength(1)
    expect(days[0].bookedCount).toBe(1)
  })
})

// #4109 S1: each date carries its bookings per product
describe('availability.get bookings rows (#4109)', () => {
  it('returns product, quantity and slotIds per booking; full day = [all-day]; cancelled left out', async () => {
    raw.exec('delete from bookings_bookings')
    const ins = raw.prepare(`insert into bookings_bookings values (?,'t1','u',0,'loc',1794268800,?,NULL,?,?,?,1,1,'u','u')`)
    ins.run('p1', '["am"]', 1, 'P', 'active')
    ins.run('q1', null, 2, 'Q', 'active')
    ins.run('p2', '["am"]', 3, 'P', 'cancelled')
    const res = await handler({})
    const days = Object.values(res) as any[]
    expect(days).toHaveLength(1)
    expect(days[0].bookings).toHaveLength(2)
    expect(days[0].bookings).toEqual(expect.arrayContaining([
      { product: 'P', quantity: 1, slotIds: ['am'] },
      { product: 'Q', quantity: 2, slotIds: ['all-day'] },
    ]))
    expect(days[0].bookedCount).toBe(3)
    expect(days[0].bookedSlots).toEqual(['am'])
  })
})
