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
 *
 * On the board (#3916) the target comes from the rectangles on screen instead —
 * the page's edge, a group's edge, a block, or the space under a block — resolved
 * by the pure `resolveTarget` (board-target.ts).
 */
import type { NodePath, DropEdge } from '@fyit/crouton-layout/app/utils/layout-edit'
import { edgeFor, resolveTarget, type BoardTarget, type BoardGeometry, type Rect } from './board-target'

export { edgeFor }
export type { BoardTarget }

export type BoardDragPayload
  = { kind: 'block', blockId: string, label: string }
  | { kind: 'pane', path: NodePath, label: string }

const PANE_SELECTOR = '[data-handoff="board-pane"]'
const HANDLE_SELECTOR = '[data-handoff="pane-resize-handle"]'

const payload = ref<BoardDragPayload | null>(null)
const hover = ref<BoardTarget | null>(null)
const point = ref<{ x: number, y: number } | null>(null)
/** Set when a drag completed, so the click that may follow (pointer capture) is ignored once. */
let swallowClick = false
let onDropHandler: ((at: NodePath, edge: DropEdge, p: BoardDragPayload, target: BoardTarget) => void) | null = null

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

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

function resolveHover(x: number, y: number): BoardTarget | null {
  const p = payload.value
  if (!p) return null
  const el = document.elementFromPoint(x, y)
  const frame = el?.closest('[data-board-frame]')
  const rootEl = frame?.querySelector('[data-board-root]')
  if (!frame || !rootEl) {
    // Off the board tree (the empty-board placeholder, …): only a pane under the finger.
    const paneEl = el?.closest(PANE_SELECTOR)
    if (!paneEl) return null
    const path = pathOf(paneEl)
    // A pane can't be dropped onto itself or into its own subtree.
    if (p.kind === 'pane' && isWithin(path, p.path)) return null
    const rect = rectOf(paneEl)
    return { scope: 'pane', path, edge: edgeFor(x, y, rect), rect }
  }
  const geo: BoardGeometry = {
    frame: rectOf(frame),
    root: rectOf(rootEl),
    groups: [...rootEl.querySelectorAll('[data-board-group]')].map(g => ({ path: pathOf(g), rect: rectOf(g) })),
    panes: [...rootEl.querySelectorAll(PANE_SELECTOR)].map(g => ({ path: pathOf(g), rect: rectOf(g) })),
    handles: [...rootEl.querySelectorAll(HANDLE_SELECTOR)].map(rectOf),
  }
  return resolveTarget(x, y, geo, p.kind === 'pane' ? p.path : undefined)
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
        if (h && onDropHandler) onDropHandler(h.path, h.edge, p, h)
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
