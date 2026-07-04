<script setup lang="ts">
/**
 * BuilderBlockNode — a Vue Flow node that renders a layout NODE on the board canvas.
 *
 * A freshly-added block is a single leaf; a composed page is a split of blocks. The card
 * sizes itself to the node's FOOTPRINT (a 2-high stack is twice as tall) and renders the
 * node's layout through the static `BuilderNodePreview` (nested flex, no live layout engine),
 * so the board shows the real arrangement over the real collections — WYSIWYG, but a thumbnail.
 *
 * Slice 1 (canvas skeleton): read-only card + `page-badge` / `region-pill` hooks + the
 * `drag-glow` while dragging or just-added. The heavy in-card gestures (snap guide, pull-to-
 * detach, per-element resize, focus-edit) land in the gesture slice; double-click-to-edit is
 * emitted by CroutonFlow at the board level, not here.
 *
 * `footprint` / `sizeOf` / `BUILDER_BASE_*` are auto-imported from app/utils/builder-layout.
 */
import { computed, inject, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { LayoutNode, LayoutBreakpoint } from '@fyit/crouton-core/app/types/layout'
import { BUILDER_SNAP_KEY, BUILDER_SET_REGION_KEY, BUILDER_SET_SIZE_KEY, BUILDER_DETACH_KEY, BUILDER_REORDER_KEY, type BuilderRegion } from '~/utils/builder-keys'

const props = defineProps<{
  data: {
    node: LayoutNode
    label?: string
    bp?: LayoutBreakpoint[]
    isPage?: boolean
    justAdded?: boolean
    region?: BuilderRegion
    width?: number
    height?: number
  }
  selected?: boolean
  // Vue Flow sets this true while the node is dragged across the board, false on drop —
  // drives the light-green drag glow (fades via transition-shadow after release).
  dragging?: boolean
}>()

// per-element-resize — an explicit width/height wins over the intrinsic footprint size.
const size = computed(() => {
  const f = footprint(props.data.node)
  const w = typeof props.data.width === 'number' ? props.data.width : f.cols * BUILDER_BASE_W
  const h = typeof props.data.height === 'number' ? props.data.height : f.rows * BUILDER_BASE_H
  return { width: `${w}px`, height: `${h}px` }
})

// The corner handle sets this card's width/height. Zoom-compensated so the drag tracks 1:1 on
// screen; floored at the node's derived hard-min-width so a layout can't be dragged below its
// components' rules (deriveSizing folds the leaf minWidths). Auto-imported from crouton-layout.
const setSize = inject(BUILDER_SET_SIZE_KEY, null)
const { blocks } = useCroutonLayoutBlocks()
const resizeFloorW = computed(() => Math.max(120, deriveSizing(props.data.node, blocks.value).hardMinWidth || 0))
const resizing = ref(false)
function currentZoom(): number {
  const el = document.querySelector('.vue-flow__transformationpane') as HTMLElement | null
  if (!el) return 1
  try { return new DOMMatrix(getComputedStyle(el).transform).a || 1 } catch { return 1 }
}
function onResizeDown(e: PointerEvent) {
  if (!setSize || e.button !== 0) return
  e.stopPropagation(); e.preventDefault()
  resizing.value = true
  const z = currentZoom()
  const card = (e.currentTarget as HTMLElement).closest('.builder-block-node') as HTMLElement | null
  const rect = card?.getBoundingClientRect()
  const startW = typeof props.data.width === 'number' ? props.data.width : (rect ? rect.width / z : 256)
  const startH = typeof props.data.height === 'number' ? props.data.height : (rect ? rect.height / z : 184)
  const ox = e.clientX, oy = e.clientY
  const floorW = resizeFloorW.value
  const move = (ev: PointerEvent) => {
    setSize!(props.data.node, {
      width: Math.max(floorW, Math.round(startW + (ev.clientX - ox) / z)),
      height: Math.max(120, Math.round(startH + (ev.clientY - oy) / z)),
    })
  }
  const up = () => { resizing.value = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function resetSize() { setSize?.(props.data.node, { width: null }) }

// ── detach-reorder (spec: `detach-reorder`) ─────────────────────────────────────
// Long-press a composed card → its top-level panes wiggle. Slide a pane to another slot →
// reorder (moveChild); pull it OUT past the margin → detach into its own card (detachNode).
const LONG_PRESS_MS = 420, MOVE_CANCEL_PX = 8, DETACH_MARGIN = 64
const detach = inject(BUILDER_DETACH_KEY, null)
const reorder = inject(BUILDER_REORDER_KEY, null)
const jiggling = ref(false)
const activeIndex = ref<number | null>(null)
const pull = ref({ x: 0, y: 0 })
const past = ref(false)            // pulled far enough to detach
const reorderTo = ref<number | null>(null)
let pressTimer: number | null = null
let pressOrigin = { x: 0, y: 0 }

const isGroup = computed(() => props.data.node.type === 'split' && props.data.node.children.length >= 2)

// Top-level panes of a split root, each as a 0..1 fraction box (mirrors BuilderNodePreview's split).
const topPanes = computed(() => {
  const n = props.data.node
  if (n.type !== 'split') return [] as { index: number, left: number, top: number, width: number, height: number }[]
  const kids = n.children
  const sizes = kids.map(c => (c.defaultSize && c.defaultSize > 0 ? c.defaultSize : 0))
  const total = sizes.reduce((s, v) => s + v, 0)
  const equal = 1 / kids.length
  let acc = 0
  return kids.map((_, i) => {
    const frac = total > 0 && sizes[i]! > 0 ? sizes[i]! / total : equal
    const box = n.direction === 'horizontal'
      ? { index: i, left: acc, top: 0, width: frac, height: 1 }
      : { index: i, left: 0, top: acc, width: 1, height: frac }
    acc += frac
    return box
  })
})

// The LayoutNode a top-level pane holds (for the drag ghost's content) + the grabbed pane's box.
function paneNode(i: number): LayoutNode {
  const n = props.data.node
  return n.type === 'split' ? (n.children[i] ?? n) : n
}
const activePane = computed(() => (activeIndex.value != null ? topPanes.value.find(p => p.index === activeIndex.value) ?? null : null))

function clearPress() {
  if (pressTimer != null) { window.clearTimeout(pressTimer); pressTimer = null }
  window.removeEventListener('pointermove', onCardMove)
  window.removeEventListener('pointerup', onCardUp)
}
function onCardMove(e: PointerEvent) {
  if (pressTimer != null && Math.hypot(e.clientX - pressOrigin.x, e.clientY - pressOrigin.y) > MOVE_CANCEL_PX) clearPress()
}
function onCardUp() { clearPress() }
function onCardDown(e: PointerEvent) {
  if (!isGroup.value || !detach) return
  if (jiggling.value) { jiggling.value = false; return } // tap the card while armed → exit
  pressOrigin = { x: e.clientX, y: e.clientY }
  pressTimer = window.setTimeout(() => { jiggling.value = true; pressTimer = null }, LONG_PRESS_MS)
  window.addEventListener('pointermove', onCardMove)
  window.addEventListener('pointerup', onCardUp)
}

// Pull a top-level pane: reorder within the card, or detach when pulled out past the margin.
function onPaneDown(i: number, e: PointerEvent) {
  if (!jiggling.value) return
  e.stopPropagation(); e.preventDefault()
  activeIndex.value = i; pull.value = { x: 0, y: 0 }; past.value = false; reorderTo.value = i
  const origin = { x: e.clientX, y: e.clientY }
  const z = currentZoom()
  const card = (e.currentTarget as HTMLElement).closest('.builder-block-node') as HTMLElement | null
  try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch {}
  const move = (ev: PointerEvent) => {
    pull.value = { x: (ev.clientX - origin.x) / z, y: (ev.clientY - origin.y) / z }
    const r = card?.getBoundingClientRect()
    if (!r) return
    const outside = Math.max(r.left - ev.clientX, ev.clientX - r.right, r.top - ev.clientY, ev.clientY - r.bottom, 0)
    past.value = outside > DETACH_MARGIN
    if (!past.value) {
      const horiz = props.data.node.type === 'split' && props.data.node.direction === 'horizontal'
      const frac = horiz ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height
      const n = topPanes.value.length
      reorderTo.value = Math.max(0, Math.min(n - 1, Math.floor(frac * n)))
    }
  }
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
    const i2 = activeIndex.value
    if (i2 != null) {
      if (past.value && detach) detach(props.data.node, { index: i2, dropOffset: { x: pull.value.x, y: pull.value.y } })
      else if (reorderTo.value != null && reorderTo.value !== i2 && reorder) reorder(props.data.node, { from: i2, to: reorderTo.value })
    }
    activeIndex.value = null; pull.value = { x: 0, y: 0 }; past.value = false; reorderTo.value = null
    jiggling.value = false
  }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
}

function onEscKey(e: KeyboardEvent) { if (e.key === 'Escape' && jiggling.value) jiggling.value = false }
// Exit the wiggle by tapping anywhere OUTSIDE the card (mobile has no Esc, and the pane faces cover
// the whole card so a tap on it can't reach onCardDown). Capture-phase so it sees the tap before a
// face swallows it; `contains` keeps taps inside the card (faces / Done) from exiting.
const rootEl = ref<HTMLElement | null>(null)
function onOutsidePointer(e: PointerEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) jiggling.value = false
}
watch(jiggling, (on) => {
  if (on) window.addEventListener('pointerdown', onOutsidePointer, true)
  else window.removeEventListener('pointerdown', onOutsidePointer, true)
})
onMounted(() => window.addEventListener('keydown', onEscKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEscKey)
  window.removeEventListener('pointerdown', onOutsidePointer, true)
  clearPress()
})

