// Drag the track onto a pile (#2210). Pointer events, not HTML5 drag-and-drop (which iOS doesn't
// support): a fixed ghost with pointer-events: none follows the finger, and elementFromPoint finds
// what's under it. Holding over a pile that has sub-piles (or over back / a breadcrumb) for
// SPRING_MS "spring-loads" it: that level opens mid-drag so the track can go deeper.
//
// Drop targets are marked in the DOM, so any component can be one:
//   data-drop-pile="<id>"      file the track into this pile
//   data-drop-level="<id|top>" open this level (breadcrumb)
//   data-drop-up               go up a level (back arrow)
//   data-springs               on a data-drop-pile: holding opens it (it has sub-piles)

export const SPRING_MS = 700
const START_PX = 8 // a press only becomes a drag after this much movement, so taps still work

export type DropTarget = { kind: 'pile', id: string, springs: boolean } | { kind: 'level', id: string | null } | { kind: 'up' }

const keyOf = (t: DropTarget | null) => !t ? null : t.kind === 'pile' ? `pile:${t.id}` : t.kind === 'level' ? `level:${t.id ?? 'top'}` : 'up'

function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-pile],[data-drop-level],[data-drop-up]')
  if (!el) return null
  if (el.dataset.dropPile) return { kind: 'pile', id: el.dataset.dropPile, springs: el.hasAttribute('data-springs') }
  if (el.dataset.dropLevel) return { kind: 'level', id: el.dataset.dropLevel === 'top' ? null : el.dataset.dropLevel }
  return { kind: 'up' }
}

export function useCrateDrag(handlers: {
  /** The track was dropped on a pile. */
  drop: (pileId: string) => void
  /** A spring fired: open that level (`up` = one level up). */
  spring: (target: DropTarget) => void
  /** The drag ended, dropped or not. */
  end: () => void
}) {
  const dragging = ref(false)
  const x = ref(0)
  const y = ref(0)
  const over = ref<DropTarget | null>(null)
  const overKey = computed(() => keyOf(over.value))
  /** 0..1 — how far the spring on the hovered target has filled. */
  const progress = ref(0)

  let pressed: { x: number, y: number, id: number } | null = null
  let hoverSince = 0
  let firedKey: string | null = null
  let frame = 0

  function canSpring(t: DropTarget | null) {
    return !!t && (t.kind !== 'pile' || t.springs)
  }

  // Spring timing runs on animation frames off the hover start time, so the bar and the trigger
  // can't disagree, and nothing is left scheduled once the drag ends.
  function tick(now: number) {
    if (!dragging.value) return
    // Re-hit-test every frame: after a spring opens a level, a new pile sits under a still finger.
    hover()
    if (canSpring(over.value) && overKey.value !== firedKey) {
      progress.value = Math.min(1, (now - hoverSince) / SPRING_MS)
      if (progress.value >= 1) {
        firedKey = overKey.value
        progress.value = 0
        handlers.spring(over.value!)
      }
    }
    else progress.value = 0
    frame = requestAnimationFrame(tick)
  }

  function hover() {
    const t = targetAt(x.value, y.value)
    if (keyOf(t) === overKey.value) return
    over.value = t
    hoverSince = performance.now()
    // Leaving the target that just sprang lets it spring again later.
    if (keyOf(t) !== firedKey) firedKey = null
  }

  /** Bind to pointerdown on the drag handle. */
  function press(e: PointerEvent) {
    if (e.button !== 0) return
    pressed = { x: e.clientX, y: e.clientY, id: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function finish(dropped: boolean) {
    const target = over.value
    const wasDragging = dragging.value
    pressed = null
    dragging.value = false
    over.value = null
    progress.value = 0
    firedKey = null
    cancelAnimationFrame(frame)
    if (!wasDragging) return
    if (dropped && target?.kind === 'pile') handlers.drop(target.id)
    handlers.end()
  }

  if (import.meta.client) {
    useEventListener(window, 'pointermove', (e: PointerEvent) => {
      if (!pressed || e.pointerId !== pressed.id) return
      x.value = e.clientX
      y.value = e.clientY
      if (!dragging.value) {
        if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < START_PX) return
        dragging.value = true
        frame = requestAnimationFrame(tick)
      }
      e.preventDefault()
    }, { passive: false })
    useEventListener(window, 'pointerup', (e: PointerEvent) => { if (pressed && e.pointerId === pressed.id) finish(true) })
    useEventListener(window, 'pointercancel', (e: PointerEvent) => { if (pressed && e.pointerId === pressed.id) finish(false) })
    useEventListener(window, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Escape' && dragging.value) finish(false) })
  }

  return { dragging, x, y, over, overKey, progress, press }
}
