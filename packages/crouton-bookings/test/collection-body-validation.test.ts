import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

const hoisted = vi.hoisted(() => ({
  member: { team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'admin' } },
  assertRef: vi.fn(async (..._a: any[]) => undefined),
  create: vi.fn(async (d: any) => d),
  update: vi.fn(async (..._a: any[]) => ({})),
  existing: vi.fn(async (..._a: any[]) => [] as any[]),
  guarded: vi.fn(async (..._a: any[]) => ({}))
}))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({ resolveTeamAndCheckMembership: async () => hoisted.member }))
vi.mock('../collections/bookings/server/database/queries', () => ({ assertBookingsBookingReferences: hoisted.assertRef }))
// The bookings write path is the capacity-guarded one (#3379); its own cases live in booking-capacity.test.ts
vi.mock('../server/utils/booking-capacity', async (orig) => ({ ...(await orig() as object), patchBookingGuarded: hoisted.guarded }))
vi.mock('../collections/locations/server/database/queries', () => ({ updateBookingsLocation: hoisted.update, getBookingsLocationsByIds: hoisted.existing, createBookingsLocation: hoisted.create }))
vi.mock('../collections/settings/server/database/queries', () => ({ createBookingsSetting: hoisted.create, updateBookingsSetting: hoisted.update }))
vi.mock('../collections/emailtemplates/server/database/queries', () => ({ assertBookingsEmailtemplateReferences: hoisted.assertRef, createBookingsEmailtemplate: hoisted.create, updateBookingsEmailtemplate: hoisted.update, getBookingsEmailtemplatesByIds: hoisted.existing }))
vi.mock('../collections/emaillogs/server/database/queries', () => ({ assertBookingsEmaillogReferences: hoisted.assertRef, createBookingsEmaillog: hoisted.create, updateBookingsEmaillog: hoisted.update }))

const DDL = `
CREATE TABLE bookings_locations (id text primary key, teamId text not null, title text, street text, city text, content text, translations text, slots text, maxBookingsPerMonth integer, quantity integer, inventoryMode integer, offerFullDay integer);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text not null, "order" integer not null, location text not null, date integer not null, slot text not null, "group" text, quantity integer not null, status text not null, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);
`
// Real in-memory DB: the bookings POST writes through the capacity guard, not create()
const makeDb = (withLocation: boolean) => {
  const client = new Database(':memory:')
  client.exec(DDL)
  if (withLocation) client.prepare(`insert into bookings_locations (id,teamId,title,slots,inventoryMode) values ('l1','t1','s',?,0)`).run(JSON.stringify([{ id: 'a' }]))
  return drizzle(client) as any
}
const bookingRows = (db: any) => db.$client.prepare('select * from bookings_bookings').all()

let body: unknown
let params: Record<string, string> = {}
const run = async (path: string) => (await import(path)).default({})

beforeEach(() => {
  hoisted.create.mockClear(); hoisted.update.mockClear(); hoisted.guarded.mockClear(); hoisted.existing.mockClear()
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.statusText), e))
  vi.stubGlobal('getRouterParams', () => params)
  vi.stubGlobal('useRuntimeConfig', () => ({}))
  vi.stubGlobal('useDB', () => ({}))
  vi.stubGlobal('readValidatedBody', async (_e: any, parse: (b: unknown) => unknown) => parse(body))
})
afterEach(() => vi.unstubAllGlobals())

const B = 'collections/bookings/server/api/teams/[id]/bookings-bookings'
const L = 'collections/locations/server/api/teams/[id]/bookings-locations'
const S = 'collections/settings/server/api/teams/[id]/bookings-settings'
const E = 'collections/emailtemplates/server/api/teams/[id]/bookings-emailtemplates'
const G = 'collections/emaillogs/server/api/teams/[id]/bookings-emaillogs'
const goodBooking = { location: 'l1', date: '2026-11-10T00:00:00.000Z', slot: ['a'], quantity: 1, status: 'pending' }

