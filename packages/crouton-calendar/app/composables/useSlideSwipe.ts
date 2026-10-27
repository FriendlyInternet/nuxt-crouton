import { swipeDirection, lockAxis } from '../utils/swipe'

/**
 * Finger-following horizontal swipe (#2515). While dragging, `dragX` tracks the
 * finger; on release past the threshold the content slides to the next/prev
 * period and `onNext`/`onPrev` fire, otherwise it springs back.
 *
 * The track is a 3-panel strip (prev · current · next), so the neighbour is
 * visible while dragging.
 */
export function useSlideSwipe(
  el: Ref<HTMLElement | null>,
  opts: { onNext: () => void, onPrev: () => void, track: Ref<HTMLElement | null> },
) {
  const SLIDE_MS = 250
  // Plain variables, not refs: the track's transform is written straight to the
  // DOM so a drag frame never re-renders the panels (and the consumer's slots).
  let dragX = 0
  let animating = false

  function render() {
    const t = opts.track.value
    if (!t) return
    t.style.transform = `translateX(calc(-100% + ${dragX}px))`
    t.style.transition = animating ? `transform ${SLIDE_MS}ms ease-out` : 'none'
  }
  let lock: 'x' | 'y' | null = null
  let busy = false

  const reducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const width = () => el.value?.offsetWidth || 300
  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  const SIGN = { next: -1, prev: 1 } as const

  async function animateSlide(fire: () => void, w: number) {
    animating = true
    render()
    dragX = w
    render()
    await wait(SLIDE_MS)
    animating = false
    render()
    fire()
    // neighbour panel is already in view: data swapped, snap back to centre
    dragX = 0
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
      animating = false
      render()
      dragX = -lengthX.value
      render()
    },
    onSwipeEnd() {
      const wasX = lock === 'x'
      lock = null
      if (!wasX || busy) return
      const dir = swipeDirection(-lengthX.value, -lengthY.value)
      if (dir) slide(dir)
      else springBack()
    },
  })

  return { slide }
}
