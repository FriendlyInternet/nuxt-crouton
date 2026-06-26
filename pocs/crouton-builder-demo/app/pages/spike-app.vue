<script setup lang="ts">
/**
 * Spike (#903 → #906) — "everything in Vue Flow": build an app by dragging a
 * collection's blocks from a DRAWER onto a Vue Flow canvas, then COMPILE the placement
 * into a real layout (fork A). Sub-issue A (#906) re-skins the hand-rolled spike onto
 * proper Nuxt UI 4 components and makes the drawer out-of-the-way on a phone.
 *
 *   drawer (Artists' blocks) ──drag──▶ CroutonFlow (ephemeral) ──compile──▶ LayoutTree
 *
 * Reuses what already exists: CroutonFlow's drag-drop (`@node-drop`) and the WS8
 * pieces↔tree bridge (`piecesToTree`). No backend — the Artists blocks are demo blocks.
 *
 * Responsive shell: the palette is a persistent slim sidebar on desktop (so HTML5
 * drag-drop onto the canvas stays usable) and a toggled `UDrawer` bottom sheet on a
 * phone (out of the way — fork A; touch drag / snapping is epic #905 sub-issue B). The
 * compiled result rides in a `USlideover`. The palette markup is defined once with
 * VueUse's `createReusableTemplate` and reused in both places.
 */
import { markRaw } from 'vue'
import { createReusableTemplate } from '@vueuse/core'
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import SpikeBlockNode from '~/components/SpikeBlockNode.vue'

useHead({ title: 'Spike · app on Vue Flow' })
const BUILD = 'spike-a · #906 · Nuxt UI 4 drawer + slideover + slider'

const blockNode = markRaw(SpikeBlockNode)

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

// Fork A — compile the placement into a layout. Same rule as the WS8 bridge's
// piecesToTree, inlined (the package util isn't exposed as a POC import): 1 node → its
// leaf is the root; many → a split whose axis is inferred from how they're laid out
// (wider spread in x ⇒ horizontal), ordered along that axis. The productionised path
// would call the real `piecesToTree`.
const compiled = ref<LayoutTree | null>(null)
function compile() {
  const ns = nodes.value
  if (!ns.length) { compiled.value = null; return }
  const leaf = (n: FlowNode): LayoutNode => ({ type: 'leaf', blockId: n.data.blockId })
  if (ns.length === 1) {
    compiled.value = { renderer: 'panes', root: leaf(ns[0]!) }
  }
  else {
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a)
    const horizontal = spread(ns.map(n => n.position.x)) >= spread(ns.map(n => n.position.y))
    const ordered = [...ns].sort((a, b) => (horizontal ? a.position.x - b.position.x : a.position.y - b.position.y))
    compiled.value = {
      renderer: 'panes',
      root: {
        type: 'split',
        direction: horizontal ? 'horizontal' : 'vertical',
        children: ordered.map(n => ({ ...leaf(n), defaultSize: Math.round((100 / ordered.length) * 10) / 10 })),
      },
    }
  }
  paletteOpen.value = false
  resultOpen.value = true
}
function reset() {
  nodes.value = []
  compiled.value = null
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
        <UButton size="sm" icon="i-lucide-wand-2" :disabled="!nodes.length" block @click="compile">Compile to layout</UButton>
        <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-rotate-ccw" block @click="reset">Reset</UButton>
      </div>
    </DefinePalette>

    <header class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-default px-5 py-3">
      <h1 class="text-base font-semibold">Spike · build an app on Vue Flow</h1>
      <p class="hidden text-xs text-muted sm:block">Drag a block from the drawer onto the canvas → Compile. #903</p>
      <div class="ml-auto flex items-center gap-2">
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
          v-if="compiled"
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

      <!-- The Vue Flow canvas -->
      <div class="relative min-w-0 flex-1">
        <ClientOnly>
          <CroutonFlow
            v-model:rows="nodes"
            collection="artists"
            data-mode="ephemeral"
            :default-node-component="blockNode"
            allow-drop
            :minimap="false"
            @node-drop="onNodeDrop"
          />
        </ClientOnly>
        <p
          v-if="!nodes.length"
          class="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted"
        >
          <span class="hidden md:inline">Drag a block from the drawer onto the canvas →</span>
          <span class="md:hidden">Tap <strong>Blocks</strong> to open the palette.</span>
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

    <!-- Compiled layout — the result of fork A, in a contextual slideover (#906) -->
    <USlideover v-model:open="resultOpen" title="Compiled layout" :ui="{ content: 'sm:max-w-md' }">
      <template #body>
        <div class="h-full overflow-hidden rounded-xl border border-default">
          <CroutonLayoutRenderer v-if="compiled" :node="compiled.root" />
        </div>
      </template>
    </USlideover>
  </div>
</template>
