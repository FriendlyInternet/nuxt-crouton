/**
 * @description Watches a checked-out order's print jobs and derives the
 * checkout button's state — the button is the print feedback, not a toast.
 *
 * Each checkout registers its order via `watchOrder()`; the composable polls
 * the helper-authed per-order `print-status` endpoint every 2s (the spooler's
 * own cadence — faster buys nothing). The latest order drives `buttonState`;
 * older orders that fail surface through `warnings` as rows above the button,
 * so a busy event is never blocked by the previous order's printer.
 *
 * Terminal conditions stop a poll: all jobs done (auto-removes after ~4s of
 * green), all jobs terminal with a failure (warning persists until dismissed),
 * a 401 (token expired — stop silently), or a ~60s timeout (jobs stuck at
 * pending: spooler down / printer unreachable).
 */
import { FetchError } from 'ofetch'

export interface PrintWatchJob {
  id: string
  status: string | null
  errorMessage: string | null
  retryCount: string | null
  printMode: string | null
  printerTitle: string | null
  completedAt: string | null
}

export interface PrintJobFailure {
  printerTitle: string
  errorMessage: string | null
}

export interface WatchedOrder {
  orderId: string
  /** Event order number ("0042") — names the order in warning rows. */
  orderNumber: string
  state: 'printing' | 'confirmed' | 'warning'
  /** Stuck at pending past the timeout — printer offline / spooler down. */
  timedOut: boolean
  failures: PrintJobFailure[]
}

export type PrintButtonState = 'idle' | 'printing' | 'confirmed' | 'warning'

const POLL_INTERVAL_MS = 2000
const CONFIRMED_LINGER_MS = 4000
const WATCH_TIMEOUT_MS = 60000

export interface UsePrintWatcherOptions {
  /** API base path for orders, defaults to '/api/crouton-sales/events' */
  apiBasePath?: string
}

export function usePrintWatcher(options: UsePrintWatcherOptions = {}) {
  const { apiBasePath = '/api/crouton-sales/events' } = options

  // Always send the helper token explicitly (see useHelperHeaders for why).
  const { helperHeaders } = useHelperHeaders()

  const watched = ref<WatchedOrder[]>([])
  const timers = new Map<string, ReturnType<typeof setInterval>>()

  function stopPolling(orderId: string) {
    const timer = timers.get(orderId)
    if (timer) {
      clearInterval(timer)
      timers.delete(orderId)
    }
  }

  function remove(orderId: string) {
    stopPolling(orderId)
    watched.value = watched.value.filter(o => o.orderId !== orderId)
  }

  /**
   * Start watching an order's print jobs. Pass the order POST's
   * `printQueueIds` — an empty array means the order generated no tickets
   * (printing disabled / no active printers): nothing to watch, no watcher.
   */
  function watchOrder(input: { orderId: string, eventId: string, orderNumber: string, printQueueIds: string[] }) {
    const { orderId, eventId, orderNumber, printQueueIds } = input
    if (printQueueIds.length === 0) return

    remove(orderId)
    watched.value.push({ orderId, orderNumber, state: 'printing', timedOut: false, failures: [] })
    const startedAt = Date.now()

    const tick = async () => {
      const entry = watched.value.find(o => o.orderId === orderId)
      if (!entry) {
        stopPolling(orderId)
        return
      }

      let jobs: PrintWatchJob[]
      try {
        jobs = await $fetch<PrintWatchJob[]>(
          `${apiBasePath}/${eventId}/orders/${orderId}/print-status`,
          { headers: helperHeaders() }
        )
      }
      catch (error) {
        // Token expired mid-watch — stop silently, the next checkout will
        // surface the auth problem where the volunteer can act on it.
        if (error instanceof FetchError && error.statusCode === 401) {
          remove(orderId)
          return
        }
        // Transient failure (offline blip): keep polling until the timeout.
        jobs = []
      }

      const statuses = jobs.map(j => String(j.status ?? '0'))
      entry.failures = jobs
        .filter(j => String(j.status ?? '0') === '9')
        .map(j => ({ printerTitle: j.printerTitle || '?', errorMessage: j.errorMessage }))

      const allDone = jobs.length > 0 && statuses.every(s => s === '2')
      const allTerminal = jobs.length > 0 && statuses.every(s => s === '2' || s === '9')

      if (allDone) {
        entry.state = 'confirmed'
        stopPolling(orderId)
        setTimeout(() => remove(orderId), CONFIRMED_LINGER_MS)
        return
      }

      if (allTerminal) {
        entry.state = 'warning'
        stopPolling(orderId)
        return
      }

      // Worst-status wins while others still print (same as the admin LEDs).
      if (entry.failures.length > 0) entry.state = 'warning'

      if (Date.now() - startedAt >= WATCH_TIMEOUT_MS) {
        entry.state = 'warning'
        entry.timedOut = true
        stopPolling(orderId)
      }
    }

    // First poll at 2s — jobs start at pending, an immediate fetch buys nothing.
    timers.set(orderId, setInterval(tick, POLL_INTERVAL_MS))
  }

  /** Dismiss a persisted warning row. */
  function dismiss(orderId: string) {
    remove(orderId)
  }

  // The newest order owns the button; older watches only surface as warnings.
  const latest = computed<WatchedOrder | null>(() =>
    watched.value.length > 0 ? watched.value[watched.value.length - 1]! : null
  )

  const buttonState = computed<PrintButtonState>(() => latest.value?.state ?? 'idle')

  /** All orders in warning state, oldest first — one row per order above the button. */
  const warnings = computed<WatchedOrder[]>(() =>
    watched.value.filter(o => o.state === 'warning')
  )

  onScopeDispose(() => {
    for (const timer of timers.values()) clearInterval(timer)
    timers.clear()
  })

  return {
    watched: readonly(watched),
    buttonState,
    warnings,
    watchOrder,
    dismiss
  }
}
