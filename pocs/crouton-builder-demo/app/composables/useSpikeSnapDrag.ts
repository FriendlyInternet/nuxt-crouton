/**
 * In-flow snap + MERGE (#907) — snapping happens ON the Vue Flow canvas, no separate mode.
 * Owns the live snap preview (provided via SPIKE_SNAP_KEY; SpikeBlockNode injects it and
 * matches by object identity), the dwell-to-arm timer, and the on-release merge/pane-drop.
 */
import { provide, shallowRef } from 'vue'
import type { Ref } from 'vue'
import { SPIKE_SNAP_KEY, applyPaneDrop, sizeOf } from '~/utils/spike-layout'
import type { SnapEdge, SpikeSnapPreview } from '~/utils/spike-layout'
import { combineNodes, labelFor, snapIntent } from '~/utils/spike-board'
import type { FlowNode } from '~/utils/spike-board'

/** The merged group node for an EDGE merge onto a side of the target (the original snap). */
function edgeMergedNode(target: FlowNode, moved: FlowNode, edge: SnapEdge, keepPage: { isPage?: boolean }): FlowNode {
  const md = sizeOf(moved.data.node)
  const horizontal = edge === 'left' || edge === 'right'
  const targetFirst = edge === 'right' || edge === 'bottom'
  const combined = combineNodes(target.data.node, moved.data.node, horizontal ? 'horizontal' : 'vertical', targetFirst)
  const gx = edge === 'left' ? target.position.x - md.width : target.position.x
  const gy = edge === 'top' ? target.position.y - md.height : target.position.y
  return { ...target, position: { x: Math.round(gx), y: Math.round(gy) }, data: { node: combined, ...keepPage } }
}

// The merged/inserted row set for an ARMED release, or null to just place the rows as emitted.
// The target FlowNode is matched by STABLE id (CroutonFlow re-emits rows on drag-end that don't keep
// `data.node` by reference, so the old identity match missed and the drop silently no-op'd). Fall back
// to node identity for safety.
function applyArmedSnap(rows: FlowNode[], moved: FlowNode, armed: SpikeSnapPreview): FlowNode[] | null {
  const target = rows.find(r => r.id !== moved.id && (r.id === armed.targetId || r.data.node === armed.node))
  if (!target) return null
  // Page (favorited) ALWAYS consumes (#942): if either side is the page, the result stays the page.
  const keepPage = (target.data.isPage || moved.data.isPage) ? { isPage: true } : {}

  // PANEDROP — add the dragged node beside the targeted pane (flatten into the row if the side runs
  // along it, else wrap the pane perpendicular). Works on any pane edge, incl. the right of a pane in
  // a vertical stack. The targeted pane may be a lone block (path []). (#972)
  if (armed.paneDrop) {
    const newNode = applyPaneDrop(target.data.node, armed.paneDrop, moved.data.node)
    const groupNode: FlowNode = { ...target, data: { node: newNode, ...keepPage } }
    return rows.filter(r => r.id !== moved.id && r.id !== target.id).concat(groupNode)
  }

  if (armed.edge) {
    const groupNode = edgeMergedNode(target, moved, armed.edge, keepPage)
    return rows.filter(r => r.id !== moved.id && r.id !== target.id).concat(groupNode)
  }

  return null
}