// snap-dwell (spec: `snap-dwell-arm`) — the board provides a live snap preview; this card is
// the target when the preview points at ITS node (matched by object identity — Vue Flow doesn't
// forward the node id). Light the edge it will snap to: soft blue, then green once armed.
const snapPreview = inject(BUILDER_SNAP_KEY, null)
const snapHere = computed(() => {
  const p = snapPreview?.value
  return p && p.targetNode === props.data.node ? p : null
})

// pane-drop (spec: `pane-drop-beside`) — when the preview is a pane-drop, the guide band sits on
// one edge of the TARGETED PANE (a fraction of the card), not the card's outer edge. Positioned
// inline from `paneDrop.rect` (0..1 fractions). The plain edge-snap case uses the `.e-*` classes.
// page-regions-pin — pin this node to the page's top/bottom edge from its toolbar (shown on select).
const setRegion = inject(BUILDER_SET_REGION_KEY, null)

const paneGuideStyle = computed(() => {
  const p = snapHere.value?.paneDrop
  if (!p) return undefined
  const r = p.rect
  const pct = (v: number) => `${v * 100}%`
  const t = `${snapHere.value!.armed ? 6 : 10}px`
  switch (p.edge) {
    case 'right': return { left: pct(r.left + r.width), top: pct(r.top), height: pct(r.height), width: t, transform: 'translateX(-50%)' }
    case 'left': return { left: pct(r.left), top: pct(r.top), height: pct(r.height), width: t, transform: 'translateX(-50%)' }
    case 'top': return { left: pct(r.left), top: pct(r.top), width: pct(r.width), height: t, transform: 'translateY(-50%)' }
    case 'bottom': return { left: pct(r.left), top: pct(r.top + r.height), width: pct(r.width), height: t, transform: 'translateY(-50%)' }
  }
  return undefined
})
</script>

