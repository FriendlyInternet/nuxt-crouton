/**
 * Board drag (#2375) — one pointer-event drag for touch and mouse.
 *
 * Native HTML5 drag doesn't start from a touch on iOS Safari (and a horizontal
 * scroll strip claims the gesture first), so the board runs its own, minimal
 * drag: hold a source briefly, then move. On every pointermove the pane under
 * the finger is resolved with `elementFromPoint` and the edge computed from
 * that pane's rect — stateless per move. Release drops. The tree only changes
 * on drop, in the handler the page registers. No ghost in the tree, no
 * coordinate conversion, one shared state object.
 */
import type { NodePath, DropEdge } from '@fyit/crouton-layout/app/utils/layout-edit'

export type BoardDragPayload
  = { kind: 'block', blockId: string, label: string }
  | { kind: 'pane', path: NodePath, label: string }

export interface BoardHover { path: NodePath, edge: DropEdge }

const PANE_SELECTOR = '[data-handoff="board-pane"]'

const payload = ref<BoardDragPayload | null>(null)
const hover = ref<BoardHover | null>(null)
const point = ref<{ x: number, y: number } | null>(null)
/** Set when a drag completed, so the click that may follow (pointer capture) is ignored once. */
let swallowClick = false
let onDropHandler: ((at: NodePath, edge: DropEdge, p: BoardDragPayload) => void) | null = null

/** Which edge of `rect` the point is nearest; the middle 50% is `center`. */
export function edgeFor(x: number, y: number, rect: DOMRect): DropEdge {
  const fx = (x - rect.left) / rect.width
  const fy = (y - rect.top) / rect.height
  const dx = Math.min(fx, 1 - fx)
  const dy = Math.min(fy, 1 - fy)
  if (dx > 0.25 && dy > 0.25) return 'center'
  if (dx < dy) return fx < 0.5 ? 'left' : 'right'
  return fy < 0.5 ? 'top' : 'bottom'
}

export function samePath(a: NodePath, b: NodePath): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** True when `inner` is `outer` or sits beneath it. */
export function isWithin(inner: NodePath, outer: NodePath): boolean {
  return outer.length <= inner.length && outer.every((v, i) => v === inner[i])
}

function pathOf(el: Element): NodePath {
  const raw = (el as HTMLElement).dataset.path ?? ''
  return raw === '' ? [] : raw.split('.').map(Number)
}

function resolveHover(x: number, y: number): BoardHover | null {
  const p = payload.value
  if (!p) return null
  const el = document.elementFromPoint(x, y)?.closest(PANE_SELECTOR)
  if (!el) return null
  const path = pathOf(el)
  // A pane can't be dropped onto itself or into its own subtree.
  if (p.kind === 'pane' && isWithin(path, p.path)) return null
  return { path, edge: edgeFor(x, y, el.getBoundingClientRect()) }
}

export function useBoardDrag() {
  /**
   * Arm a drag from a pointerdown. It starts after `holdMs` without the pointer
   * moving more than `slop` px (so a horizontal strip can still scroll on a
   * quick swipe); a mouse starts on movement alone.
   */
  function arm(e: PointerEvent, p: BoardDragPayload, opts: { holdMs?: number, slop?: number } = {}) {
    if (e.button !== 0) return
    const holdMs = opts.holdMs ?? 250
    const slop = opts.slop ?? 8
    const sx = e.clientX
    const sy = e.clientY
    const target = e.currentTarget as HTMLElement
    const isMouse = e.pointerType === 'mouse'
    let active = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const activate = () => {
      if (active) return
      active = true
      payload.value = p
      point.value = { x: sx, y: sy }
      try { target.setPointerCapture(e.pointerId) }
      catch {}
    }

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      const moved = Math.hypot(ev.clientX - sx, ev.clientY - sy) > slop
      if (!active) {
        if (isMouse && moved) activate()
        else if (moved) return cleanup() // a swipe, not a hold → let the browser scroll
        else return
      }
      ev.preventDefault()
      point.value = { x: ev.clientX, y: ev.clientY }
      hover.value = resolveHover(ev.clientX, ev.clientY)
    }
    // Once the hold has armed the drag, stop the browser from turning the touch
    // into a scroll (which would pointercancel us). Before that, a swipe scrolls.
    const touchMove = (ev: TouchEvent) => {
      if (active) ev.preventDefault()
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      if (active) {
        swallowClick = true
        const h = resolveHover(ev.clientX, ev.clientY)
        if (h && onDropHandler) onDropHandler(h.path, h.edge, p)
      }
      cleanup()
    }
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      timer = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('touchmove', touchMove)
      try { target.releasePointerCapture(e.pointerId) }
      catch {}
      payload.value = null
      hover.value = null
      point.value = null
    }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('touchmove', touchMove, { passive: false })
    if (!isMouse) timer = setTimeout(activate, holdMs)
  }

  function onDrop(fn: typeof onDropHandler) {
    onDropHandler = fn
  }

  /** True once right after a drag ended — a click handler calls this to skip its tap action. */
  function consumeClick(): boolean {
    const s = swallowClick
    swallowClick = false
    return s
  }

  return { payload, hover, point, arm, onDrop, consumeClick }
}
