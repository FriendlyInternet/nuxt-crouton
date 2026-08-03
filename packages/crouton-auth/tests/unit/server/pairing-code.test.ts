/**
 * Pairing-code grant tests (#1661 — WS2 of epic #801)
 *
 * The owner mints a short-lived, SINGLE-USE pairing code; a freshly-installed
 * till device redeems it to claim itself into the org. Redemption consumes the
 * transient pairing grant and mints the PERSISTENT device grant + its token.
 *
 * Design invariant (from #1366, re-affirmed on #1661): a device IS its
 * scopedAccessGrant. There is NO `devices` table — do not add one.
 *
 * Built on the existing scoped-access primitives (hashed secret + per-grant
 * brute-force lockout); this file only pins the pairing-specific behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let lastInsertedValues: Record<string, unknown> | null = null
let selectResults: unknown[] = []

const createMockDb = () => ({
  insert: vi.fn(() => ({
    values: vi.fn(async (data) => {
      lastInsertedValues = data
      return { rowsAffected: 1 }
    })
  })),
  select: vi.fn(() => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => selectResults)
  })),
  update: vi.fn(() => ({
    set: vi.fn(function (this: unknown) {
      return this
    }),
    where: vi.fn(async () => ({ rowsAffected: 1 }))
  })),
  delete: vi.fn(() => ({
    where: vi.fn(async () => ({ rowsAffected: 0 }))
  }))
})

let mockDb = createMockDb()

const realSubtle = globalThis.crypto.subtle
vi.stubGlobal('useDB', () => mockDb)
vi.stubGlobal('crypto', {
  randomUUID: vi.fn().mockReturnValue('test-uuid-1234'),
  getRandomValues: vi.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
    return arr
  }),
  subtle: realSubtle
})

// Import after mocks
import { mintPairingCode, redeemPairingCode } from '../../../server/utils/pairing-code'

const ORG = 'org-123'
const EVENT = 'event-456'

beforeEach(() => {
  mockDb = createMockDb()
  lastInsertedValues = null
  selectResults = []
  vi.clearAllMocks()
})

describe('mintPairingCode', () => {
  it('returns a code and an expiry, and never returns the stored hash', async () => {
    const result = await mintPairingCode({ organizationId: ORG })

    expect(result.code).toBeTruthy()
    expect(result.expiresAt).toBeInstanceOf(Date)
    // The plaintext code is returned to the owner exactly once; what lands in
    // the DB is a hash, never the code itself.
    expect(JSON.stringify(lastInsertedValues)).not.toContain(result.code)
    expect(lastInsertedValues?.secretHash).toBeTruthy()
  })

  it('mints a human-transcribable code (short, unambiguous charset)', async () => {
    // An operator reads this off a screen and types it on a till.
    const { code } = await mintPairingCode({ organizationId: ORG })
    expect(code).toMatch(/^[0-9A-HJ-NP-Z]{8}$/) // excludes I and O — the glyphs mistyped as 1 and 0
  })

  it('is single-use and short-lived by construction', async () => {
    await mintPairingCode({ organizationId: ORG })

    expect(lastInsertedValues?.maxUses).toBe(1)
    const ttlMs = (lastInsertedValues?.expiresAt as Date).getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(0)
    expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000)
  })

  it('scopes the grant to the till-device resource type, coexisting with print-device', async () => {
    await mintPairingCode({ organizationId: ORG })
    expect(lastInsertedValues?.resourceType).toBe('till-device')
    expect(lastInsertedValues?.organizationId).toBe(ORG)
  })

  it('carries the optional event scope into the grant', async () => {
    await mintPairingCode({ organizationId: ORG, eventId: EVENT })
    expect(JSON.stringify(lastInsertedValues?.metadata)).toContain(EVENT)
  })
})

describe('redeemPairingCode', () => {
  it('turns a valid code into a persistent device grant and a token', async () => {
    const { code } = await mintPairingCode({ organizationId: ORG })
    selectResults = [pairingGrantRecordFor(code)]

    const result = await redeemPairingCode({ code, deviceName: 'Bar till 1' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.token).toBeTruthy()
    // The device's own persistent grant — NOT the transient pairing grant.
    expect(result.grant.resourceType).toBe('till-device')
    expect(result.grant.organizationId).toBe(ORG)
    expect(result.grant.id).not.toBe('pairing-grant-id')
  })

  it('rejects a second redeem of the same code (single-use)', async () => {
    const { code } = await mintPairingCode({ organizationId: ORG })
    // First redeem consumed it: usedCount has caught up with maxUses.
    selectResults = [pairingGrantRecordFor(code, { usedCount: 1, maxUses: 1 })]

    const result = await redeemPairingCode({ code, deviceName: 'Bar till 2' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('exhausted')
  })

  it('rejects an expired code', async () => {
    const { code } = await mintPairingCode({ organizationId: ORG })
    selectResults = [
      pairingGrantRecordFor(code, { expiresAt: new Date(Date.now() - 60_000) })
    ]

    const result = await redeemPairingCode({ code, deviceName: 'Late till' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('expired')
  })

  it('locks out after repeated wrong codes', async () => {
    const { code } = await mintPairingCode({ organizationId: ORG })
    selectResults = [pairingGrantRecordFor(code, { failedAttempts: 5 })]

    const result = await redeemPairingCode({ code: 'WRONGCOD', deviceName: 'Attacker' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('locked')
  })

  it('does not distinguish an unknown code from a wrong one', async () => {
    selectResults = [] // no such grant
    const result = await redeemPairingCode({ code: 'NOSUCHCD', deviceName: 'Probe' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    // Same reason a wrong-but-existing code yields — no enumeration oracle.
    expect(result.reason).toBe('invalid')
  })
})

/**
 * Build a select-able pairing-grant row whose secretHash really matches `code`,
 * by reusing the hash the mint path just wrote.
 */
function pairingGrantRecordFor(code: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'pairing-grant-id',
    organizationId: ORG,
    resourceType: 'till-device',
    resourceId: `pairing:${code}`,
    credentialType: 'pin',
    secretHash: lastInsertedValues?.secretHash,
    role: 'device',
    maxUses: 1,
    usedCount: 0,
    failedAttempts: 0,
    lockedUntil: null,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    tokenTtl: 8 * 60 * 60 * 1000,
    isActive: true,
    metadata: null,
    ...overrides
  }
}
