/**
 * Pairing-code grants — the app-mints direction of device claiming (#1661).
 *
 * An org owner mints a short-lived, single-use pairing code; a freshly
 * installed till device redeems it to claim itself into the org. Redemption
 * consumes the transient pairing grant and mints the device's PERSISTENT
 * grant plus its first scoped token.
 *
 * This is the counterpart to #1366's device-prints-code flow
 * (`verifyScopedGrantByResource`), and shares its design invariant:
 *
 *   A DEVICE **IS** ITS `scopedAccessGrant`. There is no `devices` table.
 *
 * Everything security-bearing is reused from `scoped-access.ts` — salted
 * secret hashing and the per-grant exponential lockout. This module only adds
 * the pairing-specific shape: code generation, an org-less lookup (the device
 * does not yet know which org it belongs to — the grant's `organizationId` is
 * the answer), and single-use consumption.
 */
import { eq, and, sql } from 'drizzle-orm'
import { scopedAccessGrant } from '../database/schema/auth'
import {
  createScopedToken,
  upsertScopedGrant,
  hashGrantSecret,
  verifyGrantSecret,
  GRANT_LOCKOUT_THRESHOLD,
  lockoutDuration
} from './scoped-access'

/**
 * Resource type for till/screen devices. Deliberately distinct from
 * 'print-device' (#1366's routers) so the two coexist on one org.
 */
export const TILL_DEVICE_RESOURCE_TYPE = 'till-device'

/** A pairing code is a transient credential — minutes, not hours. */
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000

const PAIRING_CODE_LENGTH = 8

/**
 * Crockford-ish alphabet: digits + A–Z minus the two glyph pairs an operator
 * reliably mistypes when reading a code off a screen (I/1 and O/0). 34 symbols
 * over 8 characters ≈ 1.8e12 combinations, which — behind the shared per-grant
 * lockout — is far beyond guessable.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Bytes ≥ this are rejected when sampling, to keep the alphabet unbiased. */
const REJECTION_CEILING = 256 - (256 % CODE_ALPHABET.length)

function generatePairingCode(): string {
  let out = ''
  while (out.length < PAIRING_CODE_LENGTH) {
    const bytes = new Uint8Array(PAIRING_CODE_LENGTH)
    crypto.getRandomValues(bytes)
    for (const b of bytes) {
      if (out.length === PAIRING_CODE_LENGTH) break
      // Rejection sampling — modulo alone would over-weight the first
      // 256 % 34 = 18 symbols.
      if (b >= REJECTION_CEILING) continue
      out += CODE_ALPHABET[b % CODE_ALPHABET.length]
    }
  }
  return out
}

/**
 * Deterministic, UNSALTED digest of the code, used only as the row's lookup
 * key so a device can find its grant while presenting nothing but the code.
 * The actual verification still runs against the salted `secretHash`, so this
 * digest being deterministic does not weaken the credential — and critically,
 * the plaintext code is never written to the database.
 */
async function codeLookupId(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

const pairingResourceId = (lookupId: string) => `pairing:${lookupId}`

/** Secret held by the device after claiming, so it can re-authenticate later. */
function generateDeviceSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface MintPairingCodeOptions {
  /** Organization the claimed device will belong to */
  organizationId: string
  /** Optional event scope carried onto the device grant on redeem */
  eventId?: string
}

/**
 * Mint a single-use pairing code for an org.
 *
 * The plaintext code is returned to the caller exactly once — it is shown to
 * the owner and never stored. Callers must not log it.
 */
export async function mintPairingCode(
  options: MintPairingCodeOptions
): Promise<{ code: string, expiresAt: Date }> {
  const { organizationId, eventId } = options

  const code = generatePairingCode()
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS)

  await upsertScopedGrant({
    organizationId,
    resourceType: TILL_DEVICE_RESOURCE_TYPE,
    resourceId: pairingResourceId(await codeLookupId(code)),
    secret: code,
    role: 'device',
    maxUses: 1,
    expiresAt,
    metadata: eventId ? { eventId } : undefined
  })

  return { code, expiresAt }
}

export interface RedeemPairingCodeOptions {
  /** The code as typed on the device */
  code: string
  /** Operator-facing name for the claimed device ("Bar till 1") */
  deviceName: string
}

/**
 * Outcome of a claim attempt.
 *
 * `invalid` deliberately covers BOTH "no such code" and "wrong code" so the
 * endpoint is not an enumeration oracle.
 */