export function useSpikeSnapDrag(opts: { nodes: Ref<FlowNode[]>, pushUndo: () => void }) {
  const { nodes, pushUndo } = opts

  // Live snap preview (#907): while a block is dragged, the target node it will snap to lights
  // up the joining edge. Provided here; SpikeBlockNode injects it and matches by object identity.
  const snapPreview = shallowRef<SpikeSnapPreview | null>(null)
  provide(SPIKE_SNAP_KEY, snapPreview)

  // Live snap guide (#907): CroutonFlow streams the dragged node's position via `@node-drag`
  // (its collab sync already broadcasts it continuously). On each frame we recompute the snap
  // candidate and light up the target's joining edge — so "the side that's gonna snap lines up"
  // is visible BEFORE you let go, not just after the merge.
  // Dwell-to-snap (#941): a snap takes intent, not a brush-past. The moment you're near a snap
  // point it shows SOFT (blue, "snap point here"); hold there ~0.6s and it ARMS (green, "release to
  // snap"). A timer (not frame-based) so it still arms while the finger holds perfectly still (no
  // drag events fire then). Moving away / to a different edge resets it.
  const SNAP_DWELL_MS = 600
  let snapKey: string | null = null
  let snapTimer: number | null = null
  // The id of the node currently being dragged — the reliable way for onRowsUpdate to know WHICH node
  // moved. (Position-delta detection misses it: Vue Flow mutates node positions in place, so the rows
  // it re-emits on drag-end already equal our stored positions → no delta.) Set live, consumed on release.
  let draggedId: string | null = null
  function clearSnapTimer() { if (snapTimer != null) { window.clearTimeout(snapTimer); snapTimer = null } }
  function resetSnap() { snapPreview.value = null; snapKey = null; clearSnapTimer() }

  function onNodeDragLive(id: string, pos: { x: number, y: number }) {
    draggedId = id
    const moved = nodes.value.find(n => n.id === id)
    if (!moved) { resetSnap(); return }
    const intent = snapIntent(moved.data.node, pos, nodes.value.filter(n => n.id !== id))
    if (!intent) { resetSnap(); return } // out of range → no candidate, dwell resets
    // Dwell key is COARSE for pane-drops — keyed on the target + the PANE (path), NOT the side — so small
    // movements that flip the nearest edge don't reset the arm timer; the side keeps tracking the finger
    // live (base carries the current edge) and the green arms reliably after the hold.
    const key = intent.kind === 'panedrop' ? `pane-${intent.target.id}-${intent.paneDrop.path.join('.')}` : `edge-${intent.target.id}-${intent.edge}`
    const dragLabel = moved.data.label ?? labelFor(moved.data.node)
    const base: SpikeSnapPreview = intent.kind === 'panedrop'
      ? { node: intent.target.data.node, targetId: intent.target.id, paneDrop: intent.paneDrop, dragLabel, dragNode: moved.data.node }
      : { node: intent.target.data.node, targetId: intent.target.id, edge: intent.edge, dragLabel }
    if (key === snapKey) {
      // Same candidate as last frame — keep the (possibly already-armed) state; don't restart dwell.
      snapPreview.value = { ...base, armed: snapPreview.value?.armed === true }
      return
    }
    // New candidate → soft state + (re)start the dwell-to-arm timer.
    snapKey = key
    clearSnapTimer()
    snapPreview.value = { ...base, armed: false }
    snapTimer = window.setTimeout(() => {
      if (snapKey === key && snapPreview.value) snapPreview.value = { ...snapPreview.value, armed: true }
    }, SNAP_DWELL_MS)
  }

  // CroutonFlow re-emits the moved rows on drag stop; we OWN that update (not v-model) so our
  // write is the last one (a plain v-model would clobber it with the drop point). If the dropped
  // node lands near another's edge, the two MERGE into one node whose `data.node` is a bound
  // split — so the unit drags as one piece and the renderer stretches each pane to the group's
  // full size (a block snapped to a 2-high stack spans its full height).
  function onRowsUpdate(rowsRaw: Record<string, unknown>[]) {
    const armed = snapPreview.value?.armed === true ? snapPreview.value : null // the green candidate at release
    resetSnap() // drag has ended — clear the live guide + dwell timer
    const rows = rowsRaw as unknown as FlowNode[]
    const dragId = draggedId
    draggedId = null
    // Which node moved: prefer the live-tracked drag id (robust); fall back to a position delta.
    const prev = new Map(nodes.value.map(n => [n.id, n.position]))
    const moved = (dragId ? rows.find(r => r.id === dragId) : undefined)
      ?? rows.find((r) => { const p = prev.get(r.id); return p && (p.x !== r.position.x || p.y !== r.position.y) })
    if (!moved) { nodes.value = rows; return }
    pushUndo() // a real move (reposition / merge / insert) is about to apply — snapshot first
    // Released while only SOFT (not held long enough) → just place it; snapping requires the dwell.
    if (!armed) { nodes.value = rows; return }

    nodes.value = applyArmedSnap(rows, moved, armed) ?? rows
  }

  return { snapPreview, onNodeDragLive, onRowsUpdate, resetSnap }
}
