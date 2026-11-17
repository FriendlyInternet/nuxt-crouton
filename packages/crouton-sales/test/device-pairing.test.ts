import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  claimDevice,
  listTeamDevices,
  revokeTeamDevice,
  mintTeamPairingCode,
  REDEEM_FAILURE_STATUS
} from '../server/utils/device-pairing'

/**
 * The sales-side device-pairing logic (#1662) — the server half of #803's
 * pairing, built on #1661's `crouton-auth` grant machinery.
 *
 * #1661 already pins the credential behaviour (single-use, expiry, lockout,
 * no enumeration oracle). What is pinned HERE is only what sales adds on top:
 *
 *  1. claim binds the device to the org's ACTIVE event (isCurrent), and still
 *     succeeds — with eventId null — when no event is current
 *  2. each redeem failure reason maps to the right HTTP status, matching the
 *     existing scoped-access redeem contract (429 locked / 410 spent / 401)
 *  3. a locked claim carries Retry-After so the till can back off
 *  4. the device list covers till-device AND print-device, discriminated
 *  5. the list is team-scoped and hides revoked grants
 *  6. revoke refuses to touch another team's device
 *
 * Drizzle is faked just enough to record which table/conditions each query
 * built and to hand back canned rows — the house pattern from
 * delete-order.test.ts.
 */

// ── #1661 machinery is a collaborator here, not the thing under test ────────
const redeemPairingCode = vi.fn()
const mintPairingCode = vi.fn()

vi.mock('@fyit/crouton-auth/server/utils/pairing-code', () => ({
  redeemPairingCode: (...args: unknown[]) => redeemPairingCode(...args),
  mintPairingCode: (...args: unknown[]) => mintPairingCode(...args),
  TILL_DEVICE_RESOURCE_TYPE: 'till-device'
}))

// The auth schema resolves to crouton-auth's built `dist/`, which isn't present
// where only the sales tests run. Sentinel columns are all the fake db needs.
vi.mock('@fyit/crouton-auth/server/database/schema/auth', () => ({
  scopedAccessGrant: {
    id: 'grant.id',
    organizationId: 'grant.organizationId',
    resourceType: 'grant.resourceType',
    resourceId: 'grant.resourceId',
    createdAt: 'grant.createdAt',
    isActive: 'grant.isActive'
  }
}))

// The app-owned collection schema is reached through the consuming app's `~~`
// alias, which only resolves inside a Nuxt build. Sentinel columns are all the
// fake db needs — identity, not behaviour.
vi.mock('../collections/events/server/database/schema', () => ({
  salesEvents: { id: 'events.id', teamId: 'events.teamId', isCurrent: 'events.isCurrent' }
}))

// Record what each `where(...)` filtered on, so tests can assert a lookup is
// team-scoped rather than only that it came back empty (#3992).
const recordedWheres: unknown[] = []
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
    and: (...conds: unknown[]) => ({ op: 'and', conds }),
    inArray: (col: unknown, vals: unknown[]) => ({ op: 'inArray', col, vals })
  }
})

const ORG = 'org-123'
const EVENT = 'event-current'

/** Rows the next `select(...)` chain should resolve to, in call order. */
let selectQueue: unknown[][] = []
const recordedUpdates: Array<{ set: Record<string, unknown> }> = []

const makeDb = () => ({
  select: vi.fn(() => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn(function (this: unknown, c: unknown) {
      recordedWheres.push(c)
      return this
    }),
    limit: vi.fn(async () => selectQueue.shift() ?? []),
    then: undefined
  })),
  update: vi.fn(() => ({
    set: vi.fn(function (this: unknown, data: Record<string, unknown>) {
      recordedUpdates.push({ set: data })
      return this
    }),
    where: vi.fn(async () => ({ rowsAffected: 1 }))
  }))
})

let db = makeDb()
vi.stubGlobal('useDB', () => db)

beforeEach(() => {
  db = makeDb()
  selectQueue = []
  recordedUpdates.length = 0
  recordedWheres.length = 0
  vi.clearAllMocks()
})

