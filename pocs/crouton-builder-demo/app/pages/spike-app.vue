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
import { markRaw, computed } from 'vue'
import { createReusableTemplate } from '@vueuse/core'
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { piecesToTree } from '@fyit/crouton-layout/app/utils/layout-compose-bridge'
import type { ComposePiece } from '@fyit/crouton-layout/app/composables/useCroutonComposeGestures'
import SpikeBlockNode from '~/components/SpikeBlockNode.vue'

useHead({ title: 'Spike · app on Vue Flow' })
const BUILD = 'spike-b · #907 · Snap mode — magnetic compose canvas (WS4 reuse)'

const blockNode = markRaw(SpikeBlockNode)

const { magicArrange } = useSpikeMagic()
const { checkViability } = useCroutonLayoutBlocks()

// Free (Vue Flow free placement) ⇄ Snap (magnetic compose canvas). Non-exclusive: you can
// drop in Free, switch to Snap to bind by hand, and either feeds the same compile/magic.
type CanvasMode = 'free' | 'snap'
const mode = ref<CanvasMode>('free')
const pieces = ref<ComposePiece[]>([])

/** A layout the result slideover can render + let you flip between (magic or positional). */
interface CanvasProposal { id: string, label: string, icon: string, note: string, tree: LayoutTree, viable: boolean }

// Define the palette markup once; render it in the desktop sidebar AND the mobile drawer.
const [DefinePalette, ReusePalette] = createReusableTemplate()

// The drawer = the blocks a collection ("Artists") offers. In the real thing this list
// is derived from the collection; here it's the registered demo blocks.
const drawer = [
  { blockId: 'artists-list', label: 'Artists · List', icon: 'i-lucide-list' },
  { blockId: 'artists-form', label: 'Artists · New', icon: 'i-lucide-square-pen' },
  { blockId: 'artists-stats', label: 'Artists · Stats', icon: 'i-lucide-bar-chart-3' },
]

// Pre-built Vue Flow nodes (CroutonFlow ephemeral mode renders these directly).
interface FlowNode { id: string, type: string, position: { x: number, y: number }, data: { blockId: string, label?: string } }
const nodes = ref<FlowNode[]>([])
let seq = 0

// Mobile palette (bottom sheet) + the compiled-layout slideover open state.
const paletteOpen = ref(false)
const resultOpen = ref(false)

