<script setup lang="ts">
/**
 * CroutonPagesBlocksRenderPaneBlock — the bridge block (#716).
 *
 * A `paneBlock` is an ordinary TipTap content block that sits in the page
 * document flow, but instead of rendering prose it hosts a *pane layout*: its
 * `attrs.layout` is a `LayoutTree` (the same "layout is data" shape the standalone
 * layout engine persists), and we delegate rendering to `CroutonLayoutRenderer`
 * (crouton-core), which composes `croutonLayoutBlocks` surfaces.
 *
 * This is what makes "a pane can live inside a page" true without a new page type
 * or a new persistence path — the pane tree serializes into the page's existing
 * `content` JSON like any other block.
 *
 * Security: `attrs.layout` is untrusted page content. We run it through the pure
 * `sanitizeLayoutTree` shape gate (auto-imported from crouton-core) before it
 * reaches the renderer; the renderer then allowlists each leaf's `blockId`
 * against the registry and sanitizes per-block config. An invalid tree renders a
 * safe fallback, never an arbitrary component.
 */
import { computed } from 'vue'

interface Props {
  /** Block attrs from the TipTap doc — carries `layout` (LayoutTree) + optional `height`. */
  attrs?: Record<string, any>
  isFirst?: boolean
}
const props = defineProps<Props>()

// Validated tree (or null → fallback). `sanitizeLayoutTree` is the crouton-core
// shape guard; its return type (LayoutTree | null) is inferred via auto-import.
const tree = computed(() => sanitizeLayoutTree(props.attrs?.layout))

// Pane layouts need an explicit height in document flow (Splitter panes are
// height-driven). Clamp the authored value to a sane range; default to 480px.
const height = computed<number>(() => {
  const h = Number(props.attrs?.height)
  return Number.isFinite(h) && h >= 160 && h <= 2000 ? h : 480
})
</script>

<template>
  <div
    v-if="tree"
    class="pane-block rounded-xl border border-default overflow-hidden"
    :style="{ height: `${height}px` }"
  >
    <!-- View mode: a published page is served, not authored — render at the
         breakpoint-resolved sizes with no draggable dividers (#937). -->
    <CroutonLayoutRenderer :node="tree.root" :interactive="false" />
  </div>

  <!-- Invalid / missing layout tree — safe, legible fallback (never a raw error) -->
  <div
    v-else
    class="pane-block-empty flex items-center justify-center rounded-xl border border-dashed border-default p-8 text-sm text-muted text-center"
  >
    <span>
      <UIcon name="i-lucide-layout-template" class="size-6 mb-2 mx-auto block" />
      {{ $t('pages.paneBlock.invalid', 'This pane layout could not be rendered.') }}
    </span>
  </div>
</template>
