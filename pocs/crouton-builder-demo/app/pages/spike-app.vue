<script setup lang="ts">
/**
 * Spike (#903 → #906 → #908 → #907) — "everything in Vue Flow": build an app by dragging
 * a collection's blocks from a DRAWER onto a canvas, then turn the placement into a real
 * layout. Three non-exclusive paths (a menu, not a mode war):
 *   - ✨ **Magic arrange** (#908) — deterministic composer + viability gate pick a strong
 *     layout and offer 2–3 archetype proposals to flip between (no API cost).
 *   - **Snap** (#907) — the WS4 magnetic compose canvas: drag a card beside another and
 *     they click into a bound split; resize from the corner. The canvas IS the layout.
 *   - **As placed** — the dumb positional infer (the original spike's "Compile").
 *
 *   drawer (Artists' blocks) ──drag──▶ Free (Vue Flow) ⇄ Snap (compose canvas) ──▶ LayoutTree
 *
 * Reuses what already exists: CroutonFlow's drag-drop (`@node-drop`); the layout engine's
 * `composeDefault`/`checkViability` (via `useSpikeMagic`); and for snapping the WS4
 * `CroutonLayoutComposeCanvas` + `piecesToTree` bridge (#873/#899) — so the snapped
 * arrangement yields the SAME `LayoutTree` as the magic/compile paths (one shared model).
 * No backend — the Artists blocks are demo blocks.
 *
 * Responsive shell: the palette is a persistent slim sidebar on desktop (so HTML5
 * drag-drop onto the canvas stays usable) and a toggled `UDrawer` bottom sheet on a
 * phone (out of the way — #906). The result rides in a `USlideover`. The palette markup
 * is defined once with VueUse's `createReusableTemplate` and reused in both places.
 */
import { computed, markRaw } from 'vue'
import { createReusableTemplate } from '@vueuse/core'
import type { ComposePiece } from '@fyit/crouton-layout/app/composables/useCroutonComposeGestures'
import type { CanvasMode, FlowNode, SpikeFlowHandle } from '~/utils/spike-board'
import SpikeBlockNode from '~/components/SpikeBlockNode.vue'
import SpikePageCard from '~/components/SpikePageCard.vue'
import SpecWalkPanel from '~/components/SpecWalkPanel.vue'

useHead({ title: 'Spike · app on Vue Flow' })
// Iteration changelog / decision log (#940, #1048): the version timeline now lives in the shared
// glasses launcher as the @fyit/crouton-feedback "Changelog" tool, fed by `app/spike-changelog.json`
// (wired via `croutonFeedback.changelog` in nuxt.config). No bespoke on-page chip here anymore.

const blockNode = markRaw(SpikeBlockNode)
const spikePageCard = markRaw(SpikePageCard)

// Free (Vue Flow free placement) ⇄ Snap (magnetic compose canvas). Non-exclusive: you can
// drop in Free, switch to Snap to bind by hand, and either feeds the same compile/magic.
const mode = ref<CanvasMode>('free')
const pieces = ref<ComposePiece[]>([])

// Define the palette markup once; render it in the desktop sidebar AND the mobile drawer.
// The `drawer` block list + the demo PAGES/pageRows/pageById live in app/utils/spike-demo-data
// (auto-imported), like spike-page-meta's STATUS_META / VISIBILITY_META / LAYOUT_META.
const [DefinePalette, ReusePalette] = createReusableTemplate()

const nodes = ref<FlowNode[]>([])
let seq = 0
const nextSeq = () => ++seq

// Camera: re-frame the whole board after adding a block. CroutonFlow only fits-to-view on mount
// (when the board is empty), so without this a freshly-added block sits at the default zoom —
// which on a narrow phone fills the screen. The edit view owns the camera, so skip then.
const flowRef = ref<SpikeFlowHandle | null>(null)

// Undo (#940) — ⌘/Ctrl-Z on the board only; snapshots before each mutation; cleared on entering a page.
const { canUndo, pushUndo, undo, clearUndo } = useSpikeUndo(nodes, {
  onRestore: () => { resetSnap(); closeEdit() },
  enabled: () => !!selectedPageId.value,
})

