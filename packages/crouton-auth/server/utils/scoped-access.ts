/**
 * Scoped Access Token Utilities
 *
 * Provides server-side utilities for managing scoped access tokens.
 * These tokens provide lightweight, resource-scoped authentication
 * for scenarios where full user accounts aren't needed.
 *
 * @example
 * ```typescript
 * // Create a helper token for an event
 * const token = await createScopedToken({
 *   organizationId: 'team-123',
 *   resourceType: 'event',
 *   resourceId: 'event-456',
 *   displayName: 'John Helper',
 *   role: 'helper',
 *   expiresIn: 8 * 60 * 60 * 1000 // 8 hours
 * })
 *
 * // Validate a token from request
 * const access = await validateScopedToken(event, 'scoped-access-token')
 * if (access) {
 *   console.log(`Welcome ${access.displayName}`)
 * }
 * ```
 */
import { eq, and, gt, lt, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { scopedAccessToken, scopedAccessGrant } from '../database/schema/auth'
import type { ScopedAccessToken, ScopedAccessGrant } from '../database/schema/auth'

/**
 * Options for creating a scoped access token
 */
export interface CreateScopedTokenOptions {
  /** Organization/team ID */
  organizationId: string
  /** Type of resource (e.g., 'event', 'booking') */
  resourceType: string
  /** ID of the specific resource */
  resourceId: string
  /** Display name for the token holder */
  displayName: string
  /** Role for authorization (default: 'guest') */
  role?: string
  /** Time until expiration in milliseconds (default: 8 hours) */
  expiresIn?: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Result of validating a scoped access token
 */
export interface ScopedAccessResult {
  /** Token ID */
  id: string
  /** The token string itself (used by refresh to slide its own expiry) */
  token: string
  /** Organization/team ID */
  organizationId: string
  /** Resource type */
  resourceType: string
  /** Resource ID */
  resourceId: string
  /** Display name */
  displayName: string
  /** Role */
  role: string
  /** Token expiration */
  expiresAt: Date
  /** Additional metadata */
  metadata: Record<string, unknown> | null
}

/**
 * Generate a secure random token string
 */
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Create a new scoped access token
 *
 * @param options - Token creation options
 * @returns The created token data including the token string
 */
export async function createScopedToken(
  options: CreateScopedTokenOptions
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const {
    organizationId,
    resourceType,
    resourceId,
    displayName,
    role = 'guest',
    expiresIn = 8 * 60 * 60 * 1000, // 8 hours default
    metadata
  } = options

  const token = generateToken()
  const expiresAt = new Date(Date.now() + expiresIn)
  const id = crypto.randomUUID()

  const db = useDB()

  await db.insert(scopedAccessToken).values({
    id,
    organizationId,
    token,
    resourceType,
    resourceId,
    displayName,
    role,
    isActive: true,
    expiresAt,
    lastActiveAt: new Date(),
    metadata: metadata ? JSON.stringify(metadata) : null
  })

  return { token, id, expiresAt }
}

/**
 * Validate a scoped access token
 *
 * Checks if the token exists, is active, and hasn't expired.
 * Updates lastActiveAt on successful validation.
 *
 * @param token - The token string to validate
 * @returns Token data if valid, null otherwise
 */
export async function validateScopedToken(
  token: string
): Promise<ScopedAccessResult | null> {
  const db = useDB()

  const [record] = await db
    .select()
    .from(scopedAccessToken)
    .where(
      and(
        eq(scopedAccessToken.token, token),
        eq(scopedAccessToken.isActive, true),
        gt(scopedAccessToken.expiresAt, new Date())
      )
    )
    .limit(1)

  if (!record) {
    return null
  }

  // Update last active time
  await db
    .update(scopedAccessToken)
    .set({ lastActiveAt: new Date() })
    .where(eq(scopedAccessToken.id, record.id))

  return {
    id: record.id,
    token: record.token,
    organizationId: record.organizationId,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    displayName: record.displayName,
    role: record.role,
    expiresAt: record.expiresAt,
    metadata: record.metadata ? JSON.parse(record.metadata) : null
  }
}

/**
 * Canonical header for scoped access tokens. All consumers should send this;
 * package-specific headers (e.g. sales' legacy 'x-helper-token') are
 * transitional and read only via the explicit cookieName/header overrides.
 */
export const SCOPED_TOKEN_HEADER = 'x-scoped-token'

/**
 * Validate scoped access token from H3 event
 *
 * Extracts token from the canonical 'x-scoped-token' header, cookie, or
 * Bearer authorization header and validates it.
 *
 * @param event - H3 event
 * @param cookieName - Name of the cookie to check (default: 'scoped-access-token')
 * @returns Token data if valid, null otherwise
 */
export async function validateScopedTokenFromEvent(
  event: H3Event,
  cookieName = 'scoped-access-token'
): Promise<ScopedAccessResult | null> {
  // Canonical header first
  const headerToken = getHeader(event, SCOPED_TOKEN_HEADER)
  if (headerToken) {
    return validateScopedToken(headerToken)
  }

  // Then cookie (set by redeem/mint for SSR validation)
  const cookieToken = getCookie(event, cookieName)
  if (cookieToken) {
    return validateScopedToken(cookieToken)
  }

  // Finally authorization header
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    return validateScopedToken(token)
  }

  return null
}

/**
 * Require valid scoped access token from H3 event
 *
 * Throws an error if token is invalid or missing.
 *
 * @param event - H3 event
 * @param cookieName - Name of the cookie to check
 * @returns Token data if valid
 * @throws Error if token is invalid or missing
 */
export async function requireScopedAccess(
  event: H3Event,
  cookieName = 'scoped-access-token'
): Promise<ScopedAccessResult> {
  const access = await validateScopedTokenFromEvent(event, cookieName)

  if (!access) {
    throw createError({
      status: 401,
      statusText: 'Invalid or expired access token'
    })
  }

  return access
}

/**
 * Require scoped access to a specific resource
 *
 * Validates token and ensures it's scoped to the specified resource.
 *
 * @param event - H3 event
 * @param resourceType - Expected resource type
 * @param resourceId - Expected resource ID
 * @param cookieName - Name of the cookie to check
 * @returns Token data if valid and matches resource
 * @throws Error if token is invalid, expired, or doesn't match resource
 */
export async function requireScopedAccessToResource(
  event: H3Event,
  resourceType: string,
  resourceId: string,
  cookieName = 'scoped-access-token'
): Promise<ScopedAccessResult> {
  const access = await requireScopedAccess(event, cookieName)

  if (access.resourceType !== resourceType || access.resourceId !== resourceId) {
    throw createError({
      status: 403,
      statusText: 'Access denied to this resource'
    })
  }

  return access
}

/**
 * Revoke a scoped access token
 *
 * Marks the token as inactive. The token will no longer validate.
 *
 * @param token - Token string to revoke
 * @returns True if token was found and revoked
 */
export async function revokeScopedToken(token: string): Promise<boolean> {
  const db = useDB()

  const result = await db
    .update(scopedAccessToken)
    .set({ isActive: false })
    .where(eq(scopedAccessToken.token, token))

  return result.rowsAffected > 0
}

/**
 * Revoke all tokens for a resource
 *
 * Useful when deleting or deactivating a resource.
 *
 * @param resourceType - Resource type
 * @param resourceId - Resource ID
 * @returns Number of tokens revoked
 */
export async function revokeScopedTokensForResource(
  resourceType: string,
  resourceId: string
): Promise<number> {
  const db = useDB()

  const result = await db
    .update(scopedAccessToken)
    .set({ isActive: false })
    .where(
      and(
        eq(scopedAccessToken.resourceType, resourceType),
        eq(scopedAccessToken.resourceId, resourceId),
        eq(scopedAccessToken.isActive, true)
      )
    )

  return result.rowsAffected
}

/**
 * Get existing token for a display name and resource
 *
 * Useful for finding an existing helper session to reuse.
 *
 * @param organizationId - Organization ID
 * @param resourceType - Resource type
 * @param resourceId - Resource ID
 * @param displayName - Display name to search for
 * @returns Existing token record if found
 */
export async function findExistingScopedToken(
  organizationId: string,
  resourceType: string,
  resourceId: string,
  displayName?: string
): Promise<ScopedAccessToken | null> {
  const db = useDB()

  const conditions = [
    eq(scopedAccessToken.organizationId, organizationId),
    eq(scopedAccessToken.resourceType, resourceType),
    eq(scopedAccessToken.resourceId, resourceId),
    eq(scopedAccessToken.isActive, true),
    gt(scopedAccessToken.expiresAt, new Date())
  ]

  if (displayName) {
    conditions.push(eq(scopedAccessToken.displayName, displayName))
  }

  const [record] = await db
    .select()
    .from(scopedAccessToken)
    .where(and(...conditions))
    .limit(1)

  return record || null
}

/**
 * List all active tokens for a resource
 *
 * @param resourceType - Resource type
 * @param resourceId - Resource ID
 * @returns Array of active token records
 */
export async function listScopedTokensForResource(
  resourceType: string,
  resourceId: string
): Promise<Pick<ScopedAccessToken, 'id' | 'displayName' | 'role' | 'expiresAt' | 'lastActiveAt'>[]> {
  const db = useDB()

  const records = await db
    .select({
      id: scopedAccessToken.id,
      displayName: scopedAccessToken.displayName,
      role: scopedAccessToken.role,
      expiresAt: scopedAccessToken.expiresAt,
      lastActiveAt: scopedAccessToken.lastActiveAt
    })
    .from(scopedAccessToken)
    .where(
      and(
        eq(scopedAccessToken.resourceType, resourceType),
        eq(scopedAccessToken.resourceId, resourceId),
        eq(scopedAccessToken.isActive, true),
        gt(scopedAccessToken.expiresAt, new Date())
      )
    )

  return records
}

/** Fallback token lifetime when a token has no backing grant (mint-issued). */
const DEFAULT_SCOPED_TOKEN_TTL = 8 * 60 * 60 * 1000 // 8 hours

/**
 * Look up the grant governing a token's resource, for its TTL policy.
 * Returns null when no active grant backs the resource (e.g. mint-issued tokens).
 */
async function getScopedGrant(
  organizationId: string,
  resourceType: string,
  resourceId: string,
  credentialType = 'pin'
): Promise<{ tokenTtl: number | null } | null> {
  const db = useDB()
  const [grant] = await db
    .select({ tokenTtl: scopedAccessGrant.tokenTtl })
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.organizationId, organizationId),
        eq(scopedAccessGrant.resourceType, resourceType),
        eq(scopedAccessGrant.resourceId, resourceId),
        eq(scopedAccessGrant.credentialType, credentialType),
        eq(scopedAccessGrant.isActive, true)
      )
    )
    .limit(1)
  return grant ?? null
}

