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
import { computed, inject, ref } from 'vue'
import type { LayoutNode, LayoutBreakpoint } from '@fyit/crouton-core/app/types/layout'
import { BUILDER_SNAP_KEY, BUILDER_SET_REGION_KEY, BUILDER_SET_SIZE_KEY, type BuilderRegion } from '~/utils/builder-keys'

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
    class="builder-block-node transition-[box-shadow] duration-300 ease-out"
    :class="(dragging || data.justAdded) ? 'builder-drag-glow' : selected ? 'ring-2 ring-primary shadow-lg' : ''"
    :style="size"
    data-handoff="board-node"
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
</style>
