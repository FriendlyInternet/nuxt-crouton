/**
 * @crouton-package crouton-printing
 * @description Generic print-job queue API (epic #325, issue #326).
 *
 * The one entry point every domain uses to print: render your ticket to an
 * opaque payload, then `enqueuePrintJob()` it. The engine (#327) encodes the
 * payload; the transport (#328) drains and delivers it; lifecycle hooks (#329)
 * report completion back to the domain. This module knows nothing about orders
 * or bookings — the domain is carried by `source` + `refType`/`refId`.
 *
 * The drizzle db is passed in by the caller (same pattern as crouton-sales'
 * recordOutboxEvents) so this package stays decoupled from any one db-access
 * util. The schema is imported lazily, keeping the module import-safe and cheap
 * everywhere (including the edge).
 */
import { nanoid } from 'nanoid'

/**
 * Print-job status codes. Text to match the on-site spooler contract
 * (the RUT956 script and the HTTP spooler endpoints read string status values).
 */
export const PRINT_STATUS = {
  PENDING: '0',
  PRINTING: '1',
  COMPLETED: '2',
  FAILED: '9'
} as const

export type PrintStatusCode = typeof PRINT_STATUS[keyof typeof PRINT_STATUS]

/** Output drivers known to the engine + transport. */
export type PrintDriver = 'network-escpos' | 'browser-print' | (string & {})

export interface EnqueuePrintJobInput {
  /** Domain that produced the job ('sales' | 'bookings' | …). */
  source: string
  /** Opaque printer reference — for grouping/status; the job is self-contained. */
  printerId: string
  /** Denormalized printer transport (copied onto the job; null for browser-print). */
  printerIp?: string | null
  printerPort?: number | null
  printerTitle?: string | null
  /** Opaque encoded ticket (base64 ESC/POS for thermal, JSON for browser-print). */
  payload: string
  /** Output driver; defaults to the printer's network-escpos path. */
  driver?: PrintDriver
  locationId?: string | null
  teamId?: string | null
  eventId?: string | null
  /** Opaque back-reference to the domain entity, e.g. 'order' / 'booking'. */
  refType?: string | null
  refId?: string | null
  printMode?: string
  /** Override the initial status (defaults to PENDING). */
  status?: PrintStatusCode
}

/**
 * Insert one pending print job and return its id. The transport picks it up
 * on its next drain. Throws on a real DB error — unlike the sales sync outbox,
 * a failed enqueue means the ticket would silently never print, so the caller
 * decides how to handle it.
 */
function buildRow(input: EnqueuePrintJobInput) {
  return {
    id: nanoid(),
    source: input.source,
    printerId: input.printerId,
    printerIp: input.printerIp ?? null,
    printerPort: input.printerPort ?? 9100,
    printerTitle: input.printerTitle ?? null,
    locationId: input.locationId ?? null,
    teamId: input.teamId ?? null,
    eventId: input.eventId ?? null,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    driver: input.driver ?? 'network-escpos',
    status: input.status ?? PRINT_STATUS.PENDING,
    payload: input.payload,
    printMode: input.printMode ?? 'normal',
    retryCount: '0'
  }
}

/**
 * Emit `printing:job:created` per inserted job so domain subscribers can mirror
 * new jobs (e.g. the sales cloud-sync outbox). `db` rides the hook so the
 * subscriber reuses the connection. Best-effort — never fails the enqueue.
 */
async function emitCreated(db: any, rows: ReturnType<typeof buildRow>[]): Promise<void> {
  try {
    const { useNitroApp } = await import('nitropack/runtime')
    const app = useNitroApp() as any
    for (const job of rows) {
      await app.hooks.callHook('printing:job:created', { db, job })
    }
  }
  catch {
    /* no nitro app / no subscriber — fine */
  }
}

export async function enqueuePrintJob(db: any, input: EnqueuePrintJobInput): Promise<string> {
  const { printJobs } = await import('../database/schema')
  const row = buildRow(input)
  await db.insert(printJobs).values(row)
  await emitCreated(db, [row])
  return row.id
}

/**
 * Insert many jobs in one go (e.g. per-location kitchen tickets + a receipt for
 * a single order). Returns the inserted ids in input order.
 */
export async function enqueuePrintJobs(db: any, inputs: EnqueuePrintJobInput[]): Promise<string[]> {
  if (inputs.length === 0) return []
  const { printJobs } = await import('../database/schema')
  const rows = inputs.map(buildRow)
  await db.insert(printJobs).values(rows)
  await emitCreated(db, rows)
  return rows.map(r => r.id)
}

/**
 * The HTTP spooler's read model (#1324 refactor): pending `network-escpos`
 * jobs for one event, shaped for the RUT956 polling script. With `claim` the
 * returned jobs are atomically flipped pending → printing in the same call so
 * concurrent pollers don't duplicate work. Self-contained rows — printer
 * ip/port/title are denormalized onto the job, no printers join.
 */
export async function listSpoolerJobs(db: any, eventId: string, claim: boolean): Promise<any[]> {
  const { eq, and, inArray } = await import('drizzle-orm')
  const { printJobs } = await import('../database/schema')

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
      printerTitle: printJobs.printerTitle
    })
    .from(printJobs)
    .where(
      and(
        eq(printJobs.eventId, eventId),
        eq(printJobs.status, PRINT_STATUS.PENDING),
        // Thermal spooler only — never hand it browser-print (or other-driver)
        // jobs, which carry no printer IP and aren't ESC/POS.
        eq(printJobs.driver, 'network-escpos')
      )
    )

  if (claim && rows.length > 0) {
    await db
      .update(printJobs)
      .set({ status: PRINT_STATUS.PRINTING, updatedAt: new Date() })
      .where(inArray(printJobs.id, rows.map((r: { id: string }) => r.id)))
  }

  return rows
}
