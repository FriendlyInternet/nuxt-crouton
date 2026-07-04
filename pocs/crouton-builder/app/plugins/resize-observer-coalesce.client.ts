import { defineNuxtPlugin } from 'nuxt/app'

/**
 * Coalesce every ResizeObserver callback into one deferred requestAnimationFrame
 * (cancel the pending frame first).
 *
 * WHY (not a console silencer — a scheduling fix): the board Preview composes
 * many observed surfaces — reka-ui Splitter panes, VueUse `useElementSize`, and
 * the collection block's own layout — and several of these libraries run their
 * ResizeObserver callback *synchronously within the delivery cycle*, resizing an
 * observed element as they settle. The browser flags that re-entrancy as
 * "ResizeObserver loop completed with undelivered notifications" — benign (the
 * page renders correctly), but emitted hundreds of times, which drowns the
 * feedback Console tool exactly when you'd open it.
 *
 * The emitter is *distributed* across third-party dependencies (reka, VueUse,
 * Nuxt UI), so there is no single component to fix — the correct chokepoint is
 * the shared primitive. Deferring each callback to a coalesced rAF moves it out
 * of the synchronous delivery cycle, so the browser never has undelivered
 * notifications to report — for every console (eruda AND devtools). The
 * one-frame defer is imperceptible for layout.
 *
 * Verified: on a converging multi-delivery observer this takes 21 window errors
 * → 0 (headless chromium). And empirically on staging, the flood is present with
 * this OFF and absent with it ON. Renderer-level attempts (rendering read-only
 * splits without reka, #983) did NOT fix it — proof the emitter isn't the
 * splitter but the wider set of observers this covers.
 *
 * Patched at plugin eval, before any component mounts and creates an observer.
 */
export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined' || !window.ResizeObserver) return
  const Native = window.ResizeObserver
  window.ResizeObserver = class extends Native {
    constructor(callback: ResizeObserverCallback) {
      let frame = 0
      super((entries, observer) => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => callback(entries, observer))
      })
    }
  }
})