/**
 * Extend (slide forward) a scoped token's expiration.
 *
 * The new expiry is bounded by the token's grant policy (its tokenTtl), and an
 * already-expired token cannot be refreshed — see the body for the rationale.
 *
 * @param token - Token string (of a currently-valid token)
 * @returns New expiration date, or null if the token is missing/inactive/expired
 */
export async function extendScopedToken(
  token: string
): Promise<Date | null> {
  const db = useDB()
  const now = new Date()

  // Only a still-active, NOT-yet-expired token can be refreshed. Expiry is the
  // revocation mechanism for scoped tokens, so a lapsed token must stay dead —
  // the holder must re-redeem the grant rather than reviving it here.
  const [record] = await db
    .select()
    .from(scopedAccessToken)
    .where(
      and(
        eq(scopedAccessToken.token, token),
        eq(scopedAccessToken.isActive, true),
        gt(scopedAccessToken.expiresAt, now)
      )
    )
    .limit(1)

  if (!record) {
    return null
  }

  // Slide the expiry forward to a window bounded by the token's GRANT policy
  // (its tokenTtl), never an unbounded client-supplied amount. Tokens with no
  // backing grant (e.g. mint-issued) fall back to the default ceiling.
  const grant = await getScopedGrant(record.organizationId, record.resourceType, record.resourceId)
  const ttl = grant?.tokenTtl ?? DEFAULT_SCOPED_TOKEN_TTL
  const newExpiresAt = new Date(now.getTime() + ttl)

  await db
    .update(scopedAccessToken)
    .set({ expiresAt: newExpiresAt })
    .where(eq(scopedAccessToken.id, record.id))

  return newExpiresAt
}

