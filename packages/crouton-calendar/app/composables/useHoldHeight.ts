import { onBeforeUnmount, onMounted, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

/**
 * Hold an element's height for good — never released (#3924 / #3813).
 *
 * The swipe strip has no height of its own: while its panels are patched it is
 * briefly shorter, and WebKit clamps the page scroll to fit, so a page scrolled
 * to the bottom jumps. A hold that starts when the date changes is too late on
 * iOS (it jumps already), so the strip keeps a `min-height` at its measured
 * height ALL the time, from mount on.
 *
 * - Measured after mount, and again from scratch when the strip's WIDTH changes
 *   (rotation, pane resize) — every month shows the same 6 rows, so the height
 *   only depends on the width.
 * - Never stops the strip growing: `min-height` lets content get taller, and
 *   when it does the held value goes up with it.
 * - A hidden strip (height 0) is never given a min-height.
 * - `resetOn` (optional): when it changes, the hold is released and the height
 *   read again from scratch after the next render — for content whose height
 *   really changes, e.g. fewer indicator rows once a filter hides some (#4516).
 *
 * The style is written straight to the element, not through a bound `:style`.
 */
export function useHoldHeight(el: Ref<HTMLElement | null>, resetOn?: WatchSource<unknown>): void {
  let held = 0
  let width = -1
  let observer: ResizeObserver | null = null

  function hold(node: HTMLElement, height: number) {
    held = height > 0 ? height : 0
    node.style.minHeight = held > 0 ? `${held}px` : ''
  }

  function measure() {
    const node = el.value
    if (!node) return
    const rect = node.getBoundingClientRect()
    if (rect.width !== width) {
      // first measure or width changed: read the natural height from scratch
      width = rect.width
      node.style.minHeight = ''
      hold(node, node.getBoundingClientRect().height)
    }
    else if (rect.height > held) {
      // content grew: the hold goes up with it
      hold(node, rect.height)
    }
  }

  onMounted(() => {
    measure()
    if (el.value && typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(measure)
      observer.observe(el.value)
    }
  })

  if (resetOn) {
    watch(resetOn, () => {
      width = -1
      measure()
    }, { flush: 'post' })
  }

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })
}
