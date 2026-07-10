/**
 * Board node operations (#907/#942/#952–#955) — the callbacks SpikeBlockNode injects to act on
 * a node it identifies by object identity of its `data.node` (a default node component can't
 * emit up through CroutonFlow, so the page provides these): detach, reorder-within-layout,
 * promote-to-page, duplicate, pin-to-region, per-node resize, and delete. All undoable except
 * resize (it fires continuously).
 */
import { provide } from 'vue'
import type { Ref } from 'vue'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import { detachNode } from '@fyit/crouton-layout/app/utils/layout-edit'
import {
  SPIKE_DELETE_KEY,
  SPIKE_DETACH_KEY,
  SPIKE_DUPLICATE_KEY,
  SPIKE_REORDER_KEY,
  SPIKE_SET_PAGE_KEY,
  SPIKE_SET_REGION_KEY,
  SPIKE_SET_SIZE_KEY,
  sizeOf,
} from '~/utils/spike-layout'
import type { SpikeDetachPayload, SpikeNodeSize, SpikeRegion, SpikeReorderPayload } from '~/utils/spike-layout'
import { JSONclone, flattenLeaves } from '~/utils/spike-board'
import type { FlowNode } from '~/utils/spike-board'

const DETACH_GAP = 40

export function useSpikeNodeOps(opts: { nodes: Ref<FlowNode[]>, pushUndo: () => void, nextSeq: () => number }) {
  const { nodes, pushUndo, nextSeq } = opts

  // Pull-the-pane-to-detach (#907) — the inverse of snap-merge, a BOARD gesture. A SpikeBlockNode pops
  // a pane out of a merged group and reports it here (via SPIKE_DETACH_KEY — it can't emit up through
  // CroutonFlow). We split the group's `data.node`, shrink it to the remainder, and place the freed pane
  // WHERE you dropped it (payload.dropOffset, flow coords) — falling back to the pulled side if it's
  // unavailable. (Editing a node is the separate full-screen edit view — double-click; this is detach.)
  function onDetach(group: LayoutNode, payload: SpikeDetachPayload) {
    const idx = nodes.value.findIndex(n => n.data.node === group)
    if (idx === -1) return
    const host = nodes.value[idx]!
    const { root, detached } = detachNode(group, [payload.index])
    if (!detached || !root) return
    pushUndo()

    // Primary: land it where the pulled pane was released (WYSIWYG) — the node reports the pane's
    // flow-space offset from the group's top-left, we add it to the group's known position. Fallback
    // (no offset): place it on the side the drag pointed, just past the group's old extent.
    const gSize = sizeOf(group) // group's extent BEFORE it shrinks
    const dSize = sizeOf(detached)
    const horizontal = Math.abs(payload.dir.x) >= Math.abs(payload.dir.y)
    const pos = payload.dropOffset
      ? { x: host.position.x + payload.dropOffset.x, y: host.position.y + payload.dropOffset.y }
      : (horizontal
          ? { x: payload.dir.x >= 0 ? host.position.x + gSize.width + DETACH_GAP : host.position.x - dSize.width - DETACH_GAP, y: host.position.y }
          : { x: host.position.x, y: payload.dir.y >= 0 ? host.position.y + gSize.height + DETACH_GAP : host.position.y - dSize.height - DETACH_GAP })

    const label = flattenLeaves(detached)[0]?.label
    const freed: FlowNode = { id: `detached-${nextSeq()}`, type: 'default', position: { x: Math.round(pos.x), y: Math.round(pos.y) }, data: { node: detached, label } }
    // Shrink the host to the remainder (keeps its position) and add the freed pane beside it.
    nodes.value = nodes.value.map((n, i) => i === idx ? { ...n, data: { ...n.data, node: root } } : n).concat(freed)
  }
  provide(SPIKE_DETACH_KEY, onDetach)

  // Reorder a pane WITHIN its layout (#952): move child `from` → `to` in the split's children, keeping
  // each child's size. The FLIP reflow animates the rearrange. Identifies the group by object identity.
  function onReorder(group: LayoutNode, payload: SpikeReorderPayload) {
    if (group.type !== 'split') return
    const { from, to } = payload
    if (from === to || from < 0 || to < 0 || from >= group.children.length || to >= group.children.length) return
    const idx = nodes.value.findIndex(n => n.data.node === group)
    if (idx === -1) return
    pushUndo()
    const children = [...group.children]
    const [moved] = children.splice(from, 1)
    children.splice(to, 0, moved!)
    const next: LayoutNode = { ...group, children }
    nodes.value = nodes.value.map((n, i) => i === idx ? { ...n, data: { ...n.data, node: next } } : n)
  }
  provide(SPIKE_REORDER_KEY, onReorder)

  // ── Page promotion (#942) — the board is a sandbox; one node is "the page" (data.isPage). ──
  /** Promote a node to BE the page — the badge moves to it; all others become drafts. */
  function setAsPage(node: LayoutNode) {
    pushUndo()
    nodes.value = nodes.value.map(n => ({ ...n, data: { ...n.data, isPage: n.data.node === node } }))
  }
  /** Duplicate a node as a free draft (deep-cloned) so you can rearrange the copy, then promote it. */
  function duplicateNode(node: LayoutNode) {
    const src = nodes.value.find(n => n.data.node === node)
    if (!src) return
    pushUndo()
    nodes.value = [...nodes.value, {
      id: `copy-${nextSeq()}`,
      type: 'default',
      position: { x: src.position.x + 48, y: src.position.y + 48 },
      data: {
        node: JSONclone(src.data.node),
        label: src.data.label ? `${src.data.label} copy` : undefined,
        bp: src.data.bp ? JSONclone(src.data.bp) : undefined,
        isPage: false,
      },
    }]
  }
  /** Pin a node to the page's top/bottom edge as a sticky region, or clear it (#953). */
  function setRegion(node: LayoutNode, region: SpikeRegion | null) {
    pushUndo()
    nodes.value = nodes.value.map(n => n.data.node === node ? { ...n, data: { ...n.data, region: region ?? undefined } } : n)
  }
  /** Per-node resize (#954): set this node's display width/height (null width clears to footprint). The
   *  card then previews responsively at that width. No pushUndo per move (it fires continuously). */
  function setNodeSize(node: LayoutNode, sizeArg: SpikeNodeSize) {
    nodes.value = nodes.value.map(n => n.data.node === node
      ? { ...n, data: { ...n.data, width: sizeArg.width ?? undefined, height: (sizeArg.width === null ? undefined : (sizeArg.height ?? n.data.height)) } }
      : n)
  }
  provide(SPIKE_SET_PAGE_KEY, setAsPage)
  provide(SPIKE_DUPLICATE_KEY, duplicateNode)
  /** Delete a node (block or whole layout) from the canvas (#955). Undoable. */
  function deleteNode(node: LayoutNode) {
    if (!nodes.value.some(n => n.data.node === node)) return
    pushUndo()
    nodes.value = nodes.value.filter(n => n.data.node !== node)
  }
  provide(SPIKE_SET_REGION_KEY, setRegion)
  provide(SPIKE_SET_SIZE_KEY, setNodeSize)
  provide(SPIKE_DELETE_KEY, deleteNode)

  return { onDetach, onReorder, setAsPage, duplicateNode, setRegion, setNodeSize, deleteNode }
}
