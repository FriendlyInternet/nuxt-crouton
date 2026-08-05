/**
 * Device-scoped polling endpoint (#1366) — the zero-SSH successor of
 * `events/[eventId]/jobs`. The router authenticates with its persistent
 * `x-device-id` + printed `x-device-code`; the claim (which team it belongs
 * to) lives in a scoped-access grant, resolved over the
 * `crouton:printing:device-auth` hook.
 *
 * Responses, chosen so the battle-tested BusyBox job parser stays untouched:
 * - 200 → the SAME bare jobs array as the legacy endpoint (claimed device;
 *   jobs for the team's router-spooler events only, #1324). Pass
 *   `?mark_as_printing=true` to atomically flip status→1.
 * - 428 → `{ status: 'unclaimed', ticket }` — the device exists but nobody
 *   claimed it; `ticket` is a server-rendered base64 ESC/POS pairing ticket
 *   (localized here — the router never composes text).
 * - 401/429 → wrong code / brute-force lockout.
 * - 501 → no credential-owning package answered the hook (pairing not wired).
 */
import type { H3Event } from 'h3'
import { getDeviceCredentials, resolveDeviceAuth, listTeamSpoolerJobs, type DeviceAuthResult, type DeviceCredentials } from '../../utils/spooler-device'
import { formatPairingTicket } from '../../utils/receipt-formatter'

function throwDenied(event: H3Event, retryAfterMs?: number): never {
  if (retryAfterMs) {
    setHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000))
    throw createError({ status: 429, statusText: 'Locked' })
  }
  throw createError({ status: 401, statusText: 'Invalid device credentials' })
}

/** Credentials → verified auth result, or the right HTTP error. */
async function requireDeviceAuth(event: H3Event, creds: DeviceCredentials | null): Promise<{ creds: DeviceCredentials, auth: Exclude<DeviceAuthResult, { status: 'denied' }> }> {
  if (!creds) {
    throw createError({ status: 400, statusText: 'Device credentials required' })
  }
  const auth = await resolveDeviceAuth(creds)
  if (!auth) {
    throw createError({ status: 501, statusText: 'Device pairing is not available on this app' })
  }
  if (auth.status === 'denied') {
    throwDenied(event, auth.retryAfterMs)
  }
  return { creds, auth }
}

export default defineEventHandler(async (event) => {
  const { creds, auth } = await requireDeviceAuth(event, getDeviceCredentials(event))

  if (auth.status === 'unclaimed') {
    const ticket = formatPairingTicket({
      deviceId: creds.deviceId,
      code: creds.code,
      locale: auth.locale,
      appUrl: getRequestURL(event).origin
    })
    setResponseStatus(event, 428)
    return { status: 'unclaimed', ticket: ticket.base64 }
  }

  const markAsPrinting = String(getQuery(event).mark_as_printing) === 'true'
  return await listTeamSpoolerJobs(useDB(), auth.teamId, markAsPrinting)
})
