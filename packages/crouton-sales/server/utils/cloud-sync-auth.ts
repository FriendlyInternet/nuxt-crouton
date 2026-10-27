/**
 * Auth for the Pi→cloud sync ingest (#178, #2725).
 *
 * Two ways in, mutually exclusive per request:
 *
 * 1. **Paired device (preferred, #2725)** — the till sends the identity it got
 *    at pairing (`x-device-id` + `x-device-secret`). The secret is verified
 *    against the device's crouton-auth grant (same mechanism as the print
 *    device auth), and the grant's organization is the team every applied row
 *    is scoped to.
 * 2. **Shared secret (deprecated)** — `x-sync-key` against
 *    runtimeConfig.croutonSales.cloudSyncSecret. Only honoured when NO device
 *    headers are sent, so existing single-venue setups keep working.
 *
 * Both are **fail-closed**: a device with bad credentials is rejected (never
 * falls back to the shared key), and an unset shared secret rejects everything.
 */
import type { H3Event } from 'h3'

export const SYNC_DEVICE_ID_HEADER = 'x-device-id'
export const SYNC_DEVICE_SECRET_HEADER = 'x-device-secret'
const TILL_DEVICE_RESOURCE_TYPE = 'till-device'

export type SyncIdentity
  = | { kind: 'device', deviceId: string, teamId: string }
    | { kind: 'shared-key' }

export type VerifyDevice = (deviceId: string, secret: string) => Promise<
  { ok: true, organizationId: string } | { ok: false, reason?: string }
>

async function defaultVerifyDevice(deviceId: string, secret: string) {
  const { verifyScopedGrantByResource } = await import('@fyit/crouton-auth/server/utils/scoped-access')
  return verifyScopedGrantByResource({
    resourceType: TILL_DEVICE_RESOURCE_TYPE,
    resourceId: deviceId,
    secret
  }) as Promise<{ ok: true, organizationId: string } | { ok: false, reason?: string }>
}

/** Deprecated shared-secret check. */
export function requireCloudSyncKey(event: H3Event): void {
  const config = useRuntimeConfig(event)
  const expected = (config.croutonSales as { cloudSyncSecret?: string } | undefined)?.cloudSyncSecret

  // Fail closed: no secret set ⇒ no access (don't fall back to a default).
  if (!expected) {
    throw createError({ status: 503, statusText: 'Cloud sync not configured' })
  }

  const got = getHeader(event, 'x-sync-key')
  if (got !== expected) {
    throw createError({ status: 401, statusText: 'Invalid sync key' })
  }
}

/**
 * Identify the caller. Device headers present ⇒ device auth only; absent ⇒
 * the legacy shared key. `verify` is injectable for tests.
 */
export async function authenticateSync(
  event: H3Event,
  verify: VerifyDevice = defaultVerifyDevice
): Promise<SyncIdentity> {
  const deviceId = getHeader(event, SYNC_DEVICE_ID_HEADER)?.trim()
  const secret = getHeader(event, SYNC_DEVICE_SECRET_HEADER)?.trim()

  if (!deviceId && !secret) {
    requireCloudSyncKey(event)
    return { kind: 'shared-key' }
  }
  if (!deviceId || !secret) {
    throw createError({ status: 401, statusText: 'Invalid device credentials' })
  }

  const verified = await verify(deviceId, secret)
  if (!verified.ok) {
    throw createError({ status: 401, statusText: 'Invalid device credentials' })
  }
  return { kind: 'device', deviceId, teamId: verified.organizationId }
}