export type RedeemPairingCodeResult
  = | {
    ok: true
    /** First scoped token for the claimed device */
    token: string
    tokenExpiresAt: Date
    /**
     * The device's long-lived secret. Returned once, at claim time — the
     * device persists it and presents it on later re-authentication.
     */
    deviceSecret: string
    grant: {
      id: string
      organizationId: string
      resourceType: string
      resourceId: string
      role: string
    }
  }
  | { ok: false, reason: 'invalid' | 'expired' | 'locked' | 'exhausted', retryAfterMs?: number }

/**
 * Claim a device with a pairing code.
 *
 * Note the deliberate org-less lookup: a fresh device knows only the code, so
 * the grant it finds is what tells it which organization it now belongs to.
 */
export async function redeemPairingCode(
  options: RedeemPairingCodeOptions
): Promise<RedeemPairingCodeResult> {
  const { code, deviceName } = options

  const db = useDB()
  const now = new Date()

  const [grant] = await db
    .select()
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.resourceType, TILL_DEVICE_RESOURCE_TYPE),
        eq(scopedAccessGrant.resourceId, pairingResourceId(await codeLookupId(code))),
        eq(scopedAccessGrant.credentialType, 'pin'),
        eq(scopedAccessGrant.isActive, true)
      )
    )
    .limit(1)

  // No such code — same answer a wrong code gets (see the type's note).
  if (!grant) return { ok: false, reason: 'invalid' }

  if (grant.expiresAt && grant.expiresAt <= now) {
    return { ok: false, reason: 'expired' }
  }

  if (grant.lockedUntil && grant.lockedUntil > now) {
    return {
      ok: false,
      reason: 'locked',
      retryAfterMs: grant.lockedUntil.getTime() - now.getTime()
    }
  }

  if (!(await verifyGrantSecret(code, grant.secretHash))) {
    const failedAttempts = grant.failedAttempts + 1
    const lockedUntil = failedAttempts >= GRANT_LOCKOUT_THRESHOLD
      ? new Date(now.getTime() + lockoutDuration(failedAttempts))
      : null
    await db
      .update(scopedAccessGrant)
      .set({ failedAttempts, lockedUntil })
      .where(eq(scopedAccessGrant.id, grant.id))
    return lockedUntil
      ? { ok: false, reason: 'locked', retryAfterMs: lockedUntil.getTime() - now.getTime() }
      : { ok: false, reason: 'invalid' }
  }

  if (grant.maxUses !== null && grant.usedCount >= grant.maxUses) {
    return { ok: false, reason: 'exhausted' }
  }

  // Consume the pairing grant. Deactivating as well as counting means a
  // replay can't succeed even if maxUses were later widened.
  await db
    .update(scopedAccessGrant)
    .set({
      usedCount: sql`${scopedAccessGrant.usedCount} + 1`,
      isActive: false,
      failedAttempts: 0,
      lockedUntil: null
    })
    .where(eq(scopedAccessGrant.id, grant.id))

  // Mint the device's persistent grant — this row IS the device.
  const deviceId = crypto.randomUUID()
  const deviceResourceId = `device:${deviceId}`
  const deviceSecret = generateDeviceSecret()
  const deviceGrantId = crypto.randomUUID()

  await db.insert(scopedAccessGrant).values({
    id: deviceGrantId,
    organizationId: grant.organizationId,
    resourceType: TILL_DEVICE_RESOURCE_TYPE,
    resourceId: deviceResourceId,
    role: 'device',
    credentialType: 'pin',
    secretHash: await hashGrantSecret(deviceSecret),
    maxUses: null,
    expiresAt: null,
    tokenTtl: grant.tokenTtl,
    // Carries the pairing grant's event scope, if any, onto the device.
    metadata: grant.metadata
  })

  const { token, expiresAt } = await createScopedToken({
    organizationId: grant.organizationId,
    resourceType: TILL_DEVICE_RESOURCE_TYPE,
    resourceId: deviceResourceId,
    displayName: deviceName,
    role: 'device',
    expiresIn: grant.tokenTtl
  })

  return {
    ok: true,
    token,
    tokenExpiresAt: expiresAt,
    deviceSecret,
    grant: {
      id: deviceGrantId,
      organizationId: grant.organizationId,
      resourceType: TILL_DEVICE_RESOURCE_TYPE,
      resourceId: deviceResourceId,
      role: 'device'
    }
  }
}
