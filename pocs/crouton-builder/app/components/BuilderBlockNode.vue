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
import { computed } from 'vue'
import type { LayoutNode, LayoutBreakpoint } from '@fyit/crouton-core/app/types/layout'
import type { BuilderRegion } from '~/utils/builder-keys'

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

const size = computed(() => {
  const f = footprint(props.data.node)
  return { width: `${f.cols * BUILDER_BASE_W}px`, height: `${f.rows * BUILDER_BASE_H}px` }
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
</style>
