<script setup lang="ts">
/**
 * /builder/[pageId] — the PAGE BOARD, on the CroutonFlow candidate canvas.
 *
 * The board is a Vue Flow surface of layout candidates; exactly ONE node is "the page"
 * (spec: `page-model-one-node`), rendered over the REAL collections through the package
 * renderer (WYSIWYG). This is a REAL route (deep-linkable, browser-back returns to
 * `/builder`) — the graduated replacement for the POC's `selectedPageId` v-if swap
 * (spec: `page-site-routing`).
 *
 * This slice rebuilds the board on the canvas with the foundational gestures:
 *  · page-model-one-node — the persisted page LayoutTree seeds as one ★ node
 *  · add-block-land      — palette drop/tap lands a fresh block in a clear spot right of everything
 *  · enter-page-fit      — entering the page frames its node
 *  · drag-glow           — a dragged card carries a light-green halo (BuilderBlockNode)
 * Board state persists DURABLY: the page node serialises through the package's canonical
 * `layout-serialize` (spec: `layouttree-serialise`) to the `board` json column of the
 * `builderPages` row (spec: `board-persistence`). The heavy in-canvas gestures
 * (snap-dwell, pane-drop, detach/reorder, pinch-zoom, focus-edit) arrive in the next slice.
 *
 * Hooks: `page-badge` + `region-pill` (on the node), `floor-readout` (header).
 */
import { markRaw, shallowRef, provide } from 'vue'
import type { LayoutNode, LayoutTree, LayoutBreakpoint } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import { dropNode, applyPaneDrop, detachNode, moveChild } from '@fyit/crouton-layout/app/utils/layout-edit'
import { snapEdge, rectsOverlapFrac } from '@fyit/crouton-layout/app/utils/layout-snap'
import BuilderBlockNode from '~/components/BuilderBlockNode.vue'
import { BUILDER_SNAP_KEY, BUILDER_SET_PAGE_KEY, BUILDER_SET_REGION_KEY, BUILDER_SET_SIZE_KEY, BUILDER_DETACH_KEY, BUILDER_REORDER_KEY, type BuilderRegion, type BuilderNodeSize, type BuilderDetachPayload, type BuilderReorderPayload, type BuilderSnapPreview } from '~/utils/builder-keys'
import type { BuilderPage } from '~~/layers/builder/collections/pages/types'

const blockNode = markRaw(BuilderBlockNode)

// Require auth — same reason as the site page: no session → no team → a stuck board.
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const pageId = computed(() => String(route.params.pageId))

const { items: pages } = await useCollectionQuery('builderPages')
const page = computed(() => (pages.value as BuilderPage[]).find(p => p.id === pageId.value) ?? null)
useHead({ title: () => `Builder · ${page.value?.title ?? 'Page'}` })

// ── The board = Vue Flow rows (ephemeral). Exactly one node is "the page" (isPage). ──
interface FlowNode {
  id: string
  type: string
  position: { x: number, y: number }
  data: { node: LayoutNode, label?: string, bp?: LayoutBreakpoint[], isPage?: boolean, justAdded?: boolean, region?: BuilderRegion, width?: number, height?: number }
}
const nodes = ref<FlowNode[]>([])
let seq = 0

// CroutonFlow exposes fitView / fitBounds / setCenter via ref (deterministic camera).
const flowRef = ref<{
  fitBounds?: (b: { x: number, y: number, width: number, height: number }, o?: Record<string, unknown>) => void
  fitView?: (o?: Record<string, unknown>) => void
} | null>(null)

// The palette = the app's REAL registered blocks (mirrors app.config's croutonLayoutBlocks).
const drawer = [
  { blockId: 'artists-list', label: 'Artists · List', icon: 'i-lucide-list', collection: 'builderArtists', heading: 'Artists' },
  { blockId: 'artists-form', label: 'Artists · New', icon: 'i-lucide-square-pen', collection: 'builderArtists', heading: 'New artist' },
  { blockId: 'artists-stats', label: 'Artists · Stats', icon: 'i-lucide-gauge', collection: 'builderArtists', heading: 'Artists' },
  { blockId: 'bookings-list', label: 'Bookings · List', icon: 'i-lucide-list', collection: 'builderBookings', heading: 'Bookings' },
  { blockId: 'app-toolbar', label: 'Top bar', icon: 'i-lucide-panel-top' },
  { blockId: 'app-nav', label: 'Bottom nav', icon: 'i-lucide-panel-bottom' },
  { blockId: 'spacer', label: 'Spacer', icon: 'i-lucide-square-dashed' },
]
type DrawerItem = (typeof drawer)[number]

