/**
 * @crouton-package crouton-sales
 * @description Printer online-LED attribution (#1507).
 *
 * The settings-card LED shows each printer's last-known online state, derived
 * from its most recent print job (the spooler pre-flight-checks the printer on
 * every job, so the latest job's outcome IS the last-known state — no separate
 * ping).
 *
 * The gap this closes: a job is attributed to a printer row by `printerId`, but
 * that id can drift from the current row (a printer deleted + re-created with a
 * fresh nanoid, a regenerated printers collection, jobs enqueued before the row
 * existed). When it drifts, a printer with real, recent FAILED jobs matched
 * nothing by id and fell back to grey ("never printed"), masking the failure at
 * a live venue (Bar, 2026-07-11).
 *
 * Every job row already denormalizes `printerTitle` (written by every enqueue
 * site), so we attribute by `id` FIRST, else by an **unambiguous** `printerTitle`
 * — a title shared by two current rows is ambiguous, so we refuse to guess and
 * leave both grey. Pure + unit-tested (test/printer-led.test.ts); the Vue
 * component only maps the returned state → dot class + i18n label.
 */

/** LED state, decoupled from any styling/i18n (the component maps these). */
export type LedState = 'online' | 'offline' | 'printing' | 'unknown'

/** A current printer row the LED renders a dot for. */
export interface LedPrinter {
  id: string
  title?: string | null
}

/** A slim print-job row from the printqueues status endpoint. */
export interface LedJob {
  printerId: string
  /** Denormalized printer label on the job — the drift-proof fallback key. */
  printerTitle?: string | null
  status?: string | number | null
  createdAt?: string | number | null
  completedAt?: string | number | null
}

/** Comparable time for "latest job": completion beats creation. */
function jobTime(job: LedJob): number {
  const v = job.completedAt ?? job.createdAt
  if (v == null) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** Map a print-job status code to an LED state (2 = done, 9 = failed). */
function stateForStatus(status: string | number | null | undefined): LedState {
  switch (String(status ?? '0')) {
    case '2': return 'online'
    case '9': return 'offline'
    default: return 'printing'
  }
}

/** The latest job in a set, or undefined for an empty set. */
function latest(jobs: LedJob[]): LedJob | undefined {
  let best: LedJob | undefined
  for (const job of jobs) {
    if (!best || jobTime(job) >= jobTime(best)) best = job
  }
  return best
}

/**
 * Resolve every printer's LED state in one pass.
 *
 * Attribution per printer row:
 *   1. jobs whose `printerId` equals the row id — if any exist, the latest wins;
 *   2. otherwise, jobs whose `printerTitle` equals the row title, but ONLY when
 *      that title is unique among the current rows (unambiguous) — the latest
 *      wins;
 *   3. otherwise `unknown` (grey — genuinely never printed, or ambiguous).
 *
 * `id` always takes precedence: a row with any id-matched job ignores
 * title-only jobs entirely.
 */
export function attributePrinterStates(
  printers: LedPrinter[],
  jobs: LedJob[]
): Map<string, LedState> {
  // Titles shared by >1 current row are ambiguous — never a fallback key.
  const titleCounts = new Map<string, number>()
  for (const p of printers) {
    if (p.title == null) continue
    titleCounts.set(p.title, (titleCounts.get(p.title) ?? 0) + 1)
  }

  // Bucket jobs once: by printerId, and by printerTitle.
  const byId = new Map<string, LedJob[]>()
  const byTitle = new Map<string, LedJob[]>()
  for (const job of jobs) {
    if (job.printerId != null) {
      const arr = byId.get(job.printerId)
      if (arr) arr.push(job); else byId.set(job.printerId, [job])
    }
    if (job.printerTitle != null) {
      const arr = byTitle.get(job.printerTitle)
      if (arr) arr.push(job); else byTitle.set(job.printerTitle, [job])
    }
  }

  const states = new Map<string, LedState>()
  for (const p of printers) {
    const idJobs = byId.get(p.id)
    let job = idJobs && idJobs.length > 0 ? latest(idJobs) : undefined

    // Fall back to an unambiguous title match only when no id-matched job.
    if (!job && p.title != null && titleCounts.get(p.title) === 1) {
      const titleJobs = byTitle.get(p.title)
      if (titleJobs && titleJobs.length > 0) job = latest(titleJobs)
    }

    states.set(p.id, job ? stateForStatus(job.status) : 'unknown')
  }

  return states
}
