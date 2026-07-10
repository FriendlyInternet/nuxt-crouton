/**
 * @crouton-package crouton-printing
 * @description In-process ESC/POS print drainer for the venue-local / self-host
 *   target (epic #61; moved to crouton-printing + generic print_jobs in #328).
 *
 * The default `network-escpos` driver is normally drained by the on-site RUT956
 * shell spooler, which polls the HTTP `print-server` endpoints (the only option
 * on Cloudflare Workers — no raw sockets there). When the app runs on a Node
 * target ON the venue LAN (a Pi/mini-PC), it can skip the spooler entirely and
 * open TCP `:9100` to the printers itself. This module is that drainer.
 *
 * Faithful port of `print-server/teltonika-simple-spooler-fast.sh`: per job —
 * DLE-EOT pre-flight on its own connection → send ESC/POS + a confirmation pass
 * → classify the status bytes → complete/fail. It converges on the SAME generic
 * `print_jobs` lifecycle via the shared completePrintJob / failPrintJob
 * transitions (no HTTP callback — it has direct DB access).
 *
 * Cloudflare-safe: `node:net` is imported lazily inside `exchange`, so merely
 * importing this module pulls no Node builtin. The Nitro plugin only ever runs
 * the loop on an explicitly opted-in Node target (see `server/plugins`).
 */
import { and, eq, inArray } from 'drizzle-orm'
import { completePrintJob, failPrintJob } from './print-job-status'
import { PRINT_STATUS } from './print-job-queue'
import { PRINT_TRANSPORT, getAllPrintTransports, shouldStampHeartbeat, transportAllows } from './print-transport'

const DEFAULT_PORT = 9100

// The three real-time status queries, answered in order:
//   DLE EOT 1 (printer status), DLE EOT 2 (offline cause), DLE EOT 4 (paper).
const STATUS_QUERIES = Uint8Array.from([0x10, 0x04, 0x01, 0x10, 0x04, 0x02, 0x10, 0x04, 0x04])
// Hold the socket open after writing so the printer can drain its buffer and
// answer the status queries on the same connection (mirrors the spooler's
// DRAIN_SECS; pre-flight is a smaller window — an idle printer replies at once).
const DRAIN_MS = 2000
const PREFLIGHT_HOLD_MS = 1200
const CONNECT_TIMEOUT_MS = 8000

/**
 * Classify the first three DLE-EOT response bytes. Returns '' when the printer
 * is online with paper, else a human-readable reason. Ported 1:1 from the
 * spooler's `classify_status` (bit masks identical).
 */
export function classifyStatus(bytes: number[], noResponseMsg: string): string {
  const [b1, b2, b3] = bytes
  if (b1 === undefined) return noResponseMsg
  // Every DLE-EOT response has fixed bits (byte & 0x93) === 0x12.
  if ((b1 & 0x93) !== 0x12) return 'Unexpected status response - not an ESC/POS printer?'
  if (b2 !== undefined && (b2 & 0x04) !== 0) return 'Cover open'
  if ((b3 !== undefined && (b3 & 0x60) !== 0) || (b2 !== undefined && (b2 & 0x20) !== 0)) return 'Paper out'
  if (b2 !== undefined && (b2 & 0x40) !== 0) return 'Printer error'
  if ((b1 & 0x08) !== 0) return 'Printer offline'
  return ''
}

/**
 * Open a TCP connection to the printer, write `payload`, hold the socket open
 * `holdMs` to collect the reply, then close. Returns the first 3 response bytes
 * (the DLE-EOT answers). `node:net` is imported here so the module stays
 * Workers-import-safe.
 */
async function exchange(host: string, port: number, payload: Uint8Array, holdMs: number): Promise<number[]> {
  const net = await import('node:net')
  return new Promise<number[]>((resolve) => {
    const chunks: Buffer[] = []
    let settled = false
    const socket = net.createConnection({ host, port })

    const finish = () => {
      if (settled) return
      settled = true
      try { socket.destroy() }
      catch { /* already closed */ }
      resolve(Array.from(Buffer.concat(chunks).subarray(0, 3)))
    }

    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.on('timeout', finish)
    socket.on('error', finish)
    socket.on('data', d => chunks.push(d as Buffer))
    socket.on('connect', () => {
      socket.write(Buffer.from(payload))
      setTimeout(finish, holdMs)
    })
  })
}

/**
 * Print one job's base64 ESC/POS payload to a printer over TCP, with the
 * spooler's pre-flight + confirmation passes. Returns `{ ok }` or `{ ok: false,
 * error }` with the specific reason.
 */
