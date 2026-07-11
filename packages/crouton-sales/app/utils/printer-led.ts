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

/** The latest job in a set (by `jobTime`), or undefined for an empty/absent set. */
function latest(jobs: LedJob[] | undefined): LedJob | undefined {
  let best: LedJob | undefined
  for (const job of (jobs ?? [])) {
    if (!best || jobTime(job) >= jobTime(best)) best = job
  }
  return best
}

/** Append `job` to the bucket at `key` (skips null keys). */
function bucket(map: Map<string, LedJob[]>, key: string | null | undefined, job: LedJob): void {
  if (key == null) return
  const arr = map.get(key)
  if (arr) arr.push(job)
  else map.set(key, [job])
}

/** Bucket every job once by `printerId` and by `printerTitle`. */
function indexJobs(jobs: LedJob[]): { byId: Map<string, LedJob[]>, byTitle: Map<string, LedJob[]> } {
  const byId = new Map<string, LedJob[]>()
  const byTitle = new Map<string, LedJob[]>()
  for (const job of jobs) {
    bucket(byId, job.printerId, job)
    bucket(byTitle, job.printerTitle, job)
  }
  return { byId, byTitle }
}

/** Titles held by exactly one current printer row — the only safe fallback keys. */
function unambiguousTitles(printers: LedPrinter[]): Set<string> {
  const counts = new Map<string, number>()
  for (const p of printers) {
    if (p.title != null) counts.set(p.title, (counts.get(p.title) ?? 0) + 1)
  }
  const unique = new Set<string>()
  for (const [title, n] of counts) {
    if (n === 1) unique.add(title)
  }
  return unique
}

/**
 * The latest job attributable to one printer row: jobs matching by `printerId`
 * win outright; only when there are none does an unambiguous `printerTitle`
 * match apply. Undefined ⇒ nothing attributable (grey).
 */
function attributedJob(
  printer: LedPrinter,
  byId: Map<string, LedJob[]>,
  byTitle: Map<string, LedJob[]>,
  uniqueTitles: Set<string>
): LedJob | undefined {
  const idJob = latest(byId.get(printer.id))
  if (idJob) return idJob
  if (printer.title != null && uniqueTitles.has(printer.title)) {
    return latest(byTitle.get(printer.title))
  }
  return undefined
}

/**
 * Resolve every printer's LED state. Composes the pieces above:
 *   1. jobs matching by `printerId` win (latest by `completedAt ?? createdAt`);
 *   2. else an *unambiguous* `printerTitle` match (drift-proof fallback);
 *   3. else `unknown` (grey — never printed, or an ambiguous title).
 */
export function attributePrinterStates(
  printers: LedPrinter[],
  jobs: LedJob[]
): Map<string, LedState> {
  const { byId, byTitle } = indexJobs(jobs)
  const uniqueTitles = unambiguousTitles(printers)

  const states = new Map<string, LedState>()
  for (const p of printers) {
    const job = attributedJob(p, byId, byTitle, uniqueTitles)
    states.set(p.id, job ? stateForStatus(job.status) : 'unknown')
  }
  return states
}