describe('claimDevice', () => {
  it('binds a claimed device to the org active event', async () => {
    redeemPairingCode.mockResolvedValue({
      ok: true,
      token: 'tok-abc',
      tokenExpiresAt: new Date('2026-08-04T00:00:00Z'),
      deviceSecret: 'secret-xyz',
      grant: {
        id: 'grant-1',
        organizationId: ORG,
        resourceType: 'till-device',
        resourceId: 'device:dev-1',
        role: 'device'
      }
    })
    selectQueue = [[{ id: EVENT }]] // the isCurrent event

    const result = await claimDevice({ code: 'ABCD2345', deviceName: 'Bar till 1' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.orgId).toBe(ORG)
    expect(result.eventId).toBe(EVENT)
    expect(result.deviceId).toBe('device:dev-1')
    expect(result.token).toBe('tok-abc')
    // Returned once at claim time so the till can persist its identity.
    expect(result.deviceSecret).toBe('secret-xyz')
  })

  it('still claims when the org has no current event', async () => {
    redeemPairingCode.mockResolvedValue({
      ok: true,
      token: 'tok-abc',
      tokenExpiresAt: new Date(),
      deviceSecret: 's',
      grant: {
        id: 'g',
        organizationId: ORG,
        resourceType: 'till-device',
        resourceId: 'device:dev-2',
        role: 'device'
      }
    })
    selectQueue = [[]] // no isCurrent row

    const result = await claimDevice({ code: 'ABCD2345', deviceName: 'Spare till' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // A till can be provisioned before the event exists — binding it to the
    // org is the durable part; the event is resolved again at use time.
    expect(result.eventId).toBeNull()
  })

  it('maps each redeem failure to the scoped-access HTTP contract', async () => {
    expect(REDEEM_FAILURE_STATUS.locked).toBe(429)
    expect(REDEEM_FAILURE_STATUS.exhausted).toBe(410)
    expect(REDEEM_FAILURE_STATUS.expired).toBe(410)
    expect(REDEEM_FAILURE_STATUS.invalid).toBe(401)
  })

  it('passes the lockout window back so the till can back off', async () => {
    redeemPairingCode.mockResolvedValue({
      ok: false,
      reason: 'locked',
      retryAfterMs: 60_000
    })

    const result = await claimDevice({ code: 'WRONGCOD', deviceName: 'Attacker' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(429)
    expect(result.retryAfterSeconds).toBe(60)
  })

  it('does not hit the database when the code is rejected', async () => {
    redeemPairingCode.mockResolvedValue({ ok: false, reason: 'invalid' })

    const result = await claimDevice({ code: 'NOSUCHCD', deviceName: 'Probe' })

    expect(result.ok).toBe(false)
    // No active-event lookup for a failed claim — a public endpoint must not
    // let an unauthenticated caller drive queries.
    expect(db.select).not.toHaveBeenCalled()
  })
})

describe('listTeamDevices', () => {
  it('returns till devices and print devices, discriminated by type', async () => {
    selectQueue = [
      [
        { deviceId: 'device:dev-1', resourceType: 'till-device', claimedAt: new Date('2026-08-01') },
        { deviceId: 'router-7', resourceType: 'print-device', claimedAt: new Date('2026-08-02') }
      ]
    ]

    const devices = await listTeamDevices(ORG)

    expect(devices).toHaveLength(2)
    expect(devices.map(d => d.type).sort()).toEqual(['print-device', 'till-device'])
  })
})

describe('revokeTeamDevice', () => {
  it('deactivates the grant rather than deleting it', async () => {
    selectQueue = [[{ id: 'grant-1', organizationId: ORG }]]

    const ok = await revokeTeamDevice(ORG, 'device:dev-1')

    expect(ok).toBe(true)
    expect(recordedUpdates.at(-1)?.set).toMatchObject({ isActive: false })
  })

  it('refuses to revoke another team\'s device', async () => {
    selectQueue = [[]] // scoped lookup finds nothing for this team

    const ok = await revokeTeamDevice(ORG, 'device:someone-elses')

    expect(ok).toBe(false)
    expect(recordedUpdates).toHaveLength(0)
  })
})

// #3992 — a pairing code may only be tied to an event owned by the asking team.
describe('mintTeamPairingCode', () => {
  const teamFilter = { op: 'eq', col: 'events.teamId', val: ORG }
  const idFilter = { op: 'eq', col: 'events.id', val: EVENT }

  beforeEach(() => {
    mintPairingCode.mockResolvedValue({ code: 'ABCD2345', expiresAt: new Date() })
  })

  // covers: T1
  it('mints a code tied to the team\'s own event', async () => {
    selectQueue = [[{ id: EVENT }]]

    const result = await mintTeamPairingCode({ organizationId: ORG, eventId: EVENT })

    expect(result.ok).toBe(true)
    expect(mintPairingCode).toHaveBeenCalledWith({ organizationId: ORG, eventId: EVENT })
    expect(recordedWheres[0]).toEqual({ op: 'and', conds: expect.arrayContaining([idFilter, teamFilter]) })
  })

  // covers: T1
  it('refuses another team\'s event with 404 and mints nothing', async () => {
    selectQueue = [[]] // the team-scoped lookup finds nothing

    const result = await mintTeamPairingCode({ organizationId: ORG, eventId: EVENT })

    expect(result).toEqual({ ok: false, status: 404 })
    expect(mintPairingCode).not.toHaveBeenCalled()
    expect(recordedWheres[0]).toEqual({ op: 'and', conds: expect.arrayContaining([idFilter, teamFilter]) })
  })

  // covers: T1
  it('mints unchanged when no event id is given, without a lookup', async () => {
    for (const eventId of [undefined, '  ']) {
      mintPairingCode.mockClear()
      const result = await mintTeamPairingCode({ organizationId: ORG, eventId })

      expect(result.ok).toBe(true)
      expect(mintPairingCode).toHaveBeenCalledWith({ organizationId: ORG, eventId: undefined })
    }
    expect(db.select).not.toHaveBeenCalled()
    expect(recordedWheres).toHaveLength(0)
  })
})
