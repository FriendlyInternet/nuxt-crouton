import type { Ref, WatchSource } from 'vue'

/**
 * Hold an element's height while `source` changes, until the next frame (#3924 / #3813).
 *
 * The swipe strip has no height of its own: while its panels are patched it is
 * briefly shorter, and WebKit clamps the page scroll to fit. Pinning the
 * current height before the re-render (and releasing it a frame later) stops
 * the page jumping. The style is written straight to the element — Vue patches
 * children before the parent's props, so a bound `:style` would arrive too late.
 */
export function useHoldHeight(el: Ref<HTMLElement | null>, source: WatchSource<unknown>): void {
  let frame: number | null = null
  function cancel() {
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    frame = null
  }
  // pre: before the re-render, pin the current height (unrounded) straight on the element
  watch(source, () => {
    cancel()
    const node = el.value
    if (!node) return
    const height = node.getBoundingClientRect().height
    if (height > 0) node.style.minHeight = `${height}px`
  }, { flush: 'pre' })
  // post: after the patch, release on the next frame
  watch(source, () => {
    if (typeof requestAnimationFrame !== 'function') return
    cancel()
    frame = requestAnimationFrame(() => {
      frame = null
      if (el.value) el.value.style.minHeight = ''
    })
  }, { flush: 'post' })
  onBeforeUnmount(cancel)
}
