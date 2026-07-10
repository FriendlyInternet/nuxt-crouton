/**
 * @crouton-package crouton-printing
 * @description Per-event transport selection for `network-escpos` jobs (#1324).
 *
 * One `print_transports` row per event decides WHO delivers that event's
 * thermal jobs: the in-process TCP drainer (`local-drainer`), the on-site
 * router spooler (`router-spooler`), or nobody (`none` — jobs stay pending).
 * The choice is ALWAYS exclusive: an event without a row uses
 * DEFAULT_PRINT_TRANSPORT (`router-spooler`, the cloud/production flow), so
 * two transports can never serve the same event.
 *
 * The gate is consulted at both drain points — `drainPendingEscposJobs` and
 * the spooler's `jobs.get` endpoint — via `transportAllows`. `db` is passed by
 * the caller and the schema is imported lazily, same decoupling as the rest of
 * this package's server utils.
 */
import { eq } from 'drizzle-orm'

export const PRINT_TRANSPORT = {
  LOCAL_DRAINER: 'local-drainer',
  ROUTER_SPOOLER: 'router-spooler',
  NONE: 'none'
} as const

export type PrintTransport = typeof PRINT_TRANSPORT[keyof typeof PRINT_TRANSPORT]

/** What an event without a row uses — the cloud/production flow. */
export const DEFAULT_PRINT_TRANSPORT: PrintTransport = PRINT_TRANSPORT.ROUTER_SPOOLER

/** How long a heartbeat stays "fresh" — re-stamped only after this. */
export const HEARTBEAT_THROTTLE_MS = 30_000

export function isPrintTransport(value: unknown): value is PrintTransport {
  return value === PRINT_TRANSPORT.LOCAL_DRAINER
    || value === PRINT_TRANSPORT.ROUTER_SPOOLER
    || value === PRINT_TRANSPORT.NONE
}

/**
 * May `consumer` deliver jobs for an event whose transport setting is
 * `transport`? `null`/`undefined` (no row) resolves to
 * DEFAULT_PRINT_TRANSPORT — the choice is always exclusive.
 */
export function transportAllows(
  transport: string | null | undefined,
  consumer: typeof PRINT_TRANSPORT.LOCAL_DRAINER | typeof PRINT_TRANSPORT.ROUTER_SPOOLER
): boolean {
  return (transport ?? DEFAULT_PRINT_TRANSPORT) === consumer
}

/**
 * Throttle for the liveness columns: stamp when never stamped, unparseable,
 * or older than HEARTBEAT_THROTTLE_MS — so a 2s poll loop writes at most once
 * per window instead of every tick.
 */
export function shouldStampHeartbeat(lastIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastIso) return true
  const last = Date.parse(lastIso)
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= HEARTBEAT_THROTTLE_MS
}

/** The transport row for one event, or null (no explicit choice — the
 *  DEFAULT_PRINT_TRANSPORT applies). */
export async function getPrintTransport(db: any, eventId: string): Promise<any | null> {
  const { printTransports } = await import('../database/schema')
  const rows = await db.select().from(printTransports).where(eq(printTransports.eventId, eventId))
  return rows[0] ?? null
}

/**
 * Every recorded transport row (optionally scoped to one event) — the drainer
 * reads the whole table per tick (one row per event, tiny).
 */
export async function getAllPrintTransports(db: any, eventId?: string): Promise<any[]> {
  const { printTransports } = await import('../database/schema')
  return await db
    .select()
    .from(printTransports)
    .where(eventId ? eq(printTransports.eventId, eventId) : undefined)
}

/**
 * The spooler endpoint's side of the gate: may the HTTP spooler serve this
 * event's jobs? While allowed, stamps the `lastSpoolerPollAt` liveness
 * heartbeat (throttled) for the settings UI.
 */
export async function spoolerMayServe(db: any, eventId: string): Promise<boolean> {
  const row = await getPrintTransport(db, eventId)
  if (!transportAllows(row?.transport, PRINT_TRANSPORT.ROUTER_SPOOLER)) {
    return false
  }
  if (row && shouldStampHeartbeat(row.lastSpoolerPollAt)) {
    const { printTransports } = await import('../database/schema')
    await db
      .update(printTransports)
      .set({ lastSpoolerPollAt: new Date().toISOString() })
      .where(eq(printTransports.eventId, eventId))
  }
  return true
}

/** Record (or change) an event's transport choice. */
export async function upsertPrintTransport(
  db: any,
  input: { eventId: string, transport: PrintTransport, teamId?: string | null }
): Promise<void> {
  if (!isPrintTransport(input.transport)) {
    throw new Error(`Invalid print transport '${String(input.transport)}' — expected ${Object.values(PRINT_TRANSPORT).join(' | ')}`)
  }
  const { printTransports } = await import('../database/schema')
  const now = new Date()
  await db
    .insert(printTransports)
    .values({ eventId: input.eventId, transport: input.transport, teamId: input.teamId ?? null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: printTransports.eventId,
      set: { transport: input.transport, ...(input.teamId != null ? { teamId: input.teamId } : {}), updatedAt: now }
    })
}
