import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

// #3139: availability only counts the requested team's bookings
const DDL = `
CREATE TABLE organization (id text primary key);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
`
let handler: any

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
  const ins = client.prepare(`insert into bookings_bookings values (?,?,'u',0,'loc',1794268800,'["am"]',NULL,?,'active',1,1,'u','u')`)
  ins.run('a', 't1', 1)
  ins.run('b', 't2', 4)
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
