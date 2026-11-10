import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

// #3135: run the REAL route handlers over an in-memory SQLite. Only the auth helpers
// (switchable role) and the Nitro globals are stand-ins. requireTeamAdmin mirrors the
// real one: 403 unless admin/owner.
vi.mock('~~/server/db/schema', async () => {
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  return { user: sqliteTable('user', { id: text('id'), name: text('name'), email: text('email'), image: text('image') }) }
})
const h = vi.hoisted(() => ({ role: 'member', patch: null as any }))
const ctx = () => ({ team: { id: 't1', metadata: {} }, user: { id: 'u1' }, membership: { role: h.role } })
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ctx(),
  requireTeamAdmin: async () => {
    if (h.role !== 'admin' && h.role !== 'owner') throw Object.assign(new Error('Forbidden'), { status: 403 })
    return ctx()
  },
}))
vi.mock('../server/utils/booking-capacity', async orig => ({ ...(await orig() as object), patchBookingGuarded: (...a: any[]) => h.patch(...a) }))
vi.mock('../server/utils/booking-emails', () => ({ isBookingEmailEnabled: () => true, resolveTranslatedField: () => '', resolveSlotLabels: () => '' }))
vi.mock('../server/utils/email-service', () => ({
  sendBookingEmails: async () => ({}),
  getBatchBookingEmailStats: async () => new Map(),
  getBatchBookingEmailDetails: async () => new Map(),
}))

const client = new Database(':memory:')
client.exec(`
CREATE TABLE user (id text primary key, name text, email text, image text);
CREATE TABLE bookings_locations (id text primary key, teamId text not null, owner text, "order" integer, title text, color text, street text, zip text, city text, location text, content text, allowedMemberIds text, slots text, openDays text, slotSchedule text, blockedDates text, offerFullDay integer, inventoryMode integer, quantity integer, maxBookingsPerMonth integer, translations text, createdAt integer, updatedAt integer, createdBy text, updatedBy text);
CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text, "order" integer, location text, date integer, slot text, "group" text, quantity integer, status text, createdAt integer, updatedAt integer, createdBy text, updatedBy text);
INSERT INTO user VALUES ('u1','Me','me@x',null), ('u2','Other','other@x',null);
INSERT INTO bookings_locations (id, teamId, title) VALUES ('loc','t1','Loc');
INSERT INTO bookings_bookings VALUES ('mine','t1','u1',0,'loc',1000,'["a"]',null,1,'confirmed',1,1,'u1','u1'), ('theirs','t1','u2',0,'loc',2000,'["a"]',null,1,'confirmed',2,2,'u2','u2');
`)
const db = drizzle(client) as any

const g = globalThis as any
g.useDB = () => db
g.defineEventHandler = (fn: any) => fn
g.createError = (e: any) => Object.assign(new Error(e.statusText), e)
g.useRuntimeConfig = () => ({ email: { from: 'Shop <noreply@shop.be>' } })
let params: Record<string, string> = {}
let body: any
g.getRouterParam = (_e: any, k: string) => params[k]
g.getRouterParams = () => params
g.getQuery = () => ({})
g.readBody = async () => body
g.readValidatedBody = async (_e: any, parse: any) => parse(body)

beforeAll(async () => {
  g.assertRefsInTeam = (await import('../../crouton-core/server/utils/teamRefs')).assertRefsInTeam
})
beforeEach(() => {
  h.role = 'member'
  params = { bookingId: 'theirs', emailtemplateId: 'x', settingId: 'x', locationId: 'x' }
  h.patch = vi.fn(async () => ({ id: 'x' }))
})

const route = async (p: string) => (await import(p)).default
const A = '../collections'
const S = '../server/api/crouton-bookings/teams/[id]'
const status = (p: Promise<any>) => p.then(() => 200, (e: any) => e.status)

