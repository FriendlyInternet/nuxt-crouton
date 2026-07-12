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

// A complete DLE-EOT status reply is three bytes (status / offline cause /
// paper). Once we've collected that many we know all we can, so the read may
// return immediately instead of waiting out the fixed hold window (#1539).
export const NEEDED_STATUS_BYTES = 3

// The three real-time status queries, answered in order:
//   DLE EOT 1 (printer status), DLE EOT 2 (offline cause), DLE EOT 4 (paper).
const STATUS_QUERIES = Uint8Array.from([0x10, 0x04, 0x01, 0x10, 0x04, 0x02, 0x10, 0x04, 0x04])
// CAPS, not fixed waits (#1539): with the early-return read in `exchange` a
// printer that answers sooner is confirmed sooner, so a fast printer clears in
// a fraction of these regardless of the value. Defaults stay OPTIMISTICALLY LOW
// (field-test the fast path first); a slow printer on a weak link is a one-env
// bump with NO rebuild — set CROUTON_PRINTING_PREFLIGHT_MS / _DRAIN_MS on the
// Node host (mirrors the spooler's PREFLIGHT_SECS / DRAIN_SECS env overrides).
const DRAIN_MS = Number(process.env.CROUTON_PRINTING_DRAIN_MS) || 2000
const PREFLIGHT_HOLD_MS = Number(process.env.CROUTON_PRINTING_PREFLIGHT_MS) || 1200
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
 * Decide whether a status read may resolve now: true once the full DLE-EOT
 * reply (`needed` bytes, default 3) has arrived, else keep waiting. This is the
 * early-return lever (#1539) — a fast printer answers in <1s and we proceed at
 * once instead of waiting out the fixed hold window. It only changes *when* we
 * stop waiting; the time cap stays the caller's `holdMs`, and what we conclude
 * from the bytes (paper-out/offline) is unchanged.
 */
export function shouldResolveStatusRead(bytesReceived: number, needed: number = NEEDED_STATUS_BYTES): boolean {
  return bytesReceived >= needed
}

/**
 * Open a TCP connection to the printer, write `payload`, then return the first
 * 3 response bytes (the DLE-EOT answers). Resolves the instant the full reply
 * has arrived (`shouldResolveStatusRead`), capped at `holdMs` so a slow /
 * silent printer still bounds the wait exactly as before. `node:net` is
 * imported here so the module stays Workers-import-safe.
 */
async function exchange(host: string, port: number, payload: Uint8Array, holdMs: number): Promise<number[]> {
  const net = await import('node:net')
  return new Promise<number[]>((resolve) => {
    const chunks: Buffer[] = []
    let received = 0
    let settled = false
    let holdTimer: ReturnType<typeof setTimeout> | undefined
    const socket = net.createConnection({ host, port })

    const finish = () => {
      if (settled) return
      settled = true
      if (holdTimer) clearTimeout(holdTimer)
      try { socket.destroy() }
      catch { /* already closed */ }
      resolve(Array.from(Buffer.concat(chunks).subarray(0, NEEDED_STATUS_BYTES)))
    }

    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.on('timeout', finish)
    socket.on('error', finish)
    socket.on('data', (d) => {
      chunks.push(d as Buffer)
      received += (d as Buffer).length
      // Early-return: proceed the moment the full status reply is in.
      if (shouldResolveStatusRead(received)) finish()
    })
    socket.on('connect', () => {
      socket.write(Buffer.from(payload))
      // holdMs is the CAP, not a fixed wait — finish() is idempotent so an
      // early data-driven resolve simply cancels this timer.
      holdTimer = setTimeout(finish, holdMs)
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

/**
 * Group pending jobs by printer IP, preserving first-seen order — the
 * parallelism lever (#1539). Each returned group is drained on its own worker
 * so different printers print concurrently, but every job for a single printer
 * stays in ONE group and is drained serially (Epson TM accepts one :9100
 * connection at a time — parallelising within a printer garbles tickets).
 *
 * IP-less jobs (null / undefined / '') collapse into a single group so they
 * stay serial and each fail on their own; they are never parallelised.
 */
export function groupJobsByPrinter<T extends { printerIp?: string | null }>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = row.printerIp || ''
    const existing = groups.get(key)
    if (existing) existing.push(row)
    else groups.set(key, [row])
  }
  return Array.from(groups.values())
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
 * retry-failed, exactly like the spooler), then drains printers in PARALLEL —
 * one worker per printer IP (`groupJobsByPrinter`), serial within a printer
 * since Epson TM accepts one :9100 connection at a time. Returns how many it
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

  // Different printers drain concurrently; jobs to the same printer stay serial
  // within their group (drainOneJob per row). allSettled so one printer's
  // failure can never reject the batch — worst case this is exactly the old
  // sequential behaviour.
  const drainGroup = async (group: any[]) => {
    for (const r of group) await drainOneJob(db, r)
  }
  const groups = groupJobsByPrinter(rows as any[])
  await Promise.allSettled(groups.map(drainGroup))

  return { processed: rows.length }
}

/**
 * Print one claimed row and record its outcome. Self-guarded: a thrown
 * DB/socket error fails just this job (recoverable via retry-failed) and never
 * derails the rest of its printer's serial group.
 */
async function drainOneJob(db: any, r: any): Promise<void> {
  try {
    if (!r.printerIp) {
      await failPrintJob(db, r.id, 'No printer IP configured')
      return
    }
    const res = await printEscposJob(r.payload, r.printerIp, Number(r.printerPort) || DEFAULT_PORT)
    if (res.ok) await completePrintJob(db, r.id)
    else await failPrintJob(db, r.id, res.error || 'Print failed')
  }
  catch (err) {
    // best effort — if even the fail-write throws, leave it PRINTING for retry-failed
    await failPrintJob(db, r.id, err instanceof Error ? err.message : 'Drain error').catch(() => {})
  }
}