/** HTML5 drag source: stamp the crouton-item payload CroutonFlow's drop handler reads. */
function onDragStart(e: DragEvent, item: { blockId: string, label: string }) {
  e.dataTransfer?.setData('application/json', JSON.stringify({
    type: 'crouton-item',
    collection: 'artists',
    item: { id: `${item.blockId}-${++seq}`, ...item },
  }))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

/** CroutonFlow emits this on drop with the flow-space position — add the node. */
function onNodeDrop(item: Record<string, unknown>, position: { x: number, y: number }) {
  nodes.value = [...nodes.value, {
    id: String(item.id),
    type: 'default',
    position,
    data: { blockId: String(item.blockId), label: String(item.label ?? item.blockId) },
  }]
}

/** Collect every placed block (blockId + heading) under a layout node. */
function flattenLeaves(node: LayoutNode): { blockId: string, label?: string }[] {
  if (node.type === 'leaf') {
    const heading = node.config?.heading
    return [{ blockId: node.blockId, label: typeof heading === 'string' ? heading : undefined }]
  }
  if (node.type === 'split') return node.children.flatMap(flattenLeaves)
  if (node.type === 'nested') return flattenLeaves(node.layout.root)
  return []
}

/** The dropped blocks, from whichever surface is active (Snap may have grouped them). */
function currentBlocks(): { blockId: string, label?: string }[] {
  return mode.value === 'snap'
    ? pieces.value.flatMap(p => flattenLeaves(p.node))
    : nodes.value.map(n => ({ blockId: n.data.blockId, label: n.data.label }))
}
const blockCount = computed(() => currentBlocks().length)

/** Enter Snap mode — seed the compose canvas from the free nodes (relative layout kept). */
function enterSnap() {
  if (mode.value === 'snap') return
  const ns = nodes.value
  if (ns.length) {
    const minX = Math.min(...ns.map(n => n.position.x))
    const minY = Math.min(...ns.map(n => n.position.y))
    pieces.value = ns.map(n => ({
      id: n.id,
      node: { type: 'leaf', blockId: n.data.blockId, config: { collection: 'artists', ...(n.data.label ? { heading: n.data.label } : {}) } },
      x: Math.round(n.position.x - minX) + 24,
      y: Math.round(n.position.y - minY) + 24,
      width: 260,
      height: 184,
      label: n.data.label,
    }))
  }
  mode.value = 'snap'
}
function enterFree() {
  mode.value = 'free'
}

// The proposals the result slideover shows; you flip between them by id.
const proposals = ref<CanvasProposal[]>([])
const selectedId = ref<string>('')
const resultTitle = ref('Layout')
const selected = computed<CanvasProposal | null>(
  () => proposals.value.find(p => p.id === selectedId.value) ?? proposals.value[0] ?? null,
)

/** ✨ Magic v1 (#908) — deterministic arrange + viability-gated archetype proposals. */
function magic() {
  const { proposals: ps, defaultId } = magicArrange(currentBlocks())
  proposals.value = ps
  selectedId.value = defaultId ?? ps[0]?.id ?? ''
  resultTitle.value = '✨ Magic layout'
  paletteOpen.value = false
  resultOpen.value = ps.length > 0
}

// "As placed" — the original spike's dumb positional infer: 1 node → its leaf is the
// root; many → a split whose axis is inferred from how they're laid out (wider spread in
// x ⇒ horizontal), ordered along that axis. Kept beside ✨ Magic as the literal placement.
function inferPositional(ns: FlowNode[]): LayoutTree | null {
  if (!ns.length) return null
  const leaf = (n: FlowNode): LayoutNode => ({ type: 'leaf', blockId: n.data.blockId })
  if (ns.length === 1) return { renderer: 'panes', root: leaf(ns[0]!) }
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a)
  const horizontal = spread(ns.map(n => n.position.x)) >= spread(ns.map(n => n.position.y))
  const ordered = [...ns].sort((a, b) => (horizontal ? a.position.x - b.position.x : a.position.y - b.position.y))
  return {
    renderer: 'panes',
    root: {
      type: 'split',
      direction: horizontal ? 'horizontal' : 'vertical',
      children: ordered.map(n => ({ ...leaf(n), defaultSize: Math.round((100 / ordered.length) * 10) / 10 })),
    },
  }
}
// Compile the current surface into a LayoutTree. Snap → the bound `piecesToTree` (#899);
// Free → the positional infer. Both flow into the SAME slideover (one shared model).
const compileLabel = computed(() => (mode.value === 'snap' ? 'Compile snapped' : 'As placed'))
function compile() {
  const snap = mode.value === 'snap'
  const tree = snap
    ? (pieces.value.length ? piecesToTree(pieces.value) : null)
    : inferPositional(nodes.value)
  if (!tree) { proposals.value = []; return }
  proposals.value = [{
    id: 'positional',
    label: snap ? 'Snapped' : 'As placed',
    icon: snap ? 'i-lucide-magnet' : 'i-lucide-move',
    note: snap ? 'Your snapped arrangement' : 'Exactly where you dropped them',
    tree,
    viable: checkViability(tree, [1280, 768]).viable,
  }]
  selectedId.value = 'positional'
  resultTitle.value = snap ? 'Snapped layout' : 'Compiled layout'
  paletteOpen.value = false
  resultOpen.value = true
}
function reset() {
  nodes.value = []
  pieces.value = []
  proposals.value = []
  selectedId.value = ''
  resultOpen.value = false
}
</script>