// Live snap guide + dwell-to-arm + the on-release merge/pane-drop (#907/#941/#972).
const { onNodeDragLive, onRowsUpdate, resetSnap } = useSpikeSnapDrag({ nodes, pushUndo })

// Focus EDIT (#907 v2) — double-click a node and its layout zooms up in place (SpikeFocusShell).
const { zoomNodeId, originRect, zoomLabel, editing, editInitialWidth, zoomTree, onNodeDblClick, closeEdit } = useSpikeFocusEdit(nodes, mode)

// Pinch-to-zoom passthrough (#948) + the node callbacks SpikeBlockNode injects (detach, reorder,
// promote-to-page, duplicate, pin-to-region, resize, delete — #907/#942/#952–#955).
useSpikePinch(flowRef, zoomNodeId)
useSpikeNodeOps({ nodes, pushUndo, nextSeq })

// Adding blocks: HTML5 drag source, drop handler, tap-to-add (mobile), and board framing (#906).
const { onDragStart, onNodeDrop, addBlock, fitBoard } = useSpikeBoardAdd({ nodes, flowRef, pushUndo, nextSeq })

// ✨ Magic arrange (+ optional AI tier) and the positional compile, one shared result slideover.
const {
  hasAI, aiIntent, aiLoading, resultSource,
  paletteOpen, resultOpen,
  blockCount,
  proposals, selectedId, resultTitle, selected,
  magic, magicAI, compile, compileLabel, reset,
} = useSpikeProposals({ mode, pieces, nodes, pushUndo })

/** Enter Snap mode — seed the compose canvas from the free nodes (each node's layout + size). */
function enterSnap() {
  if (mode.value === 'snap') return
  const ns = nodes.value
  if (ns.length) {
    const minX = Math.min(...ns.map(n => n.position.x))
    const minY = Math.min(...ns.map(n => n.position.y))
    pieces.value = ns.map((n) => {
      const s = sizeOf(n.data.node)
      return {
        id: n.id,
        node: n.data.node,
        x: Math.round(n.position.x - minX) + 24,
        y: Math.round(n.position.y - minY) + 24,
        width: s.width,
        height: s.height,
        label: n.data.label,
      }
    })
  }
  mode.value = 'snap'
}
function enterFree() {
  mode.value = 'free'
}

// ── Site level (#940, approach B) — a page-flow ON TOP of the spike board ──────
const { selectedPageId, zoomDir, currentPage, currentPageLabel, enterPage, exitToPages } = useSpikePageNav({
  nodes,
  flowRef,
  nextSeq,
  closeEdit,
  isEditing: () => !!zoomNodeId.value,
  resetTransient: () => {
    // clean transient board state for a fresh entry
    mode.value = 'free'
    proposals.value = []
    resultOpen.value = false
    paletteOpen.value = false
    clearUndo() // fresh board context — don't undo across page boundaries
  },
})

const pageHeaderExpanded = ref(false)
// The header's pages-package controls (preview / open-public) are display-only in the POC — on
// graduation they wire to the real crouton-pages actions (this view is just another view of pages).
function mockPageAction(name: string) {
  useToast().add({ title: name, description: 'Mock — wires to the pages package on graduation', icon: 'i-lucide-info', duration: 1500 })
}

// Assemble the page for Preview (#953): pinned nodes become top/bottom bars, the rest is the main flow.
const previewOpen = ref(false)
const topRegionNodes = computed(() => nodes.value.filter(n => n.data.region === 'top'))
const bottomRegionNodes = computed(() => nodes.value.filter(n => n.data.region === 'bottom'))
const mainRegionNodes = computed(() => {
  const main = nodes.value.filter(n => !n.data.region)
  // Prefer the ★ page node as the main content when one is set; else show every un-pinned node.
  const page = main.filter(n => n.data.isPage)
  return page.length ? page : main
})
</script>

