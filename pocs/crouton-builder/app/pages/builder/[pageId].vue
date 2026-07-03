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
import { markRaw } from 'vue'
import type { LayoutNode, LayoutTree, LayoutBreakpoint } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import BuilderBlockNode from '~/components/BuilderBlockNode.vue'
import type { BuilderRegion } from '~/utils/builder-keys'
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
  data: { node: LayoutNode, label?: string, bp?: LayoutBreakpoint[], isPage?: boolean, justAdded?: boolean, region?: BuilderRegion }
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
function clearSpot(): { x: number, y: number } {
  if (!nodes.value.length) return { x: 80, y: 80 }
  let maxRight = -Infinity, topY = Infinity
  for (const n of nodes.value) {
    const s = sizeOf(n.data.node)
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

// Vue Flow re-emits moved rows on drag stop — accept the reposition (slice 1: no snap-merge yet).
function onRowsUpdate(rowsRaw: Record<string, unknown>[]) {
  nodes.value = rowsRaw as unknown as FlowNode[]
  dirty.value = true
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
          @update:rows="onRowsUpdate"
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
  </div>
</template>
