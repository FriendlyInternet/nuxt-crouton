<script setup lang="ts">
/**
 * SpikeBlockNode (spike #903 → #907) — a Vue Flow node that renders a layout NODE on the
 * canvas. A freshly-dropped block is a single leaf; when two block-nodes snap together they
 * MERGE into one node whose `data.node` is a bound split (#907) — so the merged unit drags
 * as one piece and the renderer stretches each pane to the group's full size. The card sizes
 * itself to the node's footprint (a 2-high stack is twice as tall, etc.).
 *
 * Live snap guide (#907): while ANOTHER block is dragged toward this one, the page's
 * `snapPreview` (injected) names this node + the joining edge — we light that edge up.
 *
 * Pull-the-pane-to-detach (#907): hovering/selecting a MERGED node arms it — each top-level
 * pane becomes a grabbable face. Grab the pane itself (no pill) and the group EASES APART to
 * reveal its seams; the pane tracks your finger 1:1 and, dragged past a THRESHOLD, pops out into
 * its own flow node exactly where you let go. Under the threshold it SPRINGS back. The pane faces
 * are `.nodrag` so Vue Flow pulls the pane instead of moving the whole node; the seams/frame
 * between them stay node-draggable (so a merged group can still be repositioned). Detach is
 * reported via the injected SPIKE_DETACH_KEY callback (a default node component can't emit up
 * through CroutonFlow).
 *
 * Editing moved OFF the canvas (#907 focus-view redesign): double-clicking a node opens a dedicated
 * full-screen edit view (no Vue Flow camera, so framing is deterministic) — so this node carries NO
 * in-flow editable surface. It stays a read-only card: footprint render, survey render, the snap
 * guide, and the board-level pull-pane detach gesture.
 *
 * No `@vue-flow/core` import (connection handles aren't needed here). `footprint` / `SPIKE_*`
 * / `SPIKE_SNAP_KEY` / `SPIKE_DETACH_KEY` are auto-imported from app/utils/spike-layout.
 */
import { ref, inject, computed, watch } from 'vue'
import type { LayoutNode, LayoutBreakpoint } from '@fyit/crouton-core/app/types/layout'

const props = defineProps<{
  data: { node: LayoutNode, label?: string, bp?: LayoutBreakpoint[] }
  selected?: boolean
}>()

// Global viewport survey (#907 layer 3): when a device is active, size the card to that device
// and render the layout AT that width (so the board becomes a wall of phones/tablets/desktops).
const viewport = inject(SPIKE_VIEWPORT_KEY, null)
const surveying = computed(() => !!viewport?.value)

const size = computed(() => {
  if (viewport?.value) return { width: `${viewport.value.width}px`, height: `${viewport.value.height}px` }
  const f = footprint(props.data.node)
  return { width: `${f.cols * SPIKE_BASE_W}px`, height: `${f.rows * SPIKE_BASE_H}px` }
})

// A LayoutTree wrapper for the responsive renderer — carries any breakpoints authored in the
// edit view, so the survey resolves the SAME authored responsiveness at the device width.
const tree = computed(() => ({ renderer: 'panes' as const, root: props.data.node, breakpoints: props.data.bp }))

// --- live snap guide (target edge lights up while a peer is dragged) ------------------
const snapPreview = inject(SPIKE_SNAP_KEY, null)
const guideEdge = computed<SnapEdge | null>(() =>
  !surveying.value && snapPreview?.value && snapPreview.value.node === props.data.node ? snapPreview.value.edge : null,
)
const guideStyle = computed(() => {
  switch (guideEdge.value) {
    case 'left': return { left: '-3px', top: '0', bottom: '0', width: '4px' }
    case 'right': return { right: '-3px', top: '0', bottom: '0', width: '4px' }
    case 'top': return { top: '-3px', left: '0', right: '0', height: '4px' }
    case 'bottom': return { bottom: '-3px', left: '0', right: '0', height: '4px' }
    default: return {}
  }
})

// --- pull-the-pane-to-detach ----------------------------------------------------------
const PULL_THRESHOLD = 64 // raw cursor px the pane must travel before it pops free
const RESISTANCE = 1 // pane tracks the cursor/thumb 1:1 (direct manipulation) → it detaches exactly under your finger; the THRESHOLD + ease-apart + spring-back carry the physical feel, not positional lag
const detach = inject(SPIKE_DETACH_KEY, null)
const hovered = ref(false)
const isGroup = computed(() => props.data.node.type === 'split')
// Stay armed while a pull is in flight (activeIndex set) even if the cursor leaves the card —
// otherwise mouseleave drops `hovered`, the overlay unmounts, and the grabbed pane is orphaned.
const armed = computed(() => !surveying.value && isGroup.value && (hovered.value || !!props.selected || activeIndex.value !== null))