<!-- Template unchanged by the #1240 script split (byte-identical); restructuring it into components is the tracked follow-up tail. -->
<!-- fallow-ignore-next-line complexity -->
<template>
  <!-- h-dvh (dynamic viewport height), NOT h-screen/100vh — so the bottom command pill sits above the
       mobile browser toolbar instead of behind it (iOS Safari occludes 100vh's bottom). -->
  <div class="flex h-dvh flex-col bg-default text-default">
    <!-- Palette markup, defined once and reused in the desktop sidebar + mobile drawer -->
    <DefinePalette>
      <div class="flex flex-col gap-2">
        <UCard
          v-for="b in drawer"
          :key="b.blockId"
          draggable="true"
          :ui="{ root: 'cursor-pointer transition-colors hover:ring-primary active:scale-[0.99]', body: 'flex items-center gap-2 p-3 sm:p-3' }"
          @dragstart="onDragStart($event, b)"
          @click="addBlock(b)"
        >
          <UIcon :name="b.icon" class="size-4 text-primary" />
          <span class="text-sm">{{ b.label }}</span>
          <UIcon name="i-lucide-plus" class="ml-auto size-4 text-muted" />
        </UCard>
      </div>
      <div class="mt-4 flex flex-col gap-2">
        <UButton size="sm" color="primary" icon="i-lucide-wand-2" :disabled="!blockCount" block @click="magic">✨ Magic arrange</UButton>
        <!-- AI tier — only shown when the crouton-ai add-on is installed (hasApp('ai'), #909) -->
        <template v-if="hasAI">
          <UInput
            v-model="aiIntent"
            size="sm"
            icon="i-lucide-message-square-text"
            placeholder="Describe the app (optional)"
            :disabled="!blockCount"
          />
          <UButton size="sm" color="primary" variant="soft" icon="i-lucide-sparkles" :loading="aiLoading" :disabled="!blockCount" block @click="magicAI">✨ Magic (AI)</UButton>
        </template>
        <UButton size="sm" color="neutral" variant="soft" :icon="mode === 'snap' ? 'i-lucide-magnet' : 'i-lucide-move'" :disabled="!blockCount" block @click="compile">{{ compileLabel }}</UButton>
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" block @click="reset">Reset</UButton>
      </div>
    </DefinePalette>

    <!-- Old app-chrome header removed (#940): the page-shell header below IS the header now (back
         button folded in), and the Site view is full-bleed. The BUILD stamp floats as a tiny chip. -->

    <!-- Page ⇄ Site cross-fade (#940 redux): both views stacked absolutely so one fades IN while the
         other fades OUT (simultaneous — NOT mode=out-in, which flashed the dark bg between them and
         delayed the board's mount so the fit missed). A subtle directional scale reads as a gentle
         zoom in (open a page) / out (back to the flow). The board still mounts immediately, so fitPage works. -->
    <div class="relative flex min-h-0 flex-1 overflow-hidden">
    <Transition :name="zoomDir === 'in' ? 'viewzoom-in' : 'viewzoom-out'">
    <div v-if="selectedPageId" key="board" class="absolute inset-0 flex">
      <!-- Desktop drawer — the collection's blocks, draggable onto the canvas -->
      <aside class="hidden w-56 shrink-0 overflow-y-auto border-r border-default bg-elevated/40 p-3 md:block">
        <p class="mb-2 text-xs uppercase tracking-widest text-muted">Artists · blocks</p>
        <ReusePalette />
      </aside>

      <!-- The canvas — Free (Vue Flow) or Snap (magnetic compose canvas) -->
      <!-- Page shell (#940): entering a page frames the flow INSIDE a padded container whose header
           carries the page identity — icon + name, expandable to path / visibility / live-vs-draft
           (mirrors the pages package). The header slides in as the container forms (the transition). -->
      <div class="relative min-w-0 flex-1 p-2 sm:p-3">
       <div class="flex h-full flex-col overflow-hidden rounded-xl border border-default bg-elevated/40 shadow-sm">
        <!-- Mirrors CroutonPagesEditorToolbar — status (dot+label) · visibility (icon+label) · preview
             · open-public · settings gear. Display-only here; reuses the real toolbar on graduation. -->
        <header class="spike-page-header shrink-0 border-b border-default/70 bg-elevated/60 px-3 py-2 backdrop-blur">
          <div class="flex items-center gap-2.5">
            <UButton
              icon="i-lucide-arrow-left"
              size="xs"
              color="neutral"
              variant="ghost"
              aria-label="Back to pages"
              title="Back to pages"
              @click="exitToPages"
            />
            <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <UIcon :name="currentPage?.icon ?? 'i-lucide-file'" class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold leading-tight">{{ currentPage?.label ?? 'Page' }}</p>
              <p v-if="currentPage?.path" class="hidden truncate font-mono text-[10px] leading-tight text-muted sm:block">{{ currentPage.path }}</p>
            </div>

            <div class="ml-auto flex items-center gap-0.5">
              <!-- status: colored dot + label -->
              <span v-if="currentPage?.status" class="flex items-center gap-1.5 px-1.5 text-[11px] font-medium" :class="STATUS_META[currentPage.status].text">
                <span class="size-2 rounded-full" :class="STATUS_META[currentPage.status].dot" />
                <span class="hidden sm:inline">{{ STATUS_META[currentPage.status].label }}</span>
              </span>
              <!-- visibility: icon + label -->
              <span v-if="currentPage?.visibility" class="flex items-center gap-1.5 px-1.5 text-[11px] text-muted">
                <UIcon :name="VISIBILITY_META[currentPage.visibility].icon" class="size-4" />
                <span class="hidden sm:inline">{{ VISIBILITY_META[currentPage.visibility].label }}</span>
              </span>
              <USeparator orientation="vertical" class="mx-1 hidden h-5 sm:block" />
              <UButton icon="i-lucide-eye" size="xs" color="neutral" variant="ghost" class="hidden sm:inline-flex" aria-label="Preview" @click="mockPageAction('Preview')" />
              <UButton icon="i-lucide-external-link" size="xs" color="neutral" variant="ghost" class="hidden sm:inline-flex" :disabled="currentPage?.status !== 'published'" aria-label="Open public page" @click="mockPageAction('Open public page')" />
              <UButton
                :icon="pageHeaderExpanded ? 'i-lucide-chevron-up' : 'i-lucide-settings'"
                size="xs"
                :color="pageHeaderExpanded ? 'primary' : 'neutral'"
                :variant="pageHeaderExpanded ? 'soft' : 'ghost'"
                aria-label="Page settings"
                @click="pageHeaderExpanded = !pageHeaderExpanded"
              />
            </div>
          </div>
          <!-- Settings detail (mirrors SettingsPanel fields, read-only mock): path · visibility · layout · nav -->
          <div
            v-if="pageHeaderExpanded"
            class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-default/60 pt-2 text-[11px] text-muted sm:grid-cols-4"
          >
            <div class="flex items-center gap-1.5">
              <UIcon name="i-lucide-link" class="size-3.5 shrink-0" /><span class="truncate font-mono">{{ currentPage?.path ?? '—' }}</span>
            </div>
            <div v-if="currentPage?.visibility" class="flex items-center gap-1.5">
              <UIcon :name="VISIBILITY_META[currentPage.visibility].icon" class="size-3.5 shrink-0" />{{ VISIBILITY_META[currentPage.visibility].label }}
            </div>
            <div v-if="currentPage?.layout" class="flex items-center gap-1.5">
              <UIcon :name="LAYOUT_META[currentPage.layout].icon" class="size-3.5 shrink-0" />{{ LAYOUT_META[currentPage.layout].label }}
            </div>
            <div class="flex items-center gap-1.5">
              <UIcon :name="currentPage?.showInNavigation ? 'i-lucide-eye' : 'i-lucide-eye-off'" class="size-3.5 shrink-0" />{{ currentPage?.showInNavigation ? 'In navigation' : 'Hidden from nav' }}
            </div>
          </div>
        </header>
        <!-- The flow itself lives inside the container. `spike-board-canvas` scopes the CSS that hides
             Vue Flow's own ⛶ fitView button HERE — it measures the small `.vue-flow__node` wrapper and
             zooms INTO our oversized cards; our pill Fit (fitBounds) is the correct one. The Site
             flow's normal-sized cards are fine, so its ⛶ stays. (#975) -->
        <div class="spike-board-canvas relative min-h-0 flex-1">
        <ClientOnly>
          <!-- Free placement: drag blocks from the drawer, position freely -->
          <CroutonFlow
            v-if="mode === 'free'"
            ref="flowRef"
            :rows="nodes"
            collection="artists"
            :fit-view-on-mount="false"
            data-mode="ephemeral"
            :default-node-component="blockNode"
            :draggable="!editing"
            allow-drop
            :minimap="false"
            @node-drop="onNodeDrop"
            @node-drag="onNodeDragLive"
            @node-dbl-click="onNodeDblClick"
            @update:rows="onRowsUpdate"
          />
          <!-- Snap: the WS4 magnetic compose canvas — drag cards together → bound split (#907) -->
          <div v-else class="absolute inset-0 p-3">
            <CroutonLayoutComposeCanvas v-model="pieces" class="h-full w-full" />
          </div>
        </ClientOnly>

        <!-- Top actions pill (#951) — icon-only quick actions, floating top-centre of the canvas. -->
        <div
          v-if="mode === 'free' && !editing"
          class="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-4"
        >
          <div class="pointer-events-auto flex items-center gap-1 rounded-full border border-default/60 bg-elevated/85 p-1.5 shadow-xl backdrop-blur-xl">
            <UButton icon="i-lucide-undo-2" size="sm" color="neutral" variant="ghost" :disabled="!canUndo" title="Undo (⌘Z)" aria-label="Undo" @click="undo" />
            <UButton icon="i-lucide-scan" size="sm" color="neutral" variant="ghost" title="Zoom to fit" aria-label="Fit" @click="fitBoard" />
            <UButton icon="i-lucide-plus" size="sm" color="neutral" variant="ghost" title="Add blocks" aria-label="Add blocks" @click="paletteOpen = true" />
            <UButton :icon="hasAI ? 'i-lucide-sparkles' : 'i-lucide-wand-2'" size="sm" color="primary" variant="solid" :disabled="!blockCount" title="Magic arrange" aria-label="Magic" @click="magic" />
            <!-- Preview the assembled page (#953) — pinned regions as pills, the rest as scrolling main. -->
            <UButton icon="i-lucide-play" size="sm" color="neutral" variant="ghost" :disabled="!nodes.length" title="Preview page" aria-label="Preview page" @click="previewOpen = true" />
            <UButton v-if="proposals.length" icon="i-lucide-panel-top-open" size="sm" color="neutral" variant="ghost" aria-label="Show layout result" @click="resultOpen = true" />
          </div>
        </div>

        <!-- (#954) The global responsive slider is gone — responsiveness is now per-element: drag a
             card's resize handle to preview its layout at that width. Fit moved into the top pill. -->

        <!-- Snap hints (when there's something to arrange) -->
        <p
          v-if="mode === 'free' && nodes.length >= 2"
          class="pointer-events-none absolute inset-x-0 top-16 mx-auto w-fit rounded-full border border-default bg-elevated/90 px-3 py-1 text-[11px] text-muted backdrop-blur"
        >
          Drag a block next to another → they snap together · then ✨ Magic or compile · double-click to edit
        </p>
        <p
          v-else-if="mode === 'snap' && pieces.length"
          class="pointer-events-none absolute inset-x-0 top-16 mx-auto w-fit rounded-full border border-default bg-elevated/90 px-3 py-1 text-[11px] text-muted backdrop-blur"
        >
          Drag a card beside another → they snap into a split · resize from the corner
        </p>

        <!-- Empty states -->
        <p
          v-if="mode === 'free' && !nodes.length"
          class="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted"
        >
          <span class="hidden md:inline">Tap (or drag) a block from the drawer onto the canvas →</span>
          <span class="md:hidden">Tap <strong>Blocks</strong>, then tap a block to add it.</span>
        </p>
        <p
          v-else-if="mode === 'snap' && !pieces.length"
          class="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted"
        >
          Drop blocks in <strong>Free</strong> mode, then switch back here to snap them together.
        </p>
        </div>
       </div>
      </div>
    </div>

    <!-- Site level (#940) — the page flow. Cards = pages (lines = parentId); double-click /
         ⤡ a card → enterPage() loads that page's layout into the spike board above. -->
    <div v-else key="site" class="absolute inset-0">
      <ClientOnly>
        <!-- Site flow built on CroutonFlow directly (not the CroutonFlowSiteFlow preset) so we can
             inject our richer POC page card (SpikePageCard) — the condensed page with its settings
             icons — via `defaultNodeComponent`. We provide the same `croutonSiteFlowZoom` contract
             the card injects, pointing it at enterPage. (#940) -->
        <CroutonFlow
          :rows="pageRows"
          collection="pagesPages"
          label-field="label"
          parent-field="parentId"
          :default-node-component="spikePageCard"
          background-pattern="dots"
          @node-dbl-click="(id: string) => enterPage(String(id))"
        />
      </ClientOnly>
    </div>
    </Transition>
    </div>

    <!-- Mobile palette — a bottom sheet, out of the way until summoned (#906) -->
    <UDrawer v-model:open="paletteOpen" :handle="true" title="Artists · blocks">
      <template #body>
        <div class="p-1 pb-4">
          <p class="px-1 pb-2 text-xs text-muted">Tap a block to add it to the canvas — then ✨ Magic or compile.</p>
          <ReusePalette />
        </div>
      </template>
    </UDrawer>

    <!-- Result — magic proposals (or the positional compile), in a contextual slideover -->
    <USlideover v-model:open="resultOpen" :title="resultTitle" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="flex h-full flex-col gap-3">
          <!-- Source badge — AI-ranked (#909) or the deterministic fallback when AI is off/unavailable -->
          <div v-if="resultSource !== 'deterministic'" class="flex items-center gap-2">
            <UBadge
              v-if="resultSource === 'ai'"
              color="primary"
              variant="subtle"
              size="sm"
              icon="i-lucide-sparkles"
            >AI ranked</UBadge>
            <UBadge
              v-else
              color="neutral"
              variant="subtle"
              size="sm"
              icon="i-lucide-cpu"
            >deterministic fallback</UBadge>
            <span v-if="resultSource === 'fallback'" class="text-xs text-muted">AI unavailable — used the viability composer</span>
          </div>
          <!-- Flip between archetype proposals (#908) -->
          <div v-if="proposals.length > 1" class="flex flex-wrap gap-1.5">
            <UButton
              v-for="p in proposals"
              :key="p.id"
              :icon="p.icon"
              :label="p.label"
              size="xs"
              :color="p.id === selectedId ? 'primary' : 'neutral'"
              :variant="p.id === selectedId ? 'soft' : 'ghost'"
              @click="selectedId = p.id"
            />
          </div>
          <div v-if="selected" class="flex items-center gap-2 text-xs text-muted">
            <span>{{ selected.note }}</span>
            <UBadge
              v-if="selected.viable"
              color="success"
              variant="subtle"
              size="sm"
              icon="i-lucide-check"
            >viable</UBadge>
            <UBadge
              v-else
              color="warning"
              variant="subtle"
              size="sm"
              icon="i-lucide-alert-triangle"
            >tight fit</UBadge>
          </div>
          <div class="min-h-0 flex-1 overflow-hidden rounded-xl border border-default">
            <CroutonLayoutRenderer
              v-if="selected"
              :key="selected.id"
              :node="selected.tree.root"
            />
          </div>
        </div>
      </template>
    </USlideover>

    <!-- Focus EDIT (#907 v2) — the layout ZOOMS UP in place via SpikeFocusShell: a shared-element
         transition from the node's rect to centre (no Vue Flow camera), the board falls away behind a
         blurred scrim, and a minimal control shell hugs the layout (key-points pop · device + width
         pill · collapse motion / variants behind "⋯"). Persists via the same `zoomTree` v-model. -->
    <SpikeFocusShell
      v-if="editing"
      v-model="zoomTree"
      :label="zoomLabel"
      :origin-rect="originRect"
      :initial-width="editInitialWidth"
      @close="closeEdit"
    />

    <!-- Page Preview (#953) — assemble the regions into a running page (pinned pills + scrolling main). -->
    <SpikePagePreview
      v-if="previewOpen"
      :top="topRegionNodes"
      :main="mainRegionNodes"
      :bottom="bottomRegionNodes"
      :label="currentPage?.label ?? currentPageLabel"
      @close="previewOpen = false"
    />

    <!-- Reconcile/verify walk (#1039) — mounted here (not app.vue) because the page reliably
         renders; opened from the feedback launcher's "Spec walk" tool. -->
    <SpecWalkPanel />
  </div>
</template>

<style scoped>
/* Move Vue Flow's zoom controls (+/−/fit) from the default bottom-left to the TOP-RIGHT corner of
   the canvas (#940) — clear of the bottom command pill and the floating version chip. :deep reaches
   into CroutonFlow. Applies to both the board and the Site flow. */
:deep(.vue-flow__controls) {
  top: 0.5rem;
  right: 0.5rem;
  bottom: auto;
  left: auto;
}

/* Hide Vue Flow's ⛶ fitView button on the BOARD only (#975) — VF's fitView measures the small
   `.vue-flow__node` wrapper and zooms into our oversized cards; the pill Fit (fitBounds) is correct.
   The Site flow keeps its ⛶ (normal-sized cards frame fine). Keeps the +/− zoom buttons. */
.spike-board-canvas :deep(.vue-flow__controls-fitview) {
  display: none;
}

/* Page ⇄ Site cross-fade (#940): both views absolute + overlapping, so enter and leave run at the
   SAME time (no bg flash). Subtle directional scale = a gentle zoom. Opacity is a touch faster than
   the transform so the outgoing view is mostly gone before its scale finishes (clean hand-off). */
.viewzoom-in-enter-active, .viewzoom-in-leave-active,
.viewzoom-out-enter-active, .viewzoom-out-leave-active {
  transition: opacity 0.26s ease, transform 0.34s cubic-bezier(0.4, 0, 0.2, 1);
  transform-origin: center;
  will-change: opacity, transform;
}
.viewzoom-in-enter-from { opacity: 0; transform: scale(0.97); }   /* page grows in */
.viewzoom-in-leave-to { opacity: 0; transform: scale(1.03); }     /* site recedes forward */
.viewzoom-out-enter-from { opacity: 0; transform: scale(1.03); }  /* site settles back from larger */
.viewzoom-out-leave-to { opacity: 0; transform: scale(0.97); }    /* page shrinks away */
@media (prefers-reduced-motion: reduce) {
  .viewzoom-in-enter-active, .viewzoom-in-leave-active,
  .viewzoom-out-enter-active, .viewzoom-out-leave-active { transition: opacity 0.2s ease; transform: none; }
  .viewzoom-in-enter-from, .viewzoom-in-leave-to,
  .viewzoom-out-enter-from, .viewzoom-out-leave-to { transform: none; }
}

/* Page-shell header (#940): on entering a page the identity bar slides down into place as the
   container forms — the "name slides to the top" feel. Runs on mount (the board is re-created each
   entry), so it replays every time you open a page. */
@media (prefers-reduced-motion: no-preference) {
  @keyframes spike-header-in {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .spike-page-header { animation: spike-header-in 0.34s cubic-bezier(0.4, 0, 0.2, 1) both; }
}
</style>
