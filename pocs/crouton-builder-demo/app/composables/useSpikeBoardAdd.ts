/**
 * Adding blocks to the board (#906) — the HTML5 drag source, the drop handler, tap-to-add
 * (mobile), and the camera framing that keeps a fresh block visible.
 */
import { nextTick } from 'vue'
import type { Ref } from 'vue'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import { sizeOf } from '~/utils/spike-layout'
import { boardBounds, clearSpot } from '~/utils/spike-board'
import type { FlowNode, SpikeFlowHandle } from '~/utils/spike-board'

export function useSpikeBoardAdd(opts: { nodes: Ref<FlowNode[]>, flowRef: Ref<SpikeFlowHandle | null>, pushUndo: () => void, nextSeq: () => number }) {
  const { nodes, flowRef, pushUndo, nextSeq } = opts

  /** HTML5 drag source: stamp the crouton-item payload CroutonFlow's drop handler reads. */
  function onDragStart(e: DragEvent, item: { blockId: string, label: string }) {
    e.dataTransfer?.setData('application/json', JSON.stringify({
      type: 'crouton-item',
      collection: 'artists',
      item: { id: `${item.blockId}-${nextSeq()}`, ...item },
    }))
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  let justAddedTimer: number | null = null
  /** CroutonFlow emits this on drop with the flow-space position — add a fresh leaf node. */
  function onNodeDrop(item: Record<string, unknown>, position: { x: number, y: number }) {
    pushUndo()
    const label = String(item.label ?? item.blockId)
    const leaf: LayoutNode = { type: 'leaf', blockId: String(item.blockId), config: { collection: 'artists', heading: label } }
    const added: FlowNode = { id: String(item.id), type: 'default', position, data: { node: leaf, label, justAdded: true } }
    // Clear any prior "just added" highlight so only the newest block glows; fade this one after a beat.
    nodes.value = [...nodes.value.map(n => (n.data.justAdded ? { ...n, data: { ...n.data, justAdded: false } } : n)), added]
    if (justAddedTimer != null) window.clearTimeout(justAddedTimer)
    justAddedTimer = window.setTimeout(() => {
      nodes.value = nodes.value.map(n => (n.id === added.id ? { ...n, data: { ...n.data, justAdded: false } } : n))
    }, 2600)
    // Center on the new block at a moderate zoom (frame it with breathing room — not too deep), so it's
    // always visible after adding rather than hidden behind / off-screen of the existing layouts.
    const s = sizeOf(leaf)
    const margin = Math.max(s.width, s.height) * 0.9
    nextTick(() => flowRef.value?.fitBounds?.(
      { x: position.x - margin, y: position.y - margin, width: s.width + margin * 2, height: s.height + margin * 2 },
      { duration: 350, padding: 0.1 },
    ))
  }

  // Tap-to-add (#906 mobile fix): HTML5 drag doesn't fire on touch, and the bottom-sheet
  // covers the canvas — so on a phone you can't drag a block onto the flow. Tapping a block
  // adds it directly (drag still works on desktop). New nodes stagger left-to-right so the
  // positional "As placed" reads in add order; the drawer stays open so you can add several.
  const toast = useToast()
  function addBlock(item: { blockId: string, label: string }) {
    onNodeDrop(
      { id: `${item.blockId}-${nextSeq()}`, blockId: item.blockId, label: item.label },
      clearSpot(nodes.value), // open spot to the right of everything — never hidden under an existing layout
    )
    toast.add({ title: `Added ${item.label}`, icon: 'i-lucide-plus', duration: 1200 })
  }

  // Top-level Fit = zoom the camera to show every node — just frames the board. We frame by the
  // nodes' KNOWN geometry (position + sizeOf), NOT Vue Flow's `fitView` — VF measures the
  // `.vue-flow__node` wrapper, which is smaller than our overflowing card, so its fit zooms into a
  // corner of the oversized content. fitBounds on the real union box (like fitPage does for one
  // node) frames correctly. (#952 follow-up — same wrapper-vs-card mismatch.)
  function fitBoard() {
    nextTick(() => {
      const b = boardBounds(nodes.value)
      if (b && flowRef.value?.fitBounds) flowRef.value.fitBounds(b, { duration: 250, padding: 0.18 })
      else flowRef.value?.fitView?.({ duration: 250, padding: 0.18, maxZoom: 1 })
    })
  }

  return { onDragStart, onNodeDrop, addBlock, fitBoard }
}