// Top-level pane faces (as % of the card), laid out along the split's axis by footprint — the
// regions you grab to pull a pane out, and the seams revealed between them on ease-apart.
const panes = computed(() => {
  const n = props.data.node
  if (n.type !== 'split') return []
  const horizontal = n.direction === 'horizontal'
  const fps = n.children.map(footprint)
  const total = fps.reduce((s, f) => s + (horizontal ? f.cols : f.rows), 0) || 1
  let acc = 0
  return n.children.map((_, i) => {
    const span = horizontal ? fps[i]!.cols : fps[i]!.rows
    const start = (acc / total) * 100
    const sizePct = (span / total) * 100
    acc += span
    return horizontal
      ? { left: start, top: 0, width: sizePct, height: 100 }
      : { left: 0, top: start, width: 100, height: sizePct }
  })
})

// Active pull state.
const activeIndex = ref<number | null>(null) // the pane being pulled
const pulling = ref(false) // a pull is in progress → the group eases apart
const springing = ref(false) // released under the threshold → animate the pane back
const pull = ref({ x: 0, y: 0 }) // resisted (lagging) translate on the grabbed pane
const past = ref(false) // cursor past the threshold → releasing now will detach
let origin = { x: 0, y: 0 }
let faceEl: HTMLElement | null = null // the grabbed pane face — its rect at release = the drop spot
let moveHandler: ((e: PointerEvent) => void) | null = null
let upHandler: ((e: PointerEvent) => void) | null = null

// Gap each pane insets by: a resting seam (so the seams/frame stay node-draggable) that widens
// when a pull starts, so the group visibly eases apart the moment you grab a pane.
const gap = computed(() => (pulling.value ? 12 : 6))