<template>
  <div
    ref="rootEl"
    class="builder-block-node transition-[box-shadow] duration-300 ease-out"
    :class="[
      (dragging || data.justAdded) ? 'builder-drag-glow' : selected ? 'ring-2 ring-primary shadow-lg' : '',
      jiggling ? 'ring-2 ring-primary/70' : '',
      activePane ? 'builder-detach-lift' : '',
    ]"
    :style="size"
    data-handoff="board-node"
    :data-jiggling="jiggling ? 'true' : undefined"
    @pointerdown="onCardDown"
  >
    <!-- page-badge hook: this node IS "the page" (the live layout). -->
    <UBadge
      v-if="data.isPage"
      data-handoff="page-badge"
      color="primary"
      variant="solid"
      size="sm"
      class="pointer-events-none absolute left-2 top-2 z-30 shadow"
    >
      <UIcon name="i-lucide-star" class="size-3" />
    </UBadge>

    <!-- region-pill hook: pinned to a page edge (top/bottom sticky region). -->
    <UBadge
      v-if="data.region"
      data-handoff="region-pill"
      :data-region="data.region"
      color="neutral"
      variant="subtle"
      size="sm"
      class="pointer-events-none absolute right-2 top-2 z-30 shadow"
    >
      {{ data.region }}
    </UBadge>

    <!-- region toolbar (spec: page-regions-pin) — pin to the page's top/bottom edge; on select. -->
    <div v-if="selected" class="nodrag absolute right-2 top-9 z-30 flex gap-1">
      <UButton
        size="xs"
        icon="i-lucide-panel-top"
        :color="data.region === 'top' ? 'primary' : 'neutral'"
        :variant="data.region === 'top' ? 'solid' : 'subtle'"
        data-handoff="pin-top"
        aria-label="Pin to top"
        @click.stop="setRegion?.(data.node, data.region === 'top' ? null : 'top')"
      />
      <UButton
        size="xs"
        icon="i-lucide-panel-bottom"
        :color="data.region === 'bottom' ? 'primary' : 'neutral'"
        :variant="data.region === 'bottom' ? 'solid' : 'subtle'"
        data-handoff="pin-bottom"
        aria-label="Pin to bottom"
        @click.stop="setRegion?.(data.node, data.region === 'bottom' ? null : 'bottom')"
      />
    </div>

    <!-- per-element-resize corner handle (spec: per-element-resize) — shown on select. -->
    <div
      v-if="selected"
      class="nodrag nopan absolute bottom-1 right-1 z-30 size-3.5 cursor-nwse-resize rounded-sm border-2 border-primary bg-elevated shadow"
      data-handoff="resize-handle"
      title="Drag to resize · double-click to reset"
      @pointerdown="onResizeDown"
      @dblclick.stop="resetSize"
    />

    <!-- snap-guide / ghost-pane hook: this card is the target. Edge-snap → a bar on the card's
         outer edge (data-handoff="snap-guide"). Pane-drop → a bar on the targeted pane's edge
         (data-handoff="ghost-pane" data-edge). Soft blue, then green (armed) after the dwell. -->
    <div
      v-if="snapHere"
      :data-handoff="snapHere.paneDrop ? 'ghost-pane' : 'snap-guide'"
      :data-armed="snapHere.armed"
      :data-edge="snapHere.edge"
      class="builder-snap-guide"
      :class="snapHere.paneDrop ? (snapHere.armed ? 'armed' : 'soft') : [snapHere.armed ? 'armed' : 'soft', `e-${snapHere.edge}`]"
      :style="snapHere.paneDrop ? paneGuideStyle : undefined"
    />

    <!-- A board node is a STATIC thumbnail — a plain nested-flex render of the layout
         tree (no reka Splitter, no ResizeObserver). The live CroutonLayoutRenderer loops
         and OOM-crashes mobile Safari inside a transform-scaled Vue Flow node; see
         BuilderNodePreview's header note. Editing panes happens in the focus-edit view. -->
    <BuilderNodePreview :node="data.node" />

    <!-- detach-reorder (spec: detach-reorder): long-press → top-level panes become grabbable.
         Each pane is a face at its own slot; the grabbed pane's slot goes EMPTY and a clean ghost
         (its real content) lifts out and follows the finger — no more static content bleeding through. -->
    <template v-if="jiggling">
      <!-- exit affordance: mobile has no Esc and the faces cover the card, so a visible Done is the
           reliable way out (plus tap-outside / Esc). -->
      <button
        type="button"
        class="builder-jiggle-done nodrag nopan"
        data-handoff="jiggle-done"
        @pointerdown.stop
        @click.stop="jiggling = false"
      >
        ✓ Done
      </button>
      <div
        v-for="p in topPanes"
        :key="p.index"
        class="builder-pane-face nodrag nopan"
        data-handoff="pane-face"
        :class="[
          activeIndex === null ? 'wiggle' : '',
          activeIndex === p.index ? 'source-empty' : 'slot',
          reorderTo === p.index && activeIndex !== null && activeIndex !== p.index && !past ? 'drop-target' : '',
        ]"
        :style="{ left: `${p.left * 100}%`, top: `${p.top * 100}%`, width: `${p.width * 100}%`, height: `${p.height * 100}%` }"
        @pointerdown="onPaneDown(p.index, $event)"
      >
        <span v-if="activeIndex === p.index" class="builder-slot-hint">moved out</span>
      </div>

      <!-- the ghost: the grabbed pane's real content, lifted onto the canvas, following the finger. -->
      <div
        v-if="activePane"
        class="builder-pane-ghost nodrag nopan"
        data-handoff="pane-ghost"
        :data-detach="past ? 'true' : 'false'"
        :class="past ? 'detaching' : 'grabbed'"
        :style="{
          left: `${activePane.left * 100}%`, top: `${activePane.top * 100}%`,
          width: `${activePane.width * 100}%`, height: `${activePane.height * 100}%`,
          transform: `translate(${pull.x}px, ${pull.y}px)`,
        }"
      >
        <BuilderNodePreview :node="paneNode(activePane.index)" />
        <span class="builder-pane-label" :data-detach="past ? 'true' : 'false'">
          {{ past ? 'Release to detach' : 'Move' }}
        </span>
      </div>

      <span class="builder-jiggle-hint">drag a pane out to detach · tap Done to finish</span>
    </template>
  </div>