// A starter arrangement over the REAL collections, so a fresh page opens laid-out.
function starterRoot(): LayoutNode {
  return {
    type: 'split',
    direction: 'horizontal',
    children: [
      { type: 'leaf', blockId: 'artists-list', config: { collection: 'builderArtists', heading: 'Artists', layout: 'list' } },
      { type: 'leaf', blockId: 'artists-form', config: { collection: 'builderArtists', heading: 'New artist' } },
    ],
  }
}

// Seed the board ONCE per page (open / pageId change) — never on a collection refetch,
// so a save (which refetches builderPages) can't re-seed and loop the board.
const loadedFor = ref<string | null>(null)
const ready = ref(false)
watch(
  [page, pageId] as const,
  ([p, id]) => {
    if (!p || loadedFor.value === id) return
    const stored = (p.board as Record<string, unknown> | null)?.layout
    const parsed = typeof stored === 'string' ? parseLayoutTree(stored) : null
    nodes.value = [{
      id: `page-${id}`,
      type: 'default',
      position: { x: 80, y: 80 },
      data: { node: parsed?.root ?? starterRoot(), label: p.title, bp: parsed?.breakpoints, isPage: true },
    }]
    loadedFor.value = id
    ready.value = true
    fitPage()
  },
  { immediate: true },
)

const pageNode = computed(() => nodes.value.find(n => n.data.isPage) ?? null)

// floor-readout hook — the page's derived floor (folded bottom-up over the block registry).
const { blocks } = useCroutonLayoutBlocks()
const derived = computed(() => (pageNode.value ? deriveSizing(pageNode.value.data.node, blocks.value) : null))

// enter-page-fit — frame the page node on entry. The flow measures async on a fresh mount,
// so retry across a few frames until fitBounds lands on the real geometry.
function fitPage() {
  if (!import.meta.client) return
  const fit = () => {
    const p = pageNode.value
    if (p && flowRef.value?.fitBounds) {
      const s = sizeOf(p.data.node)
      flowRef.value.fitBounds({ x: p.position.x, y: p.position.y, width: s.width, height: s.height }, { duration: 0, padding: 0.18 })
    }
    else { flowRef.value?.fitView?.({ duration: 0, padding: 0.2, maxZoom: 1 }) }
  }
  nextTick(fit)
  for (const d of [40, 120, 300]) window.setTimeout(fit, d)
}

// add-block-land — a clear spot to the RIGHT of every node (never under one).
// Measure neighbours with `effSize` (the per-element-resized/expanded on-screen size),
// NOT the intrinsic `sizeOf` footprint — else a new block lands *behind* a card that was
// resized wider than its footprint (spec: `page-model-one-node`, IMG feedback 2026-07).
function clearSpot(): { x: number, y: number } {
  if (!nodes.value.length) return { x: 80, y: 80 }
  let maxRight = -Infinity, topY = Infinity
  for (const n of nodes.value) {
    const s = effSize(n)
    maxRight = Math.max(maxRight, n.position.x + s.width)
    topY = Math.min(topY, n.position.y)
  }
  return { x: Math.round(maxRight + 100), y: Math.round(topY) }
}

let justAddedTimer: number | null = null
function landNode(item: DrawerItem, position: { x: number, y: number }) {
  dirty.value = true
  const leaf: LayoutNode = {
    type: 'leaf',
    blockId: item.blockId,
    config: item.collection ? { collection: item.collection, heading: item.heading } : {},
  }
  const added: FlowNode = { id: `block-${++seq}`, type: 'default', position, data: { node: leaf, label: item.label, justAdded: true } }
  nodes.value = [...nodes.value.map(n => (n.data.justAdded ? { ...n, data: { ...n.data, justAdded: false } } : n)), added]
  if (justAddedTimer != null) window.clearTimeout(justAddedTimer)
  justAddedTimer = window.setTimeout(() => {
    nodes.value = nodes.value.map(n => (n.id === added.id ? { ...n, data: { ...n.data, justAdded: false } } : n))
  }, 2400)
  // Frame the new block so it's never hidden behind an existing layout.
  const s = sizeOf(leaf)
  const margin = Math.max(s.width, s.height) * 0.9
  nextTick(() => flowRef.value?.fitBounds?.(
    { x: position.x - margin, y: position.y - margin, width: s.width + margin * 2, height: s.height + margin * 2 },
    { duration: 350, padding: 0.1 },
  ))
}

