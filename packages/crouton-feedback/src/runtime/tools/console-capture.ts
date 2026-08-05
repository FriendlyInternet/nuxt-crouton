/**
 * Early console/error capture (#1080).
 *
 * The Console tool lazy-loads eruda on first toggle, so anything logged/thrown
 * **before** that — load, hydration, component mount — was gone by the time you
 * opened it (exactly the class of bug a mobile console is for). This buffer starts
 * capturing at page load (installed by the dev/review-gated console plugin) and is
 * replayed into eruda's panel when you open it, so those early entries show up.
 *
 * Deliberately NOT `nuxt-eruda` (yisibell): that inits eruda eagerly (dev-only,
 * shows its own entry button) — we keep eruda lazy and drive it from the launcher.
 * We only need the cheap capture up front. Pure of Nuxt; unit-tested.
 */
export type CaptureLevel = 'log' | 'info' | 'warn' | 'error'

export interface CapturedEntry {
  level: CaptureLevel
  args: unknown[]
  /** ms since capture install (relative — no wall clock needed). */
  t: number
}

export interface ConsoleCapture {
  entries: CapturedEntry[]
  /** Count of the entries worth a badge (warn + error). */
  errorCount: () => number
  /** Record an entry (also used by the Vue error/warn handlers). */
  record: (level: CaptureLevel, args: unknown[]) => void
  /** Replay every captured entry through `emit`, without re-recording them. */
  replay: (emit: (e: CapturedEntry) => void) => void
  /** Restore the original console + remove window listeners. */
  uninstall: () => void
}

const LEVELS: CaptureLevel[] = ['log', 'info', 'warn', 'error']

/**
 * Patch `console.*` and hook `window` error events to buffer everything from now.
 * Chains the originals (nothing is swallowed). Call once, early, in dev/review only.
 */
export function installEarlyConsoleCapture(cap = 300): ConsoleCapture {
  const entries: CapturedEntry[] = []
  const t0 = 0 // relative base; Date.now() is unavailable in some sandboxes, and we don't need wall time
  let suspended = false

  const record = (level: CaptureLevel, args: unknown[]) => {
    if (suspended) return
    entries.push({ level, args, t: entries.length ? entries[entries.length - 1]!.t + 1 : t0 })
    if (entries.length > cap) entries.shift()
  }

  // Patch console — record then delegate to the original.
  const orig: Partial<Record<CaptureLevel, (...a: unknown[]) => void>> = {}
  const hasConsole = typeof console !== 'undefined'
  if (hasConsole) {
    for (const level of LEVELS) {
      const original = console[level]?.bind(console)
      orig[level] = original
      console[level] = (...args: unknown[]) => {
        record(level, args)
        original?.(...args)
      }
    }
  }

  // Window-level uncaught errors + promise rejections (the load/mount throws).
  const hasWindow = typeof window !== 'undefined'
  const onError = (e: ErrorEvent) => record('error', [e.message, e.error ?? ''])
  const onRejection = (e: PromiseRejectionEvent) => record('error', ['[unhandledrejection]', e.reason])
  if (hasWindow) {
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
  }

  return {
    entries,
    errorCount: () => entries.reduce((n, e) => n + (e.level === 'error' || e.level === 'warn' ? 1 : 0), 0),
    record,
    replay(emit) {
      // Suspend so the replayed entries (re-emitted through console.* into eruda)
      // aren't captured a second time by our own patch.
      suspended = true
      try {
        for (const e of entries) emit(e)
      } finally {
        suspended = false
      }
    },
    uninstall() {
      if (hasConsole) for (const level of LEVELS) if (orig[level]) console[level] = orig[level]!
      if (hasWindow) {
        window.removeEventListener('error', onError)
        window.removeEventListener('unhandledrejection', onRejection)
      }
    },
  }
}
