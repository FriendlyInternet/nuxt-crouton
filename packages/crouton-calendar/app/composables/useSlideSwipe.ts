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
  opts: { onNext: () => void, onPrev: () => void, peek?: boolean, track: Ref<HTMLElement | null> },
) {
  const SLIDE_MS = 250
  // Plain variables, not refs: the track's transform is written straight to the
  // DOM so a drag frame never re-renders the panels (and the consumer's slots).
  let dragX = 0
  let animating = false
  const dragging = ref(false)

  function render() {
    const t = opts.track.value
    if (!t) return
    t.style.transform = opts.peek
      ? `translateX(calc(-100% + ${dragX}px))`
      : `translateX(${dragX}px)`
    t.style.transition = animating ? `transform ${SLIDE_MS}ms ease-out` : 'none'
  }
  let lock: 'x' | 'y' | null = null
  let busy = false

  const reducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const width = () => el.value?.offsetWidth || 300
  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  const SIGN = { next: -1, prev: 1 } as const

  // wait until the new period has actually rendered before sliding it in
  async function settle() {
    await nextTick()
    await new Promise(r => requestAnimationFrame(r))
  }

  async function animateSlide(fire: () => void, w: number) {
    animating = true
    render()
    dragX = w
    render()
    await wait(SLIDE_MS)
    animating = false
    render()
    fire()
    if (opts.peek) {
      // neighbour panel is already in view: data swapped, snap back to centre
      dragX = 0
      render()
      return
    }
    dragX = -w
    render()
    await settle()
    animating = true
    render()
    dragX = 0
    render()
    await wait(SLIDE_MS)
    animating = false
    render()
  }

  async function slide(dir: 'next' | 'prev') {
    if (busy) return
    const fire = { next: opts.onNext, prev: opts.onPrev }[dir]
    if (reducedMotion()) {
      dragX = 0
      render()
      fire()
      return
    }
    busy = true
    try {
      await animateSlide(fire, width() * SIGN[dir])
    }
    finally {
      // never leave the content stuck off-screen
      animating = false
      render()
      dragX = 0
      render()
      busy = false
    }
  }

  async function springBack() {
    if (reducedMotion()) {
      dragX = 0
      render()
      return
    }
    animating = true
    render()
    dragX = 0
    render()
    await wait(SLIDE_MS)
    animating = false
    render()
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
      animating = false
      render()
      dragX = -lengthX.value
      render()
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

  return { slide, dragging }
}
