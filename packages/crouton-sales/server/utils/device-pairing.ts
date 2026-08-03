/**
 * Sales-side device pairing (#1662) — the server half of #803's onboarding.
 *
 * The owner mints a one-time code from the app; a freshly installed till
 * redeems it and binds itself to the organization (and, when one is running,
 * the current event). The credential machinery itself lives in crouton-auth
 * (#1661) — this module is only the sales-domain layer on top of it:
 * active-event resolution, the device inventory, and the HTTP mapping.
 *
 * Invariant carried from #1366/#1661: a device IS its `scopedAccessGrant`.
 * There is no `devices` table.
 *
 * Logic lives here rather than in the route handlers so it stays testable
 * without booting Nitro — the house pattern (cf. `delete-order.ts`).
 */
import { eq, and, inArray } from 'drizzle-orm'
import { scopedAccessGrant } from '@fyit/crouton-auth/server/database/schema/auth'
import {
  redeemPairingCode,
  TILL_DEVICE_RESOURCE_TYPE
} from '@fyit/crouton-auth/server/utils/pairing-code'
// App-owned collection schema, reached through the consuming app's alias —
// the same route `server/plugins/scoped-access.ts` already uses.
import { salesEvents } from '~~/layers/sales/collections/events/server/database/schema'

/** #1366's routers. Listed and revoked alongside tills. */
const PRINT_DEVICE_RESOURCE_TYPE = 'print-device'

const DEVICE_RESOURCE_TYPES = [TILL_DEVICE_RESOURCE_TYPE, PRINT_DEVICE_RESOURCE_TYPE]

/**
 * Redeem failure → HTTP status. Mirrors the existing scoped-access redeem
 * endpoint exactly (429 locked / 410 spent / 401 otherwise) so a device sees
 * one consistent contract regardless of which door it knocked on.
 */
export const REDEEM_FAILURE_STATUS = {
  locked: 429,
  exhausted: 410,
  expired: 410,
  invalid: 401
} as const

export type RedeemFailureReason = keyof typeof REDEEM_FAILURE_STATUS

export interface ClaimDeviceOptions {
  /** The pairing code as typed on the device */
  code: string
  /** Operator-facing name for the till ("Bar till 1") */
  deviceName: string
}

export type ClaimDeviceResult
  = | {
    ok: true
    deviceId: string
    orgId: string
    /** The org's current event, or null when none is running yet */
    eventId: string | null
    token: string
    tokenExpiresAt: Date
    /** Returned ONCE, at claim time — the device persists it */
    deviceSecret: string
  }
  | {
    ok: false
    reason: RedeemFailureReason
    status: number
    retryAfterSeconds?: number
  }

/**
 * Resolve the organization's current event.
 *
 * Deliberately tolerant: a till is often provisioned before the event row
 * exists, so "no current event" is a normal state, not an error. The event is
 * resolved again at use time.
 */
async function findCurrentEventId(organizationId: string): Promise<string | null> {
  const db = useDB()
  const [row] = await db
    .select({ id: salesEvents.id })
    .from(salesEvents)
    .where(and(eq(salesEvents.teamId, organizationId), eq(salesEvents.isCurrent, true)))
    .limit(1)
  return row?.id ?? null
}

/**
 * Claim a till device with a pairing code.
 *
 * PUBLIC entry point — the code is the only credential, so brute-force
 * protection is the grant lockout in crouton-auth. Note the ordering: nothing
 * touches the database until the code has actually verified, so an
 * unauthenticated caller cannot drive queries by guessing.
 */
export async function claimDevice(options: ClaimDeviceOptions): Promise<ClaimDeviceResult> {
  const { code, deviceName } = options

  const redeemed = await redeemPairingCode({ code, deviceName })

  if (!redeemed.ok) {
    const reason = redeemed.reason as RedeemFailureReason
    return {
      ok: false,
      reason,
      status: REDEEM_FAILURE_STATUS[reason] ?? 401,
      ...(redeemed.retryAfterMs
        ? { retryAfterSeconds: Math.ceil(redeemed.retryAfterMs / 1000) }
        : {})
    }
  }

  const orgId = redeemed.grant.organizationId

  return {
    ok: true,
    deviceId: redeemed.grant.resourceId,
    orgId,
    eventId: await findCurrentEventId(orgId),
    token: redeemed.token,
    tokenExpiresAt: redeemed.tokenExpiresAt,
    deviceSecret: redeemed.deviceSecret
  }
}

export interface TeamDevice {
  deviceId: string
  /** 'till-device' (this flow) or 'print-device' (#1366's routers) */
  type: string
  claimedAt: Date | null
}

/**
 * List a team's claimed devices — tills and routers together, since to an
 * operator they are one inventory. Secrets never leave the server.
 */
export async function listTeamDevices(organizationId: string): Promise<TeamDevice[]> {
  const db = useDB()
  const rows = await db
    .select({
      deviceId: scopedAccessGrant.resourceId,
      resourceType: scopedAccessGrant.resourceType,
      claimedAt: scopedAccessGrant.createdAt
    })
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.organizationId, organizationId),
        inArray(scopedAccessGrant.resourceType, DEVICE_RESOURCE_TYPES),
        eq(scopedAccessGrant.isActive, true)
      )
    )
    .limit(500)

  return rows.map(r => ({
    deviceId: r.deviceId,
    type: r.resourceType,
    claimedAt: r.claimedAt ?? null
  }))
}

/**
 * Revoke a device.
 *
 * Deactivates rather than deletes, matching how a consumed pairing grant is
 * retired — the row stays as an audit trail of what was once claimed. The
 * lookup is team-scoped, so one team can never revoke another's device
 * (returns false rather than throwing; the caller maps that to 404).
 */
export async function revokeTeamDevice(
  organizationId: string,
  deviceId: string
): Promise<boolean> {
  const db = useDB()

  const [grant] = await db
    .select({ id: scopedAccessGrant.id, organizationId: scopedAccessGrant.organizationId })
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.organizationId, organizationId),
        eq(scopedAccessGrant.resourceId, deviceId),
        inArray(scopedAccessGrant.resourceType, DEVICE_RESOURCE_TYPES),
        eq(scopedAccessGrant.isActive, true)
      )
    )
    .limit(1)

  if (!grant) return false

  await db
    .update(scopedAccessGrant)
    .set({ isActive: false })
    .where(eq(scopedAccessGrant.id, grant.id))

  return true
}
