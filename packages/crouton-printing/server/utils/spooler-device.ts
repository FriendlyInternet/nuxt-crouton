/**
 * Device-scoped spooler support (#1366) — the inverse-pairing flow: the
 * router identifies itself with a persistent id + printed code, and the app
 * couples that device to a team. From then on the device polls ONE endpoint
 * (`GET /api/print-server/jobs`) and receives every pending `network-escpos`
 * job for the claimed team's events whose Print flow is 'router-spooler'
 * (#1324) — the picker stays the only per-event switch, so a second claimed
 * router on the same app can never receive another venue's jobs.
 *
 * This package has no auth, so WHO owns a device is answered over a Nitro
 * hook: `crouton:printing:device-auth`. The domain that owns credentials
 * (crouton-sales, via crouton-auth's scoped-access grants) subscribes and
 * sets `ctx.result`. No subscriber ⇒ the endpoint answers 501 — pairing is
 * simply not wired in this app.
 */
import type { H3Event } from 'h3'
import { PRINT_TRANSPORT, shouldStampHeartbeat } from './print-transport'
import { PRINT_STATUS } from './print-job-queue'

export const DEVICE_ID_HEADER = 'x-device-id'
export const DEVICE_CODE_HEADER = 'x-device-code'

export interface DeviceCredentials {
  deviceId: string
  code: string
}

export type DeviceAuthResult =
  | { status: 'claimed', teamId: string }
  | { status: 'unclaimed', locale?: 'en' | 'nl' | 'fr' }
  | { status: 'denied', retryAfterMs?: number }

export interface DeviceAuthContext extends DeviceCredentials {
  /** Mutable answer — set by the credential-owning domain's subscriber. */
  result: DeviceAuthResult | null
}

/** Read the device headers; null when the caller isn't a paired-mode device. */
export function getDeviceCredentials(event: H3Event): DeviceCredentials | null {
  const deviceId = getHeader(event, DEVICE_ID_HEADER)?.trim().toLowerCase()
  const code = getHeader(event, DEVICE_CODE_HEADER)?.trim()
  if (!deviceId || !code) return null
  return { deviceId, code }
}

/**
 * Ask the credential-owning domain who this device is. Returns null when no
 * subscriber answered (pairing not wired in this app).
 */
export async function resolveDeviceAuth(creds: DeviceCredentials): Promise<DeviceAuthResult | null> {
  const ctx: DeviceAuthContext = { ...creds, result: null }
  await useNitroApp().hooks.callHook('crouton:printing:device-auth' as any, ctx)
  return ctx.result
}

/** The job's owning team — the callback endpoints scope device auth with it. */
export async function getPrintJobTeamId(db: any, jobId: string): Promise<string | null | undefined> {
  const { eq } = await import('drizzle-orm')
  const { printJobs } = await import('../database/schema')
  const [row] = await db
    .select({ teamId: printJobs.teamId })
    .from(printJobs)
    .where(eq(printJobs.id, jobId))
    .limit(1)
  // undefined = no such job; null = a job without team correlation.
  return row ? row.teamId : undefined
}

/**
 * All pending thermal jobs the claimed team's router may print: every
 * `network-escpos` job of the team whose event's Print flow allows the
 * spooler (row missing = the router-spooler default; 'local-drainer'/'none'
 * events are excluded — and event-LESS jobs stay drainer-only, they have no
 * transport row to gate them). Also stamps the throttled `lastSpoolerPollAt`
 * heartbeat on every served event's transport row (mirrors spoolerMayServe).
 */
export async function listTeamSpoolerJobs(db: any, teamId: string, claim: boolean): Promise<any[]> {
  const { eq, and, inArray, isNotNull } = await import('drizzle-orm')
  const { printJobs, printTransports } = await import('../database/schema')

  const rows = await db
    .select({
      id: printJobs.id,
      printData: printJobs.payload,
      printMode: printJobs.printMode,
      locationId: printJobs.locationId,
      printerId: printJobs.printerId,
      retryCount: printJobs.retryCount,
      printerIp: printJobs.printerIp,
      printerPort: printJobs.printerPort,
      printerTitle: printJobs.printerTitle,
      eventId: printJobs.eventId
    })
    .from(printJobs)
    .where(
      and(
        eq(printJobs.teamId, teamId),
        eq(printJobs.status, PRINT_STATUS.PENDING),
        eq(printJobs.driver, 'network-escpos'),
        isNotNull(printJobs.eventId)
      )
    )

  // Which of the team's events may the router serve? A transport row routes
  // the event; a MISSING row means the router-spooler default.
  const transports = await db
    .select()
    .from(printTransports)
    .where(eq(printTransports.teamId, teamId))

  const routedElsewhere = new Set(
    transports
      .filter((t: any) => t.transport !== PRINT_TRANSPORT.ROUTER_SPOOLER)
      .map((t: any) => t.eventId)
  )
  const served = rows.filter((r: any) => !routedElsewhere.has(r.eventId))

  // Liveness heartbeat for the settings UI — throttled, existing rows only.
  const now = new Date()
  const stampIds = transports
    .filter((t: any) => t.transport === PRINT_TRANSPORT.ROUTER_SPOOLER && shouldStampHeartbeat(t.lastSpoolerPollAt, now))
    .map((t: any) => t.eventId)
  if (stampIds.length > 0) {
    await db
      .update(printTransports)
      .set({ lastSpoolerPollAt: now.toISOString() })
      .where(inArray(printTransports.eventId, stampIds))
  }

  if (claim && served.length > 0) {
    await db
      .update(printJobs)
      .set({ status: PRINT_STATUS.PRINTING, updatedAt: now })
      .where(inArray(printJobs.id, served.map((r: { id: string }) => r.id)))
  }

  // The spooler's job-row contract has no eventId — keep the shape identical
  // to the legacy per-event endpoint.
  return served.map(({ eventId: _eventId, ...job }: any) => job)
}