// HTML5 drag source (desktop) — stamp the payload CroutonFlow's drop handler reads.
function onDragStart(e: DragEvent, item: DrawerItem) {
  e.dataTransfer?.setData('application/json', JSON.stringify({
    type: 'crouton-item',
    collection: item.collection ?? 'builder',
    item: { id: `${item.blockId}-${++seq}`, ...item },
  }))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
// CroutonFlow emits this on drop with the flow-space position.
function onNodeDrop(item: Record<string, unknown>, position: { x: number, y: number }) {
  const found = drawer.find(d => d.blockId === item.blockId) ?? { blockId: String(item.blockId), label: String(item.label ?? item.blockId) }
  landNode(found as DrawerItem, position)
}
// Tap-to-add (mobile — HTML5 drag doesn't fire on touch): lands in a clear spot, drawer stays open.
const toast = useToast()
function addBlock(item: DrawerItem) {
  landNode(item, clearSpot())
  toast.add({ title: `Added ${item.label}`, icon: 'i-lucide-plus', duration: 1100 })
}

// ── snap-dwell + merge (spec: `snap-dwell-arm`) ─────────────────────────────────
// Drag a card near another's edge → soft guide; hold ~600ms → armed (green); release while
// armed → the two merge into a split. The board owns the live preview + the dwell timer; the
// target card lights its edge (BuilderBlockNode reads `snapPreview` by object identity of its
// node). The merge is the graduated `dropNode`; the geometry is the graduated `snapEdge`.
const SNAP_DWELL_MS = 600
const SNAP_OPTS = { gap: 160, align: 0.25 }
const PANE_DROP_MIN = 0.35 // ≥35% of the dragged card over a composed target → drop-beside-pane
const snapPreview = shallowRef<BuilderSnapPreview | null>(null)
provide(BUILDER_SNAP_KEY, snapPreview)

// page-regions-pin (spec: `page-regions-pin`) — pin/unpin a node to the page's top/bottom edge.
// Bounded enum on the FlowNode data; the assembled sticky-bar page render is the app's real page
// route (a follow-up) — the board carries the pin state + the region-pill hook.
function setRegion(node: LayoutNode, region: BuilderRegion | null) {
  nodes.value = nodes.value.map(n => (n.data.node === node ? { ...n, data: { ...n.data, region: region ?? undefined } } : n))
  dirty.value = true
}
provide(BUILDER_SET_REGION_KEY, setRegion)

// page-model-one-node — mark a card as THE page (the ★-badged live layout a visitor sees), clearing
// the flag on every other card so exactly one is the page. Save serialises whichever node is the page.
function setPage(node: LayoutNode) {
  nodes.value = nodes.value.map(n => ({ ...n, data: { ...n.data, isPage: n.data.node === node } }))
  dirty.value = true
}
provide(BUILDER_SET_PAGE_KEY, setPage)

// per-element-resize — write a card's explicit display width/height (null clears to footprint).
function setNodeSize(node: LayoutNode, size: BuilderNodeSize) {
  nodes.value = nodes.value.map(n => (n.data.node === node
    ? { ...n, data: { ...n.data, width: size.width ?? undefined, height: size.width === null ? undefined : (size.height ?? n.data.height) } }
    : n))
  dirty.value = true
}
provide(BUILDER_SET_SIZE_KEY, setNodeSize)

// detach-reorder — reorder a composed card's top-level panes, or pull one out into its own card.
function onReorder(group: LayoutNode, { from, to }: BuilderReorderPayload) {
  const next = moveChild(group, [], from, to)
  nodes.value = nodes.value.map(n => (n.data.node === group ? { ...n, data: { ...n.data, node: next } } : n))
  dirty.value = true
}
function onDetach(group: LayoutNode, { index, dropOffset }: BuilderDetachPayload) {
  const host = nodes.value.find(n => n.data.node === group)
  if (!host) return
  const { root, detached } = detachNode(group, [index])
  if (!detached) return
  const freed: FlowNode = {
    id: `block-${++seq}`,
    type: 'default',
    position: { x: Math.round(host.position.x + dropOffset.x), y: Math.round(host.position.y + dropOffset.y) },
    data: { node: detached, justAdded: true },
  }
  const kept = nodes.value
    .map(n => (n.data.node === group ? (root ? { ...n, data: { ...n.data, node: root } } : null) : n))
    .filter(Boolean) as FlowNode[]
  nodes.value = [...kept, freed]
  dirty.value = true
}
provide(BUILDER_DETACH_KEY, onDetach)
provide(BUILDER_REORDER_KEY, onReorder)

let snapKey: string | null = null
let snapTimer: number | null = null
let draggedId: string | null = null

function clearSnapTimer() { if (snapTimer != null) { window.clearTimeout(snapTimer); snapTimer = null } }
function resetSnap() { clearSnapTimer(); snapKey = null; snapPreview.value = null }

// EFFECTIVE on-screen size — the per-element-resize (`data.width`/`data.height`, set by the corner
// handle) WINS over the intrinsic footprint (`sizeOf`). Snap/pane-drop geometry must use this: after
// you resize a card, its real bounds are the resized ones, so computing snaps from `sizeOf` targeted
// the ORIGINAL size — the green connect indicator showed up where the card used to be (IMG_1337).
function effSize(n: FlowNode) {
  const s = sizeOf(n.data.node)
  return { width: n.data.width ?? s.width, height: n.data.height ?? s.height }
}
function rectOf(n: FlowNode) {
  const s = effSize(n)
  return { x: n.position.x, y: n.position.y, width: s.width, height: s.height }
}

// Live drag (CroutonFlow @node-drag, throttled ~50ms): find the nearest snap edge and (re)arm
// the dwell. The arm timer is keyed on target+edge, so brushing between edges doesn't reset it,
// and a still finger still arms (the timer fires even when no drag events do).
function onNodeDrag(id: string, pos: { x: number, y: number }) {
  draggedId = id
  const moved = nodes.value.find(n => n.id === id)
  if (!moved) { resetSnap(); return }
  const drag = { x: pos.x, y: pos.y, ...effSize(moved) }
  const dcx = drag.x + drag.width / 2
  const dcy = drag.y + drag.height / 2

  type Cand = { target: FlowNode, edge: BuilderSnapPreview['edge'], key: string, paneDrop?: BuilderSnapPreview['paneDrop'] }
  let cand: Cand | null = null

  // 1) pane-drop (spec: `pane-drop-beside`) — over a COMPOSED target by ≥35% → land beside the
  //    pane under the cursor (flatten into the row/column, or wrap it perpendicular — applyPaneDrop).
  let bestOverlap = 0, overTarget: FlowNode | null = null
  for (const n of nodes.value) {
    if (n.id === id || n.data.node.type !== 'split') continue
    const frac = rectsOverlapFrac(drag, { x: n.position.x, y: n.position.y, ...effSize(n) })
    if (frac >= PANE_DROP_MIN && frac > bestOverlap) { bestOverlap = frac; overTarget = n }
  }
  if (overTarget) {
    const box = { left: overTarget.position.x, top: overTarget.position.y, ...effSize(overTarget) }
    const leaves = collectLeaves(overTarget.data.node, box)
    const cx = Math.max(box.left, Math.min(box.left + box.width, dcx))
    const cy = Math.max(box.top, Math.min(box.top + box.height, dcy))
    const hit = leaves.find(l => cx >= l.rect.left && cx <= l.rect.left + l.rect.width && cy >= l.rect.top && cy <= l.rect.top + l.rect.height) ?? leaves[0]
    if (hit) {
      const rx = (cx - hit.rect.left) / hit.rect.width - 0.5
      const ry = (cy - hit.rect.top) / hit.rect.height - 0.5
      const edge: BuilderSnapPreview['edge'] = Math.abs(rx) >= Math.abs(ry) ? (rx >= 0 ? 'right' : 'left') : (ry >= 0 ? 'bottom' : 'top')
      const fr = { left: (hit.rect.left - box.left) / box.width, top: (hit.rect.top - box.top) / box.height, width: hit.rect.width / box.width, height: hit.rect.height / box.height }
      cand = { target: overTarget, edge, key: `pane:${overTarget.id}:${hit.path.join('.')}`, paneDrop: { path: hit.path, edge, rect: fr } }
    }
  }

  // 2) else edge-snap onto a nearby card (the two-loose-cards merge).
  if (!cand) {
    let best: { node: FlowNode, edge: BuilderSnapPreview['edge'], gap: number } | null = null
    for (const n of nodes.value) {
      if (n.id === id) continue
      const r = snapEdge(drag, rectOf(n), SNAP_OPTS)
      if (r && (!best || r.gap < best.gap)) best = { node: n, edge: r.edge, gap: r.gap }
    }
    if (best) cand = { target: best.node, edge: best.edge, key: `${best.node.id}:${best.edge}` }
  }

  if (!cand) { resetSnap(); return }

  // Shared dwell/arm: keyed on target+pane/edge, so a small jitter that flips the nearest edge
  // doesn't reset the timer; a still finger still arms (the timer fires with no drag events).
  const rec: BuilderSnapPreview = {
    targetId: cand.target.id,
    targetNode: cand.target.data.node,
    edge: cand.edge,
    armed: cand.key === snapKey ? snapPreview.value?.armed === true : false,
    paneDrop: cand.paneDrop,
  }
  if (cand.key === snapKey) { snapPreview.value = rec; return }
  snapKey = cand.key
  clearSnapTimer()
  snapPreview.value = rec
  snapTimer = window.setTimeout(() => {
    const p = snapPreview.value
    if (p) snapPreview.value = { ...p, armed: true }
  }, SNAP_DWELL_MS)
}

// Drag stop — CroutonFlow re-emits the rows with new positions. If a snap was ARMED, merge the
// dragged card onto the target's edge (dropNode → a split, the badge-carrying page consumes);
// else just accept the reposition.
function onRowsUpdate(rowsRaw: Record<string, unknown>[]) {
  const rows = rowsRaw as unknown as FlowNode[]
  const armed = snapPreview.value?.armed ? snapPreview.value : null
  const movedId = draggedId
  resetSnap()
  draggedId = null

  if (armed && movedId && movedId !== armed.targetId) {
    const moved = rows.find(n => n.id === movedId)
    const target = rows.find(n => n.id === armed.targetId)
    if (moved && target) {
      // Over a composed target → drop beside the targeted pane; else merge onto the outer edge.
      const mergedNode = armed.paneDrop
        ? applyPaneDrop(target.data.node, { path: armed.paneDrop.path, edge: armed.paneDrop.edge }, moved.data.node)
        : dropNode(target.data.node, [], moved.data.node, armed.edge)
      const merged: FlowNode = {
        ...target,
        data: { ...target.data, node: mergedNode, isPage: target.data.isPage || moved.data.isPage, justAdded: false },
      }
      nodes.value = rows.filter(n => n.id !== movedId && n.id !== armed.targetId).concat(merged)
      dirty.value = true
      return
    }
  }
  nodes.value = rows
  dirty.value = true
}

// ── focus-edit-view (spec: `focus-edit-view`) — double-click a node → full-screen edit ──
// overlay hosting the graduated breakpoint author. NOT a camera zoom (that raced VF's
// re-measure and framed off-screen). Editing a copy; the board commits only on 'Done'.
const editing = ref<FlowNode | null>(null)
function onNodeDblClick(id: string) {
  editing.value = nodes.value.find(n => n.id === id) ?? null
}
function onFocusSave(tree: LayoutTree) {
  const target = editing.value
  if (target) {
    nodes.value = nodes.value.map(n => (n.id === target.id
      ? { ...n, data: { ...n.data, node: tree.root, bp: tree.breakpoints } }
      : n))
    dirty.value = true
  }
  editing.value = null
}

const paletteOpen = ref(false)

// ── Durable persistence — EXPLICIT Save (never autosave: autosave → refetch → reseed loop). ──
const { update } = useCollectionMutation('builderPages')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
const dirty = ref(false)

async function saveBoard() {
  const p = pageNode.value
  if (!p) return
  const tree: LayoutTree = { renderer: 'panes', root: p.data.node, breakpoints: p.data.bp }
  saveState.value = 'saving'
  try {
    await update(pageId.value, { board: { layout: serializeLayoutTree(tree) } })
    dirty.value = false
    saveState.value = 'saved'
  } catch {
    saveState.value = 'idle'
  }
}
</script>

<template>
  <div class="flex h-[100dvh] flex-col bg-default text-default">
    <header class="flex items-center gap-3 border-b border-default px-4 py-2">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" to="/builder" aria-label="Back to the site flow">
        Pages
      </UButton>

      <UBadge v-if="page" data-handoff="page-badge" color="primary" variant="subtle" size="sm">
        <UIcon name="i-lucide-star" class="size-3" />
        {{ page.title }}
      </UBadge>

      <span
        v-if="derived"
        data-handoff="floor-readout"
        :data-hard-floor="derived.hardMinWidth"
        :data-soft-floor="derived.softMinWidth"
        class="text-xs text-muted"
      >
        <template v-if="derived.softMinWidth > derived.hardMinWidth">
          stacks &lt;{{ derived.softMinWidth }} · floor {{ derived.hardMinWidth }}px
        </template>
        <template v-else>floor {{ derived.hardMinWidth }}px</template>
      </span>

      <div class="ml-auto flex items-center gap-2">
        <span v-if="saveState === 'saved' && !dirty" class="flex items-center gap-1 text-xs text-muted">
          <UIcon name="i-lucide-check" class="size-4 text-primary" /> Saved
        </span>
        <UButton
          size="sm"
          icon="i-lucide-save"
          :color="dirty ? 'primary' : 'neutral'"
          :variant="dirty ? 'solid' : 'ghost'"
          :loading="saveState === 'saving'"
          :disabled="!dirty && saveState !== 'saving'"
          @click="saveBoard"
        >
          Save
        </UButton>
      </div>
    </header>

    <div class="relative min-h-0 flex-1">
      <div v-if="!ready" class="flex h-full items-center justify-center text-sm text-muted">
        Loading board…
      </div>

      <ClientOnly v-else>
        <!-- The candidate canvas — the page + any draft blocks as Vue Flow nodes. -->
        <CroutonFlow
          ref="flowRef"
          :rows="nodes"
          collection="builderPages"
          :fit-view-on-mount="false"
          data-mode="ephemeral"
          :default-node-component="blockNode"
          allow-drop
          :minimap="false"
          @node-drop="onNodeDrop"
          @node-drag="onNodeDrag"
          @update:rows="onRowsUpdate"
          @node-dbl-click="onNodeDblClick"
        />
      </ClientOnly>

      <!-- Top actions pill — add blocks + fit. -->
      <div v-if="ready" class="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-4">
        <div class="pointer-events-auto flex items-center gap-1 rounded-full border border-default/60 bg-elevated/85 p-1.5 shadow-xl backdrop-blur-xl">
          <UButton icon="i-lucide-scan" size="sm" color="neutral" variant="ghost" title="Fit to page" aria-label="Fit" @click="fitPage" />
          <UButton icon="i-lucide-plus" size="sm" color="primary" variant="solid" title="Add blocks" aria-label="Add blocks" @click="paletteOpen = true" />
        </div>
      </div>
    </div>

    <!-- Palette — desktop-draggable + tap-to-add, in a bottom sheet. -->
    <UDrawer v-model:open="paletteOpen" :handle="true" title="Blocks">
      <template #body>
        <div class="p-1 pb-4">
          <p class="px-1 pb-2 text-xs text-muted">Tap a block to add it — or drag it onto the canvas.</p>
          <div class="flex flex-col gap-2">
            <UCard
              v-for="b in drawer"
              :key="b.blockId"
              draggable="true"
              :ui="{ root: 'cursor-pointer transition-colors hover:ring-primary active:scale-[0.99]', body: 'flex items-center gap-2 p-3' }"
              @dragstart="onDragStart($event, b)"
              @click="addBlock(b)"
            >
              <UIcon :name="b.icon" class="size-4 text-primary" />
              <span class="text-sm">{{ b.label }}</span>
              <UIcon name="i-lucide-plus" class="ml-auto size-4 text-muted" />
            </UCard>
          </div>
        </div>
      </template>
    </UDrawer>

    <!-- focus-edit-view — full-screen pane editor over the double-clicked node. -->
    <BuilderFocusShell
      v-if="editing"
      :node="editing.data.node"
      :breakpoints="editing.data.bp"
      :title="editing.data.label"
      @save="onFocusSave"
      @close="editing = null"
    />
  </div>
</template>
