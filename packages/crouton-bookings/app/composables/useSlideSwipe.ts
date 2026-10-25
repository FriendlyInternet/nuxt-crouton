import { swipeDirection, lockAxis } from '../utils/swipe'

/**
 * Finger-following horizontal swipe (#2515). While dragging, `dragX` tracks the
 * finger; on release past the threshold the content slides to the next/prev
 * period and `onNext`/`onPrev` fire, otherwise it springs back.
 *
 * `peek: true` — a 3-panel track (prev · current · next) is rendered, so the
 * neighbour is visible while dragging. `peek: false` — single panel that slides
 * out, swaps, and slides in from the opposite side.
 */
export function useSlideSwipe(
  el: Ref<HTMLElement | null>,
  opts: { onNext: () => void, onPrev: () => void, peek?: boolean },
) {
  const SLIDE_MS = 250
  const dragX = ref(0)
  const animating = ref(false)
  const dragging = ref(false)
  let lock: 'x' | 'y' | null = null
  let busy = false

  const reducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const width = () => el.value?.offsetWidth || 300
  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  const SIGN = { next: -1, prev: 1 } as const

  async function animateSlide(fire: () => void, w: number) {
    animating.value = true
    dragX.value = w
    await wait(SLIDE_MS)
    animating.value = false
    fire()
    if (opts.peek) {
      // neighbour panel is already in view: data swapped, snap back to centre
      dragX.value = 0
      return
    }
    dragX.value = -w
    await nextTick()
    await new Promise(r => requestAnimationFrame(r))
    animating.value = true
    dragX.value = 0
    await wait(SLIDE_MS)
    animating.value = false
  }

  async function slide(dir: 'next' | 'prev') {
    if (busy) return
    const fire = { next: opts.onNext, prev: opts.onPrev }[dir]
    if (reducedMotion()) {
      dragX.value = 0
      fire()
      return
    }
    busy = true
    await animateSlide(fire, width() * SIGN[dir])
    busy = false
  }

  async function springBack() {
    if (reducedMotion()) {
      dragX.value = 0
      return
    }
    animating.value = true
    dragX.value = 0
    await wait(SLIDE_MS)
    animating.value = false
  }

  const { lengthX, lengthY } = useSwipe(el, {
    passive: true,
    threshold: 0,
    onSwipeStart() {
      lock = null
    },
    onSwipe() {
      if (busy) return
      lock ??= lockAxis(-lengthX.value, -lengthY.value)
      if (lock !== 'x') return
      dragging.value = true
      animating.value = false
      dragX.value = -lengthX.value
    },
    onSwipeEnd() {
      const wasX = lock === 'x'
      lock = null
      dragging.value = false
      if (!wasX || busy) return
      const dir = swipeDirection(-lengthX.value, -lengthY.value)
      if (dir) slide(dir)
      else springBack()
    },
  })

  // Applied to the moving element. For `peek` the 3-panel track sits one
  // viewport to the left so the middle panel is the visible one.
  const style = computed(() => ({
    transform: opts.peek
      ? `translateX(calc(-100% + ${dragX.value}px))`
      : `translateX(${dragX.value}px)`,
    transition: animating.value ? `transform ${SLIDE_MS}ms ease-out` : 'none',
  }))

  return { slide, style, dragging }
}
