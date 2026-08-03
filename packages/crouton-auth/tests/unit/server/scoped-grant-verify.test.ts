/**
 * verifyScopedGrantByResource — the device-poll verification (#1366).
 *
 * The inverse-pairing flow (router prints its code, app claims it) needs to
 * verify a presented (resourceId, secret) WITHOUT knowing the organization:
 * the grant's organizationId IS the claim — it answers "whose device is
 * this?". Unlike verifyAndRedeemGrant it mints no token, never bumps
 * usedCount, and a clean success performs NO database write (the caller
 * polls every ~2s). Lockout semantics are shared with redemption.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let lastInsertedValues: Record<string, unknown> | null = null
let lastUpdateValues: Record<string, unknown> | null = null
let selectResults: unknown[] = []
let updateCalls = 0

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
    set: vi.fn(function (this: unknown, data: Record<string, unknown>) {
      lastUpdateValues = data
      updateCalls++
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
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256)
    }
    return arr
  }),
  subtle: realSubtle
})

// Import after mocks
import {
  upsertScopedGrant,
  verifyScopedGrantByResource
} from '../../../server/utils/scoped-access'

/** Create a grant via upsert to capture a real secretHash for the secret. */
async function grantRecord(secret: string, overrides: Record<string, unknown> = {}) {
  selectResults = []
  await upsertScopedGrant({
    organizationId: 'team-abc',
    resourceType: 'print-device',
    resourceId: 'rut-1234',
    secret,
    role: 'device'
  })
  const secretHash = lastInsertedValues?.secretHash as string

  return {
    id: 'grant-dev-1',
    organizationId: 'team-abc',
    resourceType: 'print-device',
    resourceId: 'rut-1234',
    role: 'device',
    credentialType: 'pin',
    secretHash,
    maxUses: null,
    usedCount: 0,
    failedAttempts: 0,
    lockedUntil: null,
    isActive: true,
    expiresAt: null,
    tokenTtl: 8 * 60 * 60 * 1000,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }
}

describe('verifyScopedGrantByResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastInsertedValues = null
    lastUpdateValues = null
    selectResults = []
    updateCalls = 0
    mockDb = createMockDb()
  })

  it('returns not_found for an unknown resource', async () => {
    selectResults = []
    const result = await verifyScopedGrantByResource({
      resourceType: 'print-device',
      resourceId: 'rut-unknown',
      secret: '824241'
    })
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns the claiming organization on a correct secret — with NO db write', async () => {
    const grant = await grantRecord('824241')
    updateCalls = 0
    selectResults = [grant]

    const result = await verifyScopedGrantByResource({
      resourceType: 'print-device',
      resourceId: 'rut-1234',
      secret: '824241'
    })

    expect(result).toEqual({
      ok: true,
      organizationId: 'team-abc',
      grantId: 'grant-dev-1',
      role: 'device'
    })
    // Polled every ~2s: a clean success must not write.
    expect(updateCalls).toBe(0)
  })

  it('resets failedAttempts on success only when there were failures', async () => {
    const grant = await grantRecord('824241', { failedAttempts: 3 })
    updateCalls = 0
    selectResults = [grant]

    const result = await verifyScopedGrantByResource({
      resourceType: 'print-device',
      resourceId: 'rut-1234',
      secret: '824241'
    })

    expect(result.ok).toBe(true)
    expect(updateCalls).toBe(1)
    expect(lastUpdateValues).toMatchObject({ failedAttempts: 0, lockedUntil: null })
  })

  it('counts a wrong secret and locks after the threshold', async () => {
    const grant = await grantRecord('824241', { failedAttempts: 4 })
    updateCalls = 0
    selectResults = [grant]

    const result = await verifyScopedGrantByResource({
      resourceType: 'print-device',
      resourceId: 'rut-1234',
      secret: '000000'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('locked')
      expect(result.retryAfterMs).toBeGreaterThan(0)
    }
    expect(lastUpdateValues).toMatchObject({ failedAttempts: 5 })
  })

  it('refuses while locked without touching the secret', async () => {
    const grant = await grantRecord('824241', {
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 60_000)
    })
    updateCalls = 0
    selectResults = [grant]

    const result = await verifyScopedGrantByResource({
      resourceType: 'print-device',
      resourceId: 'rut-1234',
      secret: '824241'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('locked')
    expect(updateCalls).toBe(0)
  })

  it('treats an expired grant as not_found', async () => {
    const grant = await grantRecord('824241', { expiresAt: new Date(Date.now() - 1000) })
    selectResults = [grant]

    const result = await verifyScopedGrantByResource({
      resourceType: 'print-device',
      resourceId: 'rut-1234',
      secret: '824241'
    })

    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })
})