// ============================================================================
// Scoped Access Grants
// ============================================================================

/**
 * Hash a grant secret with a random salt.
 *
 * PINs are low-entropy, so the hash is NOT the security boundary here —
 * the per-grant lockout in verifyAndRedeemGrant is. SHA-256 keeps this
 * cheap on Workers; the salt only prevents trivial cross-grant comparison.
 */
async function hashGrantSecret(secret: string, saltHex?: string): Promise<string> {
  const salt = saltHex ?? Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  const data = new TextEncoder().encode(`${salt}:${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hash = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return `${salt}:${hash}`
}

async function verifyGrantSecret(secret: string, stored: string): Promise<boolean> {
  const [salt] = stored.split(':')
  if (!salt) return false
  return (await hashGrantSecret(secret, salt)) === stored
}

/** Lockout policy: after this many consecutive failures, redemption locks */
const GRANT_LOCKOUT_THRESHOLD = 5
/** Base lockout duration; doubles with each failure past the threshold */
const GRANT_LOCKOUT_BASE_MS = 60 * 1000
/** Lockout never exceeds this */
const GRANT_LOCKOUT_MAX_MS = 60 * 60 * 1000

function lockoutDuration(failedAttempts: number): number {
  const past = failedAttempts - GRANT_LOCKOUT_THRESHOLD
  return Math.min(GRANT_LOCKOUT_BASE_MS * 2 ** Math.max(past, 0), GRANT_LOCKOUT_MAX_MS)
}

/**
 * Options for creating or updating a grant
 */
export interface UpsertScopedGrantOptions {
  /** Organization/team ID */
  organizationId: string
  /** Type of resource the grant unlocks (e.g., 'event', 'page') */
  resourceType: string
  /** ID of the specific resource */
  resourceId: string
  /** Plaintext secret (PIN); hashed before storage */
  secret: string
  /** Role stamped onto tokens minted from this grant (default: 'guest') */
  role?: string
  /** Credential presentation type (default: 'pin') */
  credentialType?: string
  /** Max successful redemptions; null/undefined = unlimited */
  maxUses?: number | null
  /** When the grant stops being redeemable; null = no expiry */
  expiresAt?: Date | null
  /** Lifetime (ms) of tokens minted from this grant (default: 8 hours) */
  tokenTtl?: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /**
   * Skip the UPDATE when the existing grant is locked out. For lazy syncs
   * driven by public login attempts (e.g. the before-redeem hook): a
   * locked-out attacker must not be able to drive a DB write per attempt.
   */
  skipWhenLocked?: boolean
}

/**
 * Create or update the grant for a resource + credential type.
 *
 * One grant per (organization, resourceType, resourceId, credentialType).
 * Safe to call on every login attempt (lazy sync from the domain's source
 * credential): when the secret is unchanged, usage counters and lockout
 * state are preserved — otherwise repeated syncing would defeat the
 * brute-force protection. A changed secret starts a new lifecycle and
 * resets everything.
 */
export async function upsertScopedGrant(
  options: UpsertScopedGrantOptions
): Promise<{ id: string }> {
  const {
    organizationId,
    resourceType,
    resourceId,
    secret,
    role = 'guest',
    credentialType = 'pin',
    maxUses = null,
    expiresAt = null,
    tokenTtl = 8 * 60 * 60 * 1000,
    metadata,
    skipWhenLocked = false
  } = options

  const db = useDB()

  const [existing] = await db
    .select()
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.organizationId, organizationId),
        eq(scopedAccessGrant.resourceType, resourceType),
        eq(scopedAccessGrant.resourceId, resourceId),
        eq(scopedAccessGrant.credentialType, credentialType)
      )
    )
    .limit(1)

  if (existing) {
    if (skipWhenLocked && existing.lockedUntil && existing.lockedUntil > new Date()) {
      return { id: existing.id }
    }
    const secretUnchanged = await verifyGrantSecret(secret, existing.secretHash)
    await db
      .update(scopedAccessGrant)
      .set({
        role,
        maxUses,
        expiresAt,
        tokenTtl,
        isActive: true,
        metadata: metadata ? JSON.stringify(metadata) : null,
        ...(secretUnchanged
          ? {}
          : {
              secretHash: await hashGrantSecret(secret),
              usedCount: 0,
              failedAttempts: 0,
              lockedUntil: null
            })
      })
      .where(eq(scopedAccessGrant.id, existing.id))
    return { id: existing.id }
  }

  const secretHash = await hashGrantSecret(secret)

  const id = crypto.randomUUID()
  await db.insert(scopedAccessGrant).values({
    id,
    organizationId,
    resourceType,
    resourceId,
    role,
    credentialType,
    secretHash,
    maxUses,
    expiresAt,
    tokenTtl,
    metadata: metadata ? JSON.stringify(metadata) : null
  })
  return { id }
}

/**
 * Options for redeeming a grant
 */
export interface RedeemGrantOptions {
  /** Organization/team ID */
  organizationId: string
  /** Resource type the caller wants access to */
  resourceType: string
  /** Resource ID the caller wants access to */
  resourceId: string
  /** Presented secret (PIN) */
  secret: string
  /** Display name for the minted token holder */
  displayName: string
  /** Credential presentation type (default: 'pin') */
  credentialType?: string
}

/**
 * Result of a redemption attempt. Callers map `reason` to HTTP responses;
 * 'not_found' and 'invalid_secret' should be indistinguishable to clients.
 */
export type RedeemGrantResult =
  | {
    ok: true
    token: string
    tokenId: string
    expiresAt: Date
    role: string
    resourceType: string
    resourceId: string
    displayName: string
  }
  | { ok: false; reason: 'not_found' | 'invalid_secret' | 'locked' | 'exhausted'; retryAfterMs?: number }

/**
 * Verify a presented credential against a resource's grant and, on success,
 * mint a scoped access token.
 *
 * Brute-force protection is per-grant: after GRANT_LOCKOUT_THRESHOLD
 * consecutive failures the grant locks for an exponentially growing window.
 * This is the actual security boundary for low-entropy PINs — callers must
 * not bypass it with direct token minting for unverified input.
 */
export async function verifyAndRedeemGrant(
  options: RedeemGrantOptions
): Promise<RedeemGrantResult> {
  const {
    organizationId,
    resourceType,
    resourceId,
    secret,
    displayName,
    credentialType = 'pin'
  } = options

  const db = useDB()
  const now = new Date()

  const [grant] = await db
    .select()
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.organizationId, organizationId),
        eq(scopedAccessGrant.resourceType, resourceType),
        eq(scopedAccessGrant.resourceId, resourceId),
        eq(scopedAccessGrant.credentialType, credentialType),
        eq(scopedAccessGrant.isActive, true)
      )
    )
    .limit(1)

  if (!grant || (grant.expiresAt && grant.expiresAt <= now)) {
    return { ok: false, reason: 'not_found' }
  }

  if (grant.lockedUntil && grant.lockedUntil > now) {
    return { ok: false, reason: 'locked', retryAfterMs: grant.lockedUntil.getTime() - now.getTime() }
  }

  if (!(await verifyGrantSecret(secret, grant.secretHash))) {
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
      : { ok: false, reason: 'invalid_secret' }
  }

  if (grant.maxUses !== null && grant.usedCount >= grant.maxUses) {
    return { ok: false, reason: 'exhausted' }
  }

  await db
    .update(scopedAccessGrant)
    .set({
      usedCount: sql`${scopedAccessGrant.usedCount} + 1`,
      failedAttempts: 0,
      lockedUntil: null
    })
    .where(eq(scopedAccessGrant.id, grant.id))

  const { token, id: tokenId, expiresAt } = await createScopedToken({
    organizationId,
    resourceType,
    resourceId,
    displayName,
    role: grant.role,
    expiresIn: grant.tokenTtl
  })

  return {
    ok: true,
    token,
    tokenId,
    expiresAt,
    role: grant.role,
    resourceType,
    resourceId,
    displayName
  }
}

/**
 * Options for verifying a credential by resource alone (no organization).
 */
export interface VerifyGrantByResourceOptions {
  /** Resource type the credential claims (e.g. 'print-device') */
  resourceType: string
  /** Resource ID — for devices, the device's self-generated id */
  resourceId: string
  /** Presented secret */
  secret: string
  /** Credential presentation type (default: 'pin') */
  credentialType?: string
}

export type VerifyGrantByResourceResult =
  | { ok: true, organizationId: string, grantId: string, role: string }
  | { ok: false, reason: 'not_found' | 'invalid_secret' | 'locked', retryAfterMs?: number }

/**
 * Verify a presented credential against a resource's grant WITHOUT knowing
 * the organization — the grant's `organizationId` IS the answer ("whose
 * device is this?"). Built for the inverse-pairing device poll (#1366): the
 * router presents its self-generated id + printed code on every poll, so
 * unlike `verifyAndRedeemGrant` this mints no token, never bumps `usedCount`,
 * and a clean success performs NO database write. Failure counting and the
 * exponential lockout are shared with redemption — this is the security
 * boundary for the low-entropy printed code.
 */
export async function verifyScopedGrantByResource(
  options: VerifyGrantByResourceOptions
): Promise<VerifyGrantByResourceResult> {
  const { resourceType, resourceId, secret, credentialType = 'pin' } = options

  const db = useDB()
  const now = new Date()

  const [grant] = await db
    .select()
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.resourceType, resourceType),
        eq(scopedAccessGrant.resourceId, resourceId),
        eq(scopedAccessGrant.credentialType, credentialType),
        eq(scopedAccessGrant.isActive, true)
      )
    )
    .limit(1)

  if (!grant || (grant.expiresAt && grant.expiresAt <= now)) {
    return { ok: false, reason: 'not_found' }
  }

  if (grant.lockedUntil && grant.lockedUntil > now) {
    return { ok: false, reason: 'locked', retryAfterMs: grant.lockedUntil.getTime() - now.getTime() }
  }

  if (!(await verifyGrantSecret(secret, grant.secretHash))) {
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
      : { ok: false, reason: 'invalid_secret' }
  }

  // Reset failure state only when there is something to reset — this path
  // runs on every ~2s device poll and must stay write-free when clean.
  if (grant.failedAttempts > 0 || grant.lockedUntil) {
    await db
      .update(scopedAccessGrant)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(scopedAccessGrant.id, grant.id))
  }

  return { ok: true, organizationId: grant.organizationId, grantId: grant.id, role: grant.role }
}

/**
 * Revoke all grants for a resource.
 *
 * Auth can't FK into domain tables, so domains must call this when the
 * resource is deleted or closed. Existing tokens are untouched — revoke
 * those separately via revokeScopedTokensForResource if needed.
 */
export async function revokeScopedGrantsForResource(
  resourceType: string,
  resourceId: string
): Promise<number> {
  const db = useDB()

  const result = await db
    .update(scopedAccessGrant)
    .set({ isActive: false })
    .where(
      and(
        eq(scopedAccessGrant.resourceType, resourceType),
        eq(scopedAccessGrant.resourceId, resourceId),
        eq(scopedAccessGrant.isActive, true)
      )
    )

  return result.rowsAffected
}

/**
 * List active grants for a resource (secrets are never returned)
 */
export async function listScopedGrantsForResource(
  resourceType: string,
  resourceId: string
): Promise<Pick<ScopedAccessGrant, 'id' | 'role' | 'credentialType' | 'maxUses' | 'usedCount' | 'expiresAt' | 'createdAt'>[]> {
  const db = useDB()

  return db
    .select({
      id: scopedAccessGrant.id,
      role: scopedAccessGrant.role,
      credentialType: scopedAccessGrant.credentialType,
      maxUses: scopedAccessGrant.maxUses,
      usedCount: scopedAccessGrant.usedCount,
      expiresAt: scopedAccessGrant.expiresAt,
      createdAt: scopedAccessGrant.createdAt
    })
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.resourceType, resourceType),
        eq(scopedAccessGrant.resourceId, resourceId),
        eq(scopedAccessGrant.isActive, true)
      )
    )
}

/**
 * Clean up expired tokens
 *
 * Should be called periodically (e.g., in a cron job) to remove old tokens.
 *
 * @returns Number of tokens deleted
 */
export async function cleanupExpiredScopedTokens(): Promise<number> {
  const db = useDB()

  // Delete tokens expired more than 24 hours ago
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const result = await db
    .delete(scopedAccessToken)
    .where(
      and(
        eq(scopedAccessToken.isActive, false)
      )
    )

  // Also delete very old expired active tokens (expiresAt < cutoff)
  const oldResult = await db
    .delete(scopedAccessToken)
    .where(
      and(
        eq(scopedAccessToken.isActive, true),
        lt(scopedAccessToken.expiresAt, cutoff)
      )
    )

  return result.rowsAffected + oldResult.rowsAffected
}