<template>
  <div class="flex h-screen flex-col bg-default text-default">
    <!-- Palette markup, defined once and reused in the desktop sidebar + mobile drawer -->
    <DefinePalette>
      <div class="flex flex-col gap-2">
        <UCard
          v-for="b in drawer"
          :key="b.blockId"
          draggable="true"
          :ui="{ root: 'cursor-grab transition-colors hover:ring-primary active:cursor-grabbing', body: 'flex items-center gap-2 p-3 sm:p-3' }"
          @dragstart="onDragStart($event, b)"
        >
          <UIcon :name="b.icon" class="size-4 text-primary" />
          <span class="text-sm">{{ b.label }}</span>
          <UIcon name="i-lucide-grip-vertical" class="ml-auto size-3.5 text-muted" />
        </UCard>
      </div>
      <div class="mt-4 flex flex-col gap-2">
        <UButton size="sm" color="primary" icon="i-lucide-wand-2" :disabled="!blockCount" block @click="magic">✨ Magic arrange</UButton>
        <UButton size="sm" color="neutral" variant="soft" :icon="mode === 'snap' ? 'i-lucide-magnet' : 'i-lucide-move'" :disabled="!blockCount" block @click="compile">{{ compileLabel }}</UButton>
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" block @click="reset">Reset</UButton>
      </div>
    </DefinePalette>

    <header class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-default px-5 py-3">
      <h1 class="text-base font-semibold">Spike · build an app on Vue Flow</h1>
      <p class="hidden text-xs text-muted lg:block">Drop blocks → arrange (Free / Snap) → ✨ Magic or compile. #905</p>
      <div class="ml-auto flex items-center gap-2">
        <!-- Free placement ⇄ magnetic Snap — non-exclusive surfaces over the same blocks (#907) -->
        <div class="flex items-center gap-0.5 rounded-lg border border-default p-0.5">
          <UButton
            size="xs"
            icon="i-lucide-move"
            label="Free"
            :color="mode === 'free' ? 'primary' : 'neutral'"
            :variant="mode === 'free' ? 'soft' : 'ghost'"
            @click="enterFree"
          />
          <UButton
            size="xs"
            icon="i-lucide-magnet"
            label="Snap"
            :color="mode === 'snap' ? 'primary' : 'neutral'"
            :variant="mode === 'snap' ? 'soft' : 'ghost'"
            @click="enterSnap"
          />
        </div>
        <!-- Mobile: open the palette as a bottom sheet (desktop has the persistent sidebar) -->
        <UButton
          class="md:hidden"
          size="xs"
          icon="i-lucide-layout-grid"
          label="Blocks"
          color="neutral"
          variant="soft"
          @click="paletteOpen = true"
        />
        <UButton
          v-if="proposals.length"
          size="xs"
          icon="i-lucide-panel-right-open"
          label="Layout"
          color="neutral"
          variant="soft"
          @click="resultOpen = true"
        />
        <span class="hidden rounded-full border border-default bg-elevated px-2 py-0.5 font-mono text-[10px] text-muted sm:inline">{{ BUILD }}</span>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- Desktop drawer — the collection's blocks, draggable onto the canvas -->
      <aside class="hidden w-56 shrink-0 overflow-y-auto border-r border-default bg-elevated/40 p-3 md:block">
        <p class="mb-2 text-xs uppercase tracking-widest text-muted">Artists · blocks</p>
        <ReusePalette />
      </aside>

      <!-- The canvas — Free (Vue Flow) or Snap (magnetic compose canvas) -->
      <div class="relative min-w-0 flex-1">
        <ClientOnly>
          <!-- Free placement: drag blocks from the drawer, position freely -->
          <CroutonFlow
            v-if="mode === 'free'"
            v-model:rows="nodes"
            collection="artists"
            data-mode="ephemeral"
            :default-node-component="blockNode"
            allow-drop
            :minimap="false"
            @node-drop="onNodeDrop"
          />
          <!-- Snap: the WS4 magnetic compose canvas — drag cards together → bound split (#907) -->
          <div v-else class="absolute inset-0 p-3">
            <CroutonLayoutComposeCanvas v-model="pieces" class="h-full w-full" />
          </div>
        </ClientOnly>

        <!-- Snap hint (when there's something to arrange) -->
        <p
          v-if="mode === 'snap' && pieces.length"
          class="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded-full border border-default bg-elevated/90 px-3 py-1 text-[11px] text-muted backdrop-blur"
        >
          Drag a card beside another → they snap into a split · resize from the corner
        </p>

        <!-- Empty states -->
        <p
          v-if="mode === 'free' && !nodes.length"
          class="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted"
        >
          <span class="hidden md:inline">Drag a block from the drawer onto the canvas →</span>
          <span class="md:hidden">Tap <strong>Blocks</strong> to open the palette.</span>
        </p>
        <p
          v-else-if="mode === 'snap' && !pieces.length"
          class="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted"
        >
          Drop blocks in <strong>Free</strong> mode, then switch back here to snap them together.
        </p>
      </div>
    </div>

    <!-- Mobile palette — a bottom sheet, out of the way until summoned (#906) -->
    <UDrawer v-model:open="paletteOpen" :handle="true" title="Artists · blocks">
      <template #body>
        <div class="p-1 pb-4">
          <ReusePalette />
        </div>
      </template>
    </UDrawer>

    <!-- Result — magic proposals (or the positional compile), in a contextual slideover -->
    <USlideover v-model:open="resultOpen" :title="resultTitle" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="flex h-full flex-col gap-3">
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
  </div>
</template>
