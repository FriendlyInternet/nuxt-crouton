/**
 * Focus EDIT (#907 v2) — double-click a node and its layout ZOOMS UP in place: SpikeFocusShell
 * animates the card from the node's real on-screen rect to centre (a shared-element transition, NOT
 * the Vue Flow camera — so no re-measure/framing fight), the board falls away behind a blurred scrim,
 * and a minimal control shell hugs the layout (key-points pop, device + width on a floating pill;
 * collapse motion / variants behind a "⋯"). `zoomNodeId` ≠ null means the shell is open; `originRect`
 * is the node's rect captured at click so the zoom flies from exactly there.
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import type { CanvasMode, FlowNode } from '~/utils/spike-board'

const EMPTY_TREE: LayoutTree = { renderer: 'panes', root: { type: 'leaf', blockId: '', config: {} } }

export function useSpikeFocusEdit(nodes: Ref<FlowNode[]>, mode: Ref<CanvasMode>) {
  const zoomNodeId = ref<string | null>(null)
  const originRect = ref<{ x: number, y: number, width: number, height: number } | null>(null)
  const zoomNode = computed(() => zoomNodeId.value ? nodes.value.find(n => n.id === zoomNodeId.value) ?? null : null)
  const zoomLabel = computed(() => zoomNode.value?.data.label ?? 'Layout')
  const editing = computed(() => zoomNode.value !== null)

  function onNodeDblClick(id: string) {
    if (mode.value !== 'free') return
    if (!nodes.value.some(nd => nd.id === id)) return
    // Capture the node's current on-screen rect so the shell flies the zoom from exactly there, at the
    // flow's CURRENT zoom level. Use the visible CARD (`.spike-block-node`), NOT the `.vue-flow__node`
    // wrapper — the wrapper is sized smaller than the card (the content overflows it), so its rect would
    // start the morph from the wrong, tiny box instead of the layout you actually see on the canvas.
    const nodeEl = import.meta.client ? document.querySelector(`.vue-flow__node[data-id="${id}"]`) : null
    const el = nodeEl?.querySelector('.spike-block-node') ?? nodeEl
    const r = el?.getBoundingClientRect()
    originRect.value = r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
    // Open the edit view AT the node's RESIZED width (#954) — if you dragged the card's resize handle to
    // a width, focusing it lands on that same width, not the editor default. (Replaces the old global
    // survey-slider source.) null when the node hasn't been resized → the edit view picks its default.
    editInitialWidth.value = nodes.value.find(n => n.id === id)?.data.width ?? null
    zoomNodeId.value = id
  }
  const editInitialWidth = ref<number | null>(null)
  function closeEdit() {
    zoomNodeId.value = null
    originRect.value = null
  }

  // The focused node's layout as a v-model'd LayoutTree (root + authored breakpoints). The author
  // edits this directly — collapse/variant/sizes-per-keypoint all flow through `update:modelValue`,
  // so resize→keypoint is the author's own job (no separate SPIKE_RESIZE wiring). Persists back onto
  // the node by id, so the survey then reflects the authored responsiveness.
  const zoomTree = computed<LayoutTree>({
    get: () => {
      const n = zoomNode.value
      return n ? { renderer: 'panes' as const, root: n.data.node, breakpoints: n.data.bp } : EMPTY_TREE
    },
    set: (t: LayoutTree) => {
      const id = zoomNodeId.value
      if (!id) return
      nodes.value = nodes.value.map(n => n.id === id ? { ...n, data: { ...n.data, node: t.root, bp: t.breakpoints } } : n)
    },
  })

  return { zoomNodeId, originRect, zoomLabel, editing, editInitialWidth, zoomTree, onNodeDblClick, closeEdit }
}
