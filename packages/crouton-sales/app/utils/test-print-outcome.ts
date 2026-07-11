/**
 * @crouton-package crouton-sales
 * @description Derive a Testprint's real terminal outcome from its queued job (#1506).
 *
 * The Testprint button (#1391) enqueues one job on the generic crouton-printing
 * `print_jobs` queue and the transport (router spooler / local drainer) drains
 * it. The button used to stop at "queued" — a one-digit IP typo failed every
 * ticket silently (#1506). This pure evaluator turns a polled job row + elapsed
 * time into a printed/failed/pending verdict so the UI can report the REAL result:
 *
 *   status '2' (done)  → printed
 *   status '9' (error) → failed  (reason 'error', carrying the spooler's message)
 *   still pending past the timeout → failed (reason 'timeout': spooler down /
 *     printer unreachable — the case that motivated #1506)
 *   '0' pending / '1' printing / job not visible yet → pending (keep polling)
 *
 * Pure: the component polls the slim per-job status endpoint and feeds each read
 * (plus how long it's been waiting) here to decide whether to settle the button.
 * Status codes mirror the spooler contract (see print_jobs.status).
 */
export type TestPrintPhase = 'pending' | 'printed' | 'failed'
export type TestPrintFailureReason = 'error' | 'timeout'

/** The polled `print_jobs` row shape this evaluator needs. */
export interface TestPrintJobStatus {
  status: string | null
  errorMessage?: string | null
}

export interface TestPrintTick {
  /** The polled job row, or null/undefined if it isn't visible yet. */
  job: TestPrintJobStatus | null | undefined
  /** Milliseconds since the job was enqueued. */
  elapsedMs: number
  /** Give up waiting on a stuck-pending job after this long. */
  timeoutMs: number
}

export interface TestPrintResult {
  phase: TestPrintPhase
  /** Stop polling once true. */
  settled: boolean
  /** Only set when phase === 'failed'. */
  reason?: TestPrintFailureReason
  /** The spooler's failure message (reason 'error'); null for a timeout. */
  errorMessage?: string | null
}

export function evaluateTestPrint({ job, elapsedMs, timeoutMs }: TestPrintTick): TestPrintResult {
  const status = String(job?.status ?? '0')

  // A terminal status wins regardless of the clock — a done job is printed,
  // an errored job is failed, even if we only saw it after the timeout.
  if (status === '2') {
    return { phase: 'printed', settled: true }
  }
  if (status === '9') {
    return { phase: 'failed', settled: true, reason: 'error', errorMessage: job?.errorMessage ?? null }
  }

  // '0' pending / '1' printing / job not visible yet: still in flight — but a
  // job that never leaves pending means nobody is draining (spooler down /
  // printer unreachable), so give up loudly instead of spinning forever.
  if (elapsedMs >= timeoutMs) {
    return { phase: 'failed', settled: true, reason: 'timeout', errorMessage: null }
  }
  return { phase: 'pending', settled: false }
}
