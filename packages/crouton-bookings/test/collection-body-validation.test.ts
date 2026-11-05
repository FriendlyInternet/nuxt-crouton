import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  member: { team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'admin' } },
  create: vi.fn(async (d: any) => d),
  update: vi.fn(async (..._a: any[]) => ({})),
  existing: vi.fn(async (..._a: any[]) => [] as any[])
}))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({ resolveTeamAndCheckMembership: async () => hoisted.member }))
vi.mock('../collections/bookings/server/database/queries', () => ({ createBookingsBooking: hoisted.create, updateBookingsBooking: hoisted.update }))
vi.mock('../collections/locations/server/database/queries', () => ({ updateBookingsLocation: hoisted.update, getBookingsLocationsByIds: hoisted.existing, createBookingsLocation: hoisted.create }))
vi.mock('../collections/settings/server/database/queries', () => ({ createBookingsSetting: hoisted.create, updateBookingsSetting: hoisted.update }))
vi.mock('../collections/emailtemplates/server/database/queries', () => ({ createBookingsEmailtemplate: hoisted.create, updateBookingsEmailtemplate: hoisted.update, getBookingsEmailtemplatesByIds: hoisted.existing }))
vi.mock('../collections/emaillogs/server/database/queries', () => ({ createBookingsEmaillog: hoisted.create, updateBookingsEmaillog: hoisted.update }))

let body: unknown
let params: Record<string, string> = {}
const run = async (path: string) => (await import(path)).default({})

beforeEach(() => {
  hoisted.create.mockClear(); hoisted.update.mockClear(); hoisted.existing.mockClear()
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.statusText), e))
  vi.stubGlobal('getRouterParams', () => params)
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
    await expect(run(`../${B}/index.post`)).rejects.toThrow()
    expect(hoisted.create).not.toHaveBeenCalled()
  })

  it('bookings POST strips system/unknown keys and keeps server-set fields', async () => {
    body = { ...goodBooking, order: 999, createdAt: '1999-01-01', bogus: {}, teamId: 'other' }
    await run(`../${B}/index.post`)
    const arg = hoisted.create.mock.calls[0]![0]
    expect(arg).not.toHaveProperty('order')
    expect(arg).not.toHaveProperty('createdAt')
    expect(arg).not.toHaveProperty('bogus')
    expect(arg.teamId).toBe('t1')
    expect(arg.date).toBeInstanceOf(Date)
  })

  it('bookings PATCH accepts the cancel body and rejects a bad type', async () => {
    params = { bookingId: 'b1' }
    body = { status: 'cancelled' }
    await run(`../${B}/[bookingId].patch`)
    expect(hoisted.update.mock.calls[0]![3]).toMatchObject({ status: 'cancelled' })
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
    expect(hoisted.update.mock.calls.at(-1)![3].group).toBeNull()
    body = { maxBookingsPerMonth: null }
    await run(`../${L}/[locationId].patch`)
    expect(hoisted.update.mock.calls.at(-1)![3].maxBookingsPerMonth).toBeNull()
    body = { locationId: null }
    await run(`../${E}/[emailtemplateId].patch`)
    expect(hoisted.update.mock.calls.at(-1)![3].locationId).toBeNull()
  })
})