</template>

<style scoped>
.builder-block-node {
  position: relative;
  height: 100%;
  width: 100%;
  overflow: hidden;
  border-radius: 0.75rem;
  border: 1px solid var(--ui-border, rgba(120, 120, 120, 0.2));
  background: var(--ui-bg-elevated, rgba(255, 255, 255, 0.6));
}
/* While a pane is lifted (detach), stop clipping so the ghost can roam the canvas
   past the card edge instead of being cut off at the border. Transient — only for
   the active drag (activePane); the card re-clips its content the instant you release. */
.builder-block-node.builder-detach-lift {
  overflow: visible;
}
/* drag-glow (spec: drag-glow) — a light-green halo while the card is dragged or just added. */
.builder-drag-glow {
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.55), 0 0 18px 4px rgba(16, 185, 129, 0.35);
}
/* snap-guide (spec: snap-dwell-arm) — the edge bar on the snap target. soft = blue/pulse
   (approached), armed = green/glow (held past the dwell → release will snap). */
.builder-snap-guide {
  position: absolute;
  z-index: 40;
  border-radius: 9999px;
  pointer-events: none;
  transition: all 0.15s ease;
}
.builder-snap-guide.soft { background: rgba(56, 189, 248, 0.85); animation: builder-snap-pulse 1s ease-in-out infinite; }
.builder-snap-guide.armed { background: rgb(16, 185, 129); box-shadow: 0 0 12px 2px rgba(16, 185, 129, 0.7); }
.builder-snap-guide.e-right { top: 6px; bottom: 6px; right: -5px; }
.builder-snap-guide.e-left { top: 6px; bottom: 6px; left: -5px; }
.builder-snap-guide.e-top { left: 6px; right: 6px; top: -5px; }
.builder-snap-guide.e-bottom { left: 6px; right: 6px; bottom: -5px; }
.builder-snap-guide.soft.e-right, .builder-snap-guide.soft.e-left { width: 10px; }
.builder-snap-guide.armed.e-right, .builder-snap-guide.armed.e-left { width: 6px; }
.builder-snap-guide.soft.e-top, .builder-snap-guide.soft.e-bottom { height: 10px; }
.builder-snap-guide.armed.e-top, .builder-snap-guide.armed.e-bottom { height: 6px; }
@keyframes builder-snap-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