export async function printEscposJob(printData: string, printerIp: string, port = DEFAULT_PORT): Promise<{ ok: boolean, error?: string }> {
  const payload = Buffer.from(printData || '', 'base64')
  if (payload.length === 0) return { ok: false, error: 'Empty base64 decode' }

  // Pre-flight on its OWN connection: an error-state printer stops draining its
  // buffer, so queries appended after a payload jam behind it and never answer.
  const preBytes = await exchange(printerIp, port, STATUS_QUERIES, PREFLIGHT_HOLD_MS)
  const preErr = classifyStatus(preBytes, 'Printer not responding - paper out, cover open, or offline?')
  if (preErr) return { ok: false, error: preErr }

  // Healthy — send the ticket with the queries appended as a confirmation pass.
  const sendPayload = new Uint8Array(payload.length + STATUS_QUERIES.length)
  sendPayload.set(payload, 0)
  sendPayload.set(STATUS_QUERIES, payload.length)
  const postBytes = await exchange(printerIp, port, sendPayload, DRAIN_MS)
  const postErr = classifyStatus(postBytes, 'Printer stopped responding while printing (paper ran out mid-ticket?)')
  if (postErr) return { ok: false, error: postErr }

  return { ok: true }
}

export interface DrainOptions {
  /** Limit to one event; omitted ⇒ every event with pending thermal jobs. */
  eventId?: string
  /** Max jobs claimed per tick (keeps the first tick bounded). Default 25. */
  batchSize?: number
}

/**
 * Claim and print all pending `network-escpos` jobs (one tick). Claims by
 * flipping pending → printing (so a crash leaves them recoverable by
 * retry-failed, exactly like the spooler), then prints sequentially — Epson TM
 * printers accept one connection on :9100 at a time. Returns how many it
 * processed. Intended to be called on an interval by the Nitro plugin; callers
 * must not run two ticks concurrently.
 */
export async function drainPendingEscposJobs(db: any, opts: DrainOptions = {}): Promise<{ processed: number }> {
  const { printJobs, printTransports } = await import('../database/schema')

  // Per-event transport gate (#1324). The table is one row per event with a
  // recorded choice — small enough to read whole each tick. An event WITHOUT
  // a row uses the default (`router-spooler`), so this drainer only serves
  // events explicitly set to `local-drainer`.
  const transports = await getAllPrintTransports(db, opts.eventId)
  const transportByEvent = new Map<string, string>(
    transports.map(t => [t.eventId, t.transport])
  )

  // Liveness readout: stamp lastDrainerTickAt on the events this drainer is
  // responsible for — even when there are no jobs — throttled so a 2s poll
  // loop writes at most every HEARTBEAT_THROTTLE_MS.
  const now = new Date()
  const staleIds = (transports as any[])
    .filter(t => t.transport === PRINT_TRANSPORT.LOCAL_DRAINER && shouldStampHeartbeat(t.lastDrainerTickAt, now))
    .map(t => t.eventId)
  if (staleIds.length > 0) {
    await db
      .update(printTransports)
      .set({ lastDrainerTickAt: now.toISOString() })
      .where(inArray(printTransports.eventId, staleIds))
  }

  const where = [
    eq(printJobs.status, PRINT_STATUS.PENDING),
    // network-escpos only — browser-print / other drivers have their own drainers.
    eq(printJobs.driver, 'network-escpos')
  ]
  if (opts.eventId) where.push(eq(printJobs.eventId, opts.eventId))

  // Self-contained job: ip/port live on the row (no printers join).
  const candidates = await db
    .select({
      id: printJobs.id,
      payload: printJobs.payload,
      printerIp: printJobs.printerIp,
      printerPort: printJobs.printerPort,
      eventId: printJobs.eventId
    })
    .from(printJobs)
    .where(and(...where))
    .limit(opts.batchSize ?? 25)

  // Drop jobs whose event routes elsewhere ('router-spooler', incl. the no-row
  // default) or nowhere ('none' — parked, stays pending). Event-LESS jobs stay
  // drainable: the spooler endpoint is per-event, so only this drainer can
  // ever deliver them.
  const rows = (candidates as any[]).filter(r =>
    !r.eventId || transportAllows(transportByEvent.get(r.eventId), PRINT_TRANSPORT.LOCAL_DRAINER)
  )

  if (rows.length === 0) return { processed: 0 }

  // Claim atomically (single in-process drainer, but this still dedups against
  // the next tick and against the HTTP spooler if both are mistakenly running).
  await db
    .update(printJobs)
    .set({ status: PRINT_STATUS.PRINTING, updatedAt: new Date() })
    .where(inArray(printJobs.id, rows.map((r: any) => r.id)))

  for (const r of rows as any[]) {
    if (!r.printerIp) {
      await failPrintJob(db, r.id, 'No printer IP configured')
      continue
    }
    const res = await printEscposJob(r.payload, r.printerIp, Number(r.printerPort) || DEFAULT_PORT)
    if (res.ok) await completePrintJob(db, r.id)
    else await failPrintJob(db, r.id, res.error || 'Print failed')
  }

  return { processed: rows.length }
}