describe('package collection body validation (#3377)', () => {
  it('bookings POST rejects a wrong-typed body and does not insert', async () => {
    body = { ...goodBooking, quantity: 'not-a-number' }
    const db = makeDb(true)
    vi.stubGlobal('useDB', () => db)
    await expect(run(`../${B}/index.post`)).rejects.toThrow()
    expect(bookingRows(db)).toHaveLength(0)
  })

  it('bookings POST strips system/unknown keys and keeps server-set fields', async () => {
    const db = makeDb(true)
    vi.stubGlobal('useDB', () => db)
    body = { ...goodBooking, order: 999, createdAt: '1999-01-01', bogus: {}, teamId: 'other' }
    await run(`../${B}/index.post`)
    const rows = bookingRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].order).not.toBe(999)
    expect(rows[0].createdAt).not.toBe(Date.parse('1999-01-01'))
    expect(rows[0].createdAt).toBeGreaterThan(Date.parse('2020-01-01') / 1000 - 1)
    expect(rows[0]).not.toHaveProperty('bogus')
    expect(rows[0].teamId).toBe('t1')
    expect(rows[0].owner).toBe('u1')
  })

  it('bookings PATCH strips unknown keys, accepts the cancel body and rejects a bad type', async () => {
    params = { bookingId: 'b1' }
    body = { status: 'cancelled', teamId: 'other', bogus: 1 }
    await run(`../${B}/[bookingId].patch`)
    const patch = hoisted.guarded.mock.calls[0]![1].patch
    expect(patch).toMatchObject({ status: 'cancelled' })
    expect(hoisted.guarded.mock.calls[0]![1].teamId).toBe('t1')
    expect(JSON.stringify(patch)).not.toContain('bogus')
    body = { quantity: 'x' }
    await expect(run(`../${B}/[bookingId].patch`)).rejects.toThrow()
  })

  it('emailtemplates POST accepts the admin-page payload', async () => {
    body = { name: 'n', subject: 's', body: 'b', fromEmail: '', triggerType: 'booking_created', recipientType: 'customer', isActive: true, daysOffset: 0, locationId: null, translations: undefined }
    await run(`../${E}/index.post`)
    expect(hoisted.create).toHaveBeenCalledTimes(1)
  })

  it('locations PATCH still merges translations with the stored ones', async () => {
    params = { locationId: 'x1' }
    hoisted.existing.mockResolvedValueOnce([{ translations: { en: { title: 'E' }, nl: { city: 'A' } } }])
    body = { translations: { nl: { title: 'X' } }, locale: 'nl' }
    await run(`../${L}/[locationId].patch`)
    expect(hoisted.update.mock.calls[0]![3].translations).toEqual({ en: { title: 'E' }, nl: { city: 'A', title: 'X' } })
  })

  it('locations POST accepts what the packaged form sends once English title is entered', async () => {
    const { applyEnglishTitle } = await import('../collections/locations/app/utils/applyEnglishTitle')
    // defaultValues of useBookingsLocations (title starts as '')
    const state: any = { title: '', color: '', street: '', zip: '', city: '', location: '', content: '', allowedMemberIds: [], slots: [], openDays: [], slotSchedule: {}, blockedDates: [], offerFullDay: false, inventoryMode: false, quantity: 0, maxBookingsPerMonth: 0, translations: {} }
    body = { ...state }
    await expect(run(`../${L}/index.post`)).rejects.toThrow()
    state.translations = { en: { title: 'Studio' } }
    applyEnglishTitle(state, { field: 'title', value: 'Studio' })
    body = { ...state }
    await run(`../${L}/index.post`)
    expect(hoisted.create.mock.calls[0]![0]).toMatchObject({ title: 'Studio' })
  })

  it('settings POST and emaillogs POST reject invalid bodies', async () => {
    body = { statuses: 'not-an-array' }
    await expect(run(`../${S}/index.post`)).rejects.toThrow()
    body = { triggerType: 't', status: 's' }
    await expect(run(`../${G}/index.post`)).rejects.toThrow()
    expect(hoisted.create).not.toHaveBeenCalled()
  })

  it('PATCH keeps null so a field can be cleared', async () => {
    params = { bookingId: 'b1', locationId: 'l1', emailtemplateId: 'e1' }
    body = { group: null }
    await run(`../${B}/[bookingId].patch`)
    expect(hoisted.guarded.mock.calls.at(-1)![1].patch.group).toBeNull()
    body = { maxBookingsPerMonth: null }
    await run(`../${L}/[locationId].patch`)
    expect(hoisted.update.mock.calls.at(-1)![3].maxBookingsPerMonth).toBeNull()
    body = { locationId: null }
    await run(`../${E}/[emailtemplateId].patch`)
    expect(hoisted.update.mock.calls.at(-1)![3].locationId).toBeNull()
  })
})