function paneRect(p: { left: number, top: number, width: number, height: number }) {
  return { left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%`, height: `${p.height}%` }
}
function faceStyle(i: number) {
  return {
    inset: `${gap.value}px`,
    transform: activeIndex.value === i ? `translate(${pull.value.x}px, ${pull.value.y}px)` : undefined,
  }
}

// The grabbed pane's top-left at release, as a FLOW-space offset from the group's top-left. The
// card renders at `sizeOf(node)` flow px scaled by the canvas zoom, so zoom = cardScreenWidth /
// flowWidth; the pane's screen offset from the card top-left ÷ zoom is its flow offset. The page
// adds this to the group's known flow position (CroutonFlow doesn't forward the node's position
// to a default node component, so we report an offset, not an absolute, and let the page resolve it).
// The live canvas zoom, read straight off Vue Flow's transformationpane `scale(z)` — exact, and
// independent of the node's content-driven render size (which is why a footprint-derived zoom was wrong).
function currentZoom(): number {
  const pane = (faceEl?.ownerDocument ?? document).querySelector('.vue-flow__transformationpane') as HTMLElement | null
  const m = pane ? /scale\(([-\d.]+)\)/.exec(pane.style.transform || '') : null
  const z = m ? Number.parseFloat(m[1]!) : 1
  return z && isFinite(z) ? z : 1
}

function computeDropOffset(): { x: number, y: number } | undefined {
  if (!faceEl) return undefined
  // The node wrapper's screen top-left is the group's origin; divide the pane's screen offset from it
  // by the real zoom to get the flow-space offset the page adds to the group's known position.
  const card = faceEl.closest('.vue-flow__node') as HTMLElement | null
  if (!card) return undefined
  const faceR = faceEl.getBoundingClientRect()
  const cardR = card.getBoundingClientRect()
  const zoom = currentZoom()
  return { x: (faceR.left - cardR.left) / zoom, y: (faceR.top - cardR.top) / zoom }
}

function onPaneDown(i: number, e: PointerEvent) {
  if (e.button !== 0) return // left-button only; `.nodrag` already keeps Vue Flow from moving the node
  activeIndex.value = i
  pulling.value = true // ease the group apart on grab
  springing.value = false
  past.value = false
  pull.value = { x: 0, y: 0 }
  origin = { x: e.clientX, y: e.clientY }
  faceEl = e.currentTarget as HTMLElement
  // The face lives inside Vue Flow's `transformationpane`, which is `scale(zoom)`. A CSS translate
  // here is applied in that scaled space, so it moves `translate × zoom` on screen. To track the
  // finger 1:1 on screen (so the pane is under your finger and detaches exactly there), pre-divide
  // the finger delta by the live zoom (read straight off the transformationpane scale).
  const zoom = currentZoom()
  moveHandler = (ev: PointerEvent) => {
    const rawX = ev.clientX - origin.x
    const rawY = ev.clientY - origin.y
    pull.value = { x: (rawX / zoom) * RESISTANCE, y: (rawY / zoom) * RESISTANCE } // → on-screen = rawΔ × RESISTANCE
    past.value = Math.hypot(rawX, rawY) > PULL_THRESHOLD // threshold is in real screen px (finger travel)
  }
  upHandler = (ev: PointerEvent) => {
    const dir = { x: ev.clientX - origin.x, y: ev.clientY - origin.y } // raw release direction
    // The pulled pane's flow-space offset at release, so the freed node lands where you dropped it
    // (WYSIWYG) instead of adjacent to the group. Read the DOM BEFORE cleanup nulls faceEl.
    const dropOffset = computeDropOffset()
    const i2 = activeIndex.value
    const didDetach = past.value && i2 != null
    cleanup()
    if (didDetach) {
      // Reset pull state FIRST: Vue Flow reuses this node's component instance (same id), so a
      // leftover activeIndex/pull would strand the next pull's state. Then ask the page to detach.
      resetPull()
      detach?.(props.data.node, { index: i2!, dir, dropOffset }) // page removes this pane → card re-renders
    }
    else {
      // Spring the pane back to its socket (CSS transition), then clear once it's home.
      springing.value = true
      pulling.value = false
      pull.value = { x: 0, y: 0 }
      past.value = false
      window.setTimeout(() => resetPull(), 220)
    }
  }
  window.addEventListener('pointermove', moveHandler)
  window.addEventListener('pointerup', upHandler, { once: true })
}

function resetPull() {
  activeIndex.value = null
  pulling.value = false
  springing.value = false
  pull.value = { x: 0, y: 0 }
  past.value = false
}

function cleanup() {
  if (moveHandler) window.removeEventListener('pointermove', moveHandler)
  moveHandler = null
  upHandler = null
  faceEl = null
}

// Whenever the rendered layout changes under us (a detach shrank the group, a merge grew it, etc.),
// clear any stale pull state — the instance is reused across these changes, so don't carry it over.
watch(() => props.data.node, () => { cleanup(); resetPull() })
</script>

<template>
  <UCard
    class="spike-block-node transition-shadow"
    :class="guideEdge ? 'ring-2 ring-primary shadow-lg' : selected ? 'ring-primary shadow-lg' : ''"
    :style="size"
    :ui="{ root: 'relative overflow-visible', body: `h-full ${pulling ? 'overflow-visible' : 'overflow-hidden'} rounded-[inherit] p-0 sm:p-0` }"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- Survey mode renders the layout AT the device width (authored breakpoints + intrinsic reflow); -->
    <!-- topology mode renders it plain at its footprint size. -->
    <CroutonLayoutResponsiveRenderer v-if="surveying" :tree="tree" :width="viewport!.width" />
    <CroutonLayoutRenderer v-else :node="data.node" />

    <!-- Live snap guide: the edge this block will be joined on lights up while a peer is dragged -->
    <div
      v-if="guideEdge"
      class="pointer-events-none absolute z-10 animate-pulse rounded-full bg-primary shadow-[0_0_10px_2px_var(--ui-primary)]"
      :style="guideStyle"
    />

    <!-- Detach overlay: armed merged node → grab a pane face and pull it out past the threshold.
         The container is `.nodrag` so Vue Flow pulls the pane, not the node; the seams/frame
         between faces stay uncovered (pointer-events-none) so the merged group is still draggable. -->
    <div v-if="armed" class="nodrag pointer-events-none absolute inset-0 z-20">
      <div
        v-for="(p, i) in panes"
        :key="i"
        class="absolute"
        :style="paneRect(p)"
      >
        <!-- the socket the pane leaves behind while it's pulled out -->
        <div
          v-if="activeIndex === i"
          class="absolute rounded-xl border border-dashed border-primary/50 bg-primary/5"
          :style="{ inset: `${gap}px` }"
        />
        <!-- the grabbable pane face — grab it and pull -->
        <div
          class="group pointer-events-auto absolute flex cursor-grab items-center justify-center rounded-xl ring-1 backdrop-blur-[1px] active:cursor-grabbing"
          :class="[
            activeIndex === i
              ? (past ? 'z-10 ring-2 ring-primary bg-primary/15 shadow-2xl' : 'z-10 ring-2 ring-primary/70 bg-elevated/40 shadow-xl')
              : 'ring-default/40 bg-elevated/5 hover:bg-elevated/20 hover:ring-primary/40',
            activeIndex === i && !springing ? '' : 'transition-all duration-200 ease-out',
          ]"
          :style="faceStyle(i)"
          @pointerdown="onPaneDown(i, $event)"
        >
          <span
            class="flex items-center gap-1 rounded-full bg-default/85 px-2 py-1 text-[10px] font-medium shadow-sm backdrop-blur transition-opacity"
            :class="activeIndex === i ? 'text-primary opacity-100' : 'text-muted opacity-0 group-hover:opacity-100'"
          >
            <UIcon :name="activeIndex === i && past ? 'i-lucide-hand' : 'i-lucide-grip'" class="size-3" />
            {{ activeIndex === i ? (past ? 'Release to detach' : 'Pull out…') : 'Pull to detach' }}
          </span>
        </div>
      </div>
    </div>
  </UCard>
</template>
