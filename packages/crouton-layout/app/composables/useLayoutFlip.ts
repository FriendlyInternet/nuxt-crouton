/**
 * useLayoutFlip (#943) — the DOM half of FLIP-animating a split's panes when its
 * children change. Paired with the pure helpers in `utils/layout-flip`.
 *
 * Purely additive and self-cleaning: it never changes keys, `default-size`, splitter
 * registration, or sizing — only the panes' `transform`, set for one frame and tweened
 * back to identity. A static layout (no structural change) gets zero added transforms,
 * and `prefers-reduced-motion: reduce` makes it a no-op. So every app that renders a
 * layout inherits the motion with no behaviour change when nothing structural happens.
 *
 * How it stays correct across a pane rebuild: `panels()` returns the group's DIRECT pane
 * elements in child order. We capture each pane's box BEFORE the structural change (a
 * `flush: 'pre'` watcher, while the OLD DOM is still mounted) labelled by the keys that
 * matched that old render; after the new DOM settles we match survivors by `contentKey`
 * and apply the inverse transform. New panes (no old box) simply don't animate.
 */
import { nextTick, watch, type ComputedRef } from 'vue'
import { flipTransform, type FlipBox } from '../utils/layout-flip'

const FLIP_MS = 380
const FLIP_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

export interface UseLayoutFlipOptions {
  /** Only animate while this is true (a `split` whose own panes can restructure). */
  enabled: ComputedRef<boolean>
  /** Per-child keys for the CURRENT render, index-aligned with `panels()`. */
  keys: ComputedRef<string[]>
  /** Direct pane DOM elements of this split, in child order (handles excluded). */
  panels: () => HTMLElement[]
}

function boxOf(el: HTMLElement): FlipBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function useLayoutFlip(opts: UseLayoutFlipOptions): void {
  // SSR / no-DOM: nothing to measure or animate.
  if (typeof window === 'undefined') return

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')

  // The keys that match what's currently in the DOM (updated after each render), and the
  // boxes captured for them just before a structural change.
  let domKeys: string[] = []
  let captured: Map<string, FlipBox> | null = null

  const signature = () => opts.keys.value.join('|')

  // BEFORE the DOM patches for this change — the old panes are still mounted, so label them
  // with the keys that matched the old render (`domKeys`), not the new computed keys.
  watch(signature, () => {
    if (!opts.enabled.value) { captured = null; return }
    const map = new Map<string, FlipBox>()
    opts.panels().forEach((el, i) => {
      const k = domKeys[i]
      if (k) map.set(k, boxOf(el))
    })
    captured = map
  }, { flush: 'pre' })

  // AFTER the new panes are in the DOM — match survivors by key and play them in from
  // their old boxes. Refresh `domKeys` for the next change regardless of whether we animate.
  watch(signature, () => {
    const old = captured
    captured = null
    const keys = opts.keys.value

    if (!old || !opts.enabled.value || reduced?.matches) {
      domKeys = keys
      return
    }

    nextTick(() => {
      opts.panels().forEach((el, i) => {
        const k = keys[i]
        const from = k ? old.get(k) : undefined
        if (!from) return // a freshly added pane — let it appear without a FLIP
        const t = flipTransform(from, boxOf(el))
        if (!t) return

        el.style.transformOrigin = '0 0'
        el.style.transition = 'none'
        el.style.transform = `translate(${t.dx}px, ${t.dy}px) scale(${t.sx}, ${t.sy})`

        // Two frames so the "from" transform is committed before we release to identity.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`
          el.style.transform = ''
          const done = () => {
            el.style.transition = ''
            el.style.transformOrigin = ''
            el.removeEventListener('transitionend', done)
          }
          el.addEventListener('transitionend', done)
        }))
      })
      domKeys = keys
    })
  }, { flush: 'post' })

  // Seed `domKeys` with the first render so the first structural change matches correctly.
  watch(opts.keys, (k) => { if (!domKeys.length) domKeys = k }, { flush: 'post', immediate: true })
}
