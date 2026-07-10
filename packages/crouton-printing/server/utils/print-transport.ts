/**
 * @crouton-package crouton-printing
 * @description Per-event transport selection for `network-escpos` jobs (#1324).
 *
 * One `print_transports` row per event decides WHO delivers that event's
 * thermal jobs: the in-process TCP drainer (`local-drainer`), the on-site
 * router spooler (`router-spooler`), or nobody (`none` — jobs stay pending).
 * No row = legacy behaviour: both transports allowed, exactly the pre-#1324
 * world, so existing rigs keep working without a settings row.
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

/** How long a heartbeat stays "fresh" — re-stamped only after this. */
export const HEARTBEAT_THROTTLE_MS = 30_000

export function isPrintTransport(value: unknown): value is PrintTransport {
  return value === PRINT_TRANSPORT.LOCAL_DRAINER
    || value === PRINT_TRANSPORT.ROUTER_SPOOLER
    || value === PRINT_TRANSPORT.NONE
}

/**
 * May `consumer` deliver jobs for an event whose transport setting is
 * `transport`? `null`/`undefined` transport means the event has no row —
 * legacy behaviour, both transports allowed.
 */
export function transportAllows(
  transport: string | null | undefined,
  consumer: typeof PRINT_TRANSPORT.LOCAL_DRAINER | typeof PRINT_TRANSPORT.ROUTER_SPOOLER
): boolean {
  if (transport == null) return true
  return transport === consumer
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

let warnedMissingTable = false
function warnMissingTableOnce(err: unknown) {
  if (warnedMissingTable) return
  warnedMissingTable = true
  console.warn('[crouton-printing] print_transports unreadable (migration not applied yet?) — falling back to legacy behaviour (all transports allowed):', err)
}

/**
 * The transport row for one event, or null (legacy — no choice recorded).
 * A missing/unmigrated table also resolves to null: an app that updates this
 * package before running the migration must keep printing, not 500.
 */
export async function getPrintTransport(db: any, eventId: string): Promise<any | null> {
  const { printTransports } = await import('../database/schema')
  try {
    const rows = await db.select().from(printTransports).where(eq(printTransports.eventId, eventId))
    return rows[0] ?? null
  }
  catch (err) {
    warnMissingTableOnce(err)
    return null
  }
}

/**
 * Every recorded transport row (optionally scoped to one event) — the drainer
 * reads the whole table per tick (one row per event, tiny). Same missing-table
 * tolerance as getPrintTransport: unreadable ⇒ [] ⇒ legacy behaviour.
 */
export async function getAllPrintTransports(db: any, eventId?: string): Promise<any[]> {
  const { printTransports } = await import('../database/schema')
  try {
    return await db
      .select()
      .from(printTransports)
      .where(eventId ? eq(printTransports.eventId, eventId) : undefined)
  }
  catch (err) {
    warnMissingTableOnce(err)
    return []
  }
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
