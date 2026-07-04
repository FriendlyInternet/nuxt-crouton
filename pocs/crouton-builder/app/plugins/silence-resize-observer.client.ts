import { defineNuxtPlugin } from 'nuxt/app'

/**
 * Silence the benign `ResizeObserver loop completed with undelivered
 * notifications` flood.
 *
 * The board's live layout preview (`BuilderPagePreview` → `CroutonLayoutRenderer`)
 * renders reka-ui Splitter panes, each backed by a ResizeObserver. When a
 * callback adjusts a pane and several deliveries land in the same frame, the
 * browser fires this warning — the observer is deferring notifications to the
 * next frame *by design* (not an infinite loop; the page renders correctly). But
 * it's thrown as an uncaught `window` error, so the feedback Console tool (eruda,
 * which captures window errors — #1080) fills with hundreds of copies and becomes
 * unusable exactly when you'd open it.
 *
 * Fix: run every ResizeObserver callback inside a *coalesced* requestAnimationFrame
 * (cancel the pending frame first). The browser's synchronous delivery loop then
 * runs a callback that only *schedules* — it never resizes an observed element
 * within the delivery cycle — so there are never "undelivered notifications" to
 * report. The warning stops at the source, for every console (eruda AND devtools),
 * and the one-frame coalesced defer is imperceptible for layout panes.
 *
 * Verified locally (headless chromium, converging multi-delivery repro): 21 window
 * errors without the wrap → 0 with it. Patched at plugin eval, before any
 * component mounts and creates an observer.
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