// [label, module, body]
const adminOnly: [string, string, any][] = [
  ['admin-bookings GET', `${S}/admin-bookings.get`, undefined],
  ['emaillogs GET', `${A}/emaillogs/server/api/teams/[id]/bookings-emaillogs/index.get`, undefined],
  ['emailtemplates POST', `${A}/emailtemplates/server/api/teams/[id]/bookings-emailtemplates/index.post`, {}],
  ['emailtemplates PATCH', `${A}/emailtemplates/server/api/teams/[id]/bookings-emailtemplates/[emailtemplateId].patch`, {}],
  ['emailtemplates DELETE', `${A}/emailtemplates/server/api/teams/[id]/bookings-emailtemplates/[emailtemplateId].delete`, undefined],
  ['settings POST', `${A}/settings/server/api/teams/[id]/bookings-settings/index.post`, {}],
  ['settings PATCH', `${A}/settings/server/api/teams/[id]/bookings-settings/[settingId].patch`, {}],
  ['settings DELETE', `${A}/settings/server/api/teams/[id]/bookings-settings/[settingId].delete`, undefined],
  ['locations POST', `${A}/locations/server/api/teams/[id]/bookings-locations/index.post`, {}],
  ['locations PATCH', `${A}/locations/server/api/teams/[id]/bookings-locations/[locationId].patch`, {}],
  ['locations DELETE', `${A}/locations/server/api/teams/[id]/bookings-locations/[locationId].delete`, undefined],
  ['bookings-bookings POST', `${A}/bookings/server/api/teams/[id]/bookings-bookings/index.post`, {}],
]

describe('admin-only routes (#3135)', () => {
  for (const [label, mod] of adminOnly) {
    it(`${label}: member → 403`, async () => {
      body = {}
      expect(await status((await route(mod))({}))).toBe(403)
    })
  }
  it('admin-bookings GET: admin → 200', async () => {
    h.role = 'admin'
    expect(await status((await route(`${S}/admin-bookings.get`))({}))).toBe(200)
  })
  for (const [label, mod] of adminOnly) {
    it(`${label}: admin is not refused (not 403)`, async () => {
      h.role = 'admin'
      body = {}
      expect(await status((await route(mod))({}))).not.toBe(403)
    })
  }
})

describe('bookings-bookings list', () => {
  const list = async () => (await route(`${A}/bookings/server/api/teams/[id]/bookings-bookings/index.get`))({})
  it('member sees only own rows, no emails', async () => {
    const rows = await list()
    expect(rows.map((r: any) => r.id)).toEqual(['mine'])
    expect(JSON.stringify(rows)).not.toContain('@x')
  })
  it('admin sees all rows', async () => {
    h.role = 'admin'
    expect((await list()).map((r: any) => r.id).sort()).toEqual(['mine', 'theirs'])
  })
})

describe('PATCH bookings/[bookingId]', () => {
  const patch = async () => (await route(`${S}/bookings/[bookingId]/index.patch`))({})
  beforeEach(() => { body = { status: 'cancelled' } })
  it("member on someone else's booking → 403, nothing patched", async () => {
    expect(await status(patch())).toBe(403)
    expect(h.patch).not.toHaveBeenCalled()
  })
  it('member on own booking → ok', async () => {
    params = { ...params, bookingId: 'mine' }
    expect(await status(patch())).toBe(200)
    expect(h.patch.mock.calls[0][1]).toMatchObject({ ownerId: 'u1' })
  })
  it("admin on someone else's booking → ok", async () => {
    h.role = 'admin'
    expect(await status(patch())).toBe(200)
    expect(h.patch.mock.calls[0][1].ownerId).toBeUndefined()
  })
})

describe('resend-email', () => {
  it("member on someone else's booking → 403", async () => {
    body = { triggerType: 'booking_created' }
    expect(await status((await route(`${S}/bookings/[bookingId]/resend-email.post`))({}))).toBe(403)
  })
})

describe('calendar-bookings (member-safe)', () => {
  it('member gets every booking but only the six calendar fields', async () => {
    const rows = await (await route(`${S}/calendar-bookings.get`))({})
    expect(rows).toHaveLength(2)
    expect(Object.keys(rows[0]).sort()).toEqual(['date', 'id', 'location', 'quantity', 'slot', 'status'])
  })
})

describe('email template sender domain', () => {
  const tpl = { name: 'n', subject: 's', body: 'b', triggerType: 't', recipientType: 'r' }
  beforeEach(() => { h.role = 'admin' })
  it('off-domain fromEmail → 400 (POST and PATCH)', async () => {
    body = { ...tpl, fromEmail: 'boss@evil.com' }
    params = { emailtemplateId: 'x' }
    expect(await status((await route(`${A}/emailtemplates/server/api/teams/[id]/bookings-emailtemplates/index.post`))({}))).toBe(400)
    expect(await status((await route(`${A}/emailtemplates/server/api/teams/[id]/bookings-emailtemplates/[emailtemplateId].patch`))({}))).toBe(400)
  })
})
