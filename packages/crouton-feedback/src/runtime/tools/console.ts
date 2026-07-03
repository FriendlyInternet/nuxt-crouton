import type { FeedbackTool } from '../composables/useFeedbackTools'
import type { ConsoleCapture } from './console-capture'

/** Minimal surface of eruda we use. */
export interface ErudaLike {
  init: () => void
  show: () => void
  hide: () => void
  /** eruda's own floating entry button — we hide it and drive show/hide from the launcher chip. */
  _entryBtn?: { hide: () => void }
}

/**
 * The **Console** tool — an on-page console / DOM / network panel (eruda),
 * available from the unified menu. eruda is lazy-loaded on first activate (its
 * own chunk), so a build that never opens it pays nothing.
 *
 * `capture` (#1080) is the early buffer installed at page load; on first open we
 * replay it into eruda's console so load / hydration / mount entries — which fired
 * before eruda existed — are visible. Both params are injectable for unit tests.
 */
export function createConsoleTool(
  capture?: ConsoleCapture | null,
  loadEruda: () => Promise<ErudaLike> = async () =>
    (await import('eruda')).default as unknown as ErudaLike
): FeedbackTool {
  let eruda: ErudaLike | null = null
  let replayed = false

  return {
    id: 'console',
    label: 'Console',
    icon: 'i-lucide-terminal',
    order: 1,
    // Surface how many warns/errors were seen before you opened it.
    badge: () => {
      const n = capture?.errorCount() ?? 0
      return n > 0 ? n : null
    },
    activate: async () => {
      if (!eruda) {
        eruda = await loadEruda()
        eruda.init()
        // Hide eruda's own floating entry button — it sits bottom-right and OVERLAPS the
        // glasses launcher. The launcher's active-tool chip is the toggle instead (#810
        // follow-up), so the on/off control lives in one place. Best-effort (private API).
        eruda._entryBtn?.hide()
      }
      // Replay the page-load buffer into eruda's now-live console, once (#1080). Each
      // entry re-emits through console.* (which eruda has patched), tagged so it reads
      // as history; `capture.replay` suspends its own hook so this isn't re-recorded.
      if (capture && !replayed) {
        replayed = true
        capture.replay((e) => {
          const emit = (console[e.level] ?? console.log) as (...a: unknown[]) => void
          emit('⤺ [load]', ...e.args)
        })
      }
      eruda.show()
    },
    deactivate: () => {
      eruda?.hide()
    }
  }
}
