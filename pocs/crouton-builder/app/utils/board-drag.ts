/**
 * Board drag state (#2375) — the one piece of shared state the drop targets read.
 *
 * Native browser drag events carry the payload in `dataTransfer`, but `getData` is
 * unreadable during `dragover`, so the payload is mirrored here for the duration
 * of a drag. No timers, no pointer capture: a drop target decides its edge from
 * its OWN rect on every `dragover` and the tree only changes on `drop`.
 */
import type { Ref } from 'vue'
import type { NodePath, DropEdge } from '@fyit/crouton-layout/app/utils/layout-edit'

export type BoardDragPayload
  = { kind: 'block', blockId: string }
  | { kind: 'pane', path: NodePath }

export const BOARD_MIME = 'application/x-crouton-board'

const current = ref<BoardDragPayload | null>(null)

export function useBoardDrag() {
  function start(e: DragEvent, payload: BoardDragPayload) {
    current.value = payload
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(BOARD_MIME, JSON.stringify(payload))
      // Some browsers need a text payload before they'll start a drag at all.
      e.dataTransfer.setData('text/plain', payload.kind === 'block' ? payload.blockId : 'pane')
    }
  }
  function end() {
    current.value = null
  }
  return { dragging: current as Readonly<Ref<BoardDragPayload | null>>, start, end }
}

/** Which edge of `rect` the pointer is nearest; the middle 50% is `center`. */
export function edgeFor(e: DragEvent, rect: DOMRect): DropEdge {
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height
  const dx = Math.min(x, 1 - x)
  const dy = Math.min(y, 1 - y)
  if (dx > 0.25 && dy > 0.25) return 'center'
  if (dx < dy) return x < 0.5 ? 'left' : 'right'
  return y < 0.5 ? 'top' : 'bottom'
}

export function samePath(a: NodePath, b: NodePath): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** True when `inner` is `outer` or sits beneath it. */
export function isWithin(inner: NodePath, outer: NodePath): boolean {
  return outer.length <= inner.length && outer.every((v, i) => v === inner[i])
}
