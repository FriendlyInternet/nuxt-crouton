<script setup lang="ts">
/**
 * CroutonLayoutCollection — a REAL data-bound list block (Sprint 4, #709).
 *
 * Placed by the deterministic layout pass (`composeDefaultLayout`) with a
 * `collection` in its config; renders that generated collection's actual rows
 * via `CroutonLayoutCollectionData`.
 *
 * Renders two ways by render context (#983, `collection-page-render`):
 *  - `admin` — FILLS its pane and scrolls internally (a working dashboard).
 *  - `page`  — a CONTENT-SIZED block: `pageSize` items + a bounded viewer
 *    control (load-more / paginate / search), NO internal scrollbar, so the
 *    page flows and scrolls as one document. Empty → a small block.
 *
 * Container-responsive (#710): `@container` sizes the surface to ITS pane, not
 * the viewport. Tolerates a missing `collection` (a block just dragged from the
 * palette, before it's configured) — it shows a hint instead of fetching, so the
 * editor never trips on an undefined collection. The fetch itself is isolated in
 * `CroutonLayoutCollectionData` behind `<Suspense>`.
 */
import { computed, inject, ref, type Ref } from 'vue'
import { LAYOUT_RENDER_CONTEXT_KEY, type LayoutRenderContext } from '../composables/useCroutonLayoutRenderContext'

const props = withDefaults(defineProps<{
  collection?: string
  /** Display variant for the rows (rows / cards / table). */
  layout?: 'list' | 'grid' | 'table'
  /** Optional heading (the composer passes the collection label). */
  heading?: string
  /** Page-context only: items shown before the viewer control (default 10). */
  pageSize?: number
  /** Page-context only: the bounded viewer control. */
  viewer?: 'load-more' | 'paginate' | 'search'
}>(), { layout: 'list', pageSize: 10, viewer: 'load-more' })

const renderContext = inject<Ref<LayoutRenderContext>>(
  LAYOUT_RENDER_CONTEXT_KEY,
  ref<LayoutRenderContext>('admin'),
)
const isPage = computed(() => renderContext.value === 'page')
</script>

<template>
  <!-- PAGE context: content-height, no internal scroll — the page scrolls as one. -->
  <div v-if="isPage" class="@container">
    <div
      v-if="heading"
      class="px-4 py-2 border-b border-default text-sm font-semibold"
    >
      {{ heading }}
    </div>

    <Suspense v-if="collection">
      <CroutonLayoutCollectionData
        context="page"
        :collection="collection"
        :layout="layout"
        :page-size="pageSize"
        :viewer="viewer"
      />
      <template #fallback>
        <div class="p-4 text-sm text-muted">Loading…</div>
      </template>
    </Suspense>

    <div
      v-else
      class="rounded-md border border-dashed border-default p-4 text-center text-sm text-muted"
    >
      Configure a collection to show its data.
    </div>
  </div>

  <!-- ADMIN context (default): fill the pane, scroll internally. Unchanged. -->
  <div v-else class="@container h-full overflow-auto">
    <div
      v-if="heading"
      class="px-4 py-2 border-b border-default text-sm font-semibold"
    >
      {{ heading }}
    </div>

    <Suspense v-if="collection">
      <CroutonLayoutCollectionData :collection="collection" :layout="layout" />
      <template #fallback>
        <div class="p-6 text-sm text-muted">Loading…</div>
      </template>
    </Suspense>

    <div
      v-else
      class="h-full flex items-center justify-center p-6 text-sm text-muted text-center"
    >
      Configure a collection to show its data.
    </div>
  </div>
</template>
