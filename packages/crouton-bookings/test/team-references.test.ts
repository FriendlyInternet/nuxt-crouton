import { describe, it, expect, vi, beforeEach } from 'vitest'

// Route wiring for #3378: hand-owned POST/PATCH handlers must reject references to
// another team's records before writing. The queries module is mocked, but its
// assert* functions use the REAL assertRefsInTeam from crouton-core.
const h = vi.hoisted(() => ({ rows: [] as Array<{ id: string }>, select: null as any, create: null as any, update: null as any }))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ({ team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'member' } }),
}))
vi.mock('../collections/bookings/server/database/queries', async () => {
  const { assertRefsInTeam } = await import('../../crouton-core/server/utils/teamRefs')
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  const t = sqliteTable('x', { id: text('id'), teamId: text('teamId') })
  return {
    createBookingsBooking: (d: any) => h.create(d),
    updateBookingsBooking: (...a: any[]) => h.update(...a),
    assertBookingsBookingReferences: (teamId: string, d: any) =>
      assertRefsInTeam({ select: h.select }, teamId, [{ field: 'location', table: t, value: d.location }]),
  }
})
vi.mock('../collections/emaillogs/server/database/queries', async () => {
  const { assertRefsInTeam } = await import('../../crouton-core/server/utils/teamRefs')
  const { sqliteTable, text } = await import('drizzle-orm/sqlite-core')
  const t = sqliteTable('x', { id: text('id'), teamId: text('teamId') })
  return {
    createBookingsEmaillog: (d: any) => h.create(d),
    updateBookingsEmaillog: (...a: any[]) => h.update(...a),
    assertBookingsEmaillogReferences: (teamId: string, d: any) =>
      assertRefsInTeam({ select: h.select }, teamId, [
        { field: 'bookingId', table: t, value: d.bookingId },
        { field: 'templateId', table: t, value: d.templateId },
      ]),
  }
})

const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.createError = (e: any) => Object.assign(new Error(e.statusText), e)
g.getRouterParams = () => ({ bookingId: 'b1', emaillogId: 'l1' })

let body: any
g.readBody = async () => body
g.readValidatedBody = async (_e: any, parse: (b: unknown) => unknown) => parse(body)

const dir = '../collections'
const loadPost = async () => (await import(`${dir}/bookings/server/api/teams/[id]/bookings-bookings/index.post.ts`)).default
const loadPatch = async () => (await import(`${dir}/bookings/server/api/teams/[id]/bookings-bookings/[bookingId].patch.ts`)).default
const loadLogPost = async () => (await import(`${dir}/emaillogs/server/api/teams/[id]/bookings-emaillogs/index.post.ts`)).default

beforeEach(() => {
  h.rows = []
  h.select = vi.fn(() => ({ from: () => ({ where: async () => h.rows }) }))
  h.create = vi.fn(async d => d)
  h.update = vi.fn(async () => ({}))
})

describe('bookings routes check references against the team (#3378)', () => {
  it('booking with own team location is created', async () => {
    h.rows = [{ id: 'loc1' }]
    body = { location: 'loc1', date: '2026-11-10T00:00:00.000Z', slot: ['s'], quantity: 1, status: 'pending' }
    await (await loadPost())({})
    expect(h.create).toHaveBeenCalledTimes(1)
  })

  it("booking with another team's location → 400, nothing created", async () => {
    body = { location: 'other', date: '2026-11-10T00:00:00.000Z', slot: ['s'], quantity: 1, status: 'pending' }
    await expect((await loadPost())({})).rejects.toMatchObject({ status: 400, statusText: 'Invalid reference: location' })
    expect(h.create).not.toHaveBeenCalled()
  })

  it('PATCH without location skips the check', async () => {
    body = { status: 'x' }
    await (await loadPatch())({})
    expect(h.select).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it("emaillog with another team's bookingId → 400", async () => {
    body = { bookingId: 'other', recipientEmail: 'a@b.c', triggerType: 'x', status: 'sent' }
    await expect((await loadLogPost())({})).rejects.toMatchObject({ status: 400, statusText: 'Invalid reference: bookingId' })
    expect(h.create).not.toHaveBeenCalled()
  })
})