/* detach-reorder (spec: detach-reorder) — grabbable top-level pane faces while the card wiggles. */
.builder-pane-face {
  position: absolute;
  z-index: 45;
  border-radius: 0.5rem;
  border: 1.5px dashed rgba(99, 102, 241, 0.45);
  background: transparent;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, border-color 0.15s ease;
  touch-action: none;
}
.builder-pane-face.wiggle { animation: builder-wiggle 0.5s ease-in-out infinite; }
.builder-pane-face.slot { border-color: rgba(99, 102, 241, 0.35); }
.builder-pane-face.drop-target { background: rgba(16, 185, 129, 0.12); border-color: rgb(16, 185, 129); }
/* the grabbed pane's original slot — an opaque cover so the source reads as EMPTY (no double-vision) */
.builder-pane-face.source-empty { cursor: grabbing; background: var(--ui-bg-elevated, #fff); border: 2px dashed rgba(120, 120, 120, 0.45); }
.builder-slot-hint { font-size: 10px; color: var(--ui-text-muted, #999); }

/* the lifted ghost tile — clean, opaque, elevated, carrying the pane's real content on the canvas. */
.builder-pane-ghost {
  position: absolute;
  z-index: 55;
  border-radius: 0.6rem;
  overflow: hidden;
  background: var(--ui-bg-elevated, #fff);
  border: 2px solid rgb(16, 185, 129);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  cursor: grabbing;
  pointer-events: none;
}
.builder-pane-ghost.detaching { border-color: rgb(239, 68, 68); box-shadow: 0 14px 34px rgba(239, 68, 68, 0.35); }
.builder-pane-label { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); font-size: 11px; font-weight: 700; color: rgb(16, 185, 129); background: var(--ui-bg-elevated, #fff); padding: 2px 8px; border-radius: 999px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); white-space: nowrap; }
.builder-pane-label[data-detach="true"] { color: rgb(239, 68, 68); }
.builder-jiggle-done {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 70;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: rgb(16, 185, 129);
  padding: 4px 14px;
  border-radius: 999px;
  border: none;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  cursor: pointer;
}
.builder-jiggle-hint {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  z-index: 60;
  font-size: 10px;
  white-space: nowrap;
  color: var(--ui-text-muted, #888);
  background: var(--ui-bg-elevated, #fff);
  padding: 2px 8px;
  border-radius: 999px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  pointer-events: none;
}
@keyframes builder-wiggle { 0%, 100% { transform: rotate(-0.6deg); } 50% { transform: rotate(0.6deg); } }
</style>
