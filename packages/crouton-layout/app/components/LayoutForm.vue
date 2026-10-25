<script setup lang="ts">
/**
 * CroutonLayoutForm — a REAL data-bound form block (Sprint 4, #709).
 *
 * The "detail" half of a master/detail layout: an always-visible create form for
 * the configured collection, rendered inline via `CroutonFormDynamicLoader`
 * (which resolves the generated `{Name}Form` by collection name). Replaces the
 * throwaway `LayoutSpikeForm` placeholder.
 *
 * Container-responsive (#710) and tolerant of a missing `collection` (a freshly
 * dropped, unconfigured block) — shows a hint instead of erroring. The loader is
 * synchronous (no fetch), so no `<Suspense>` is needed.
 *
 * Renders by context (#983, same split as `CroutonLayoutCollection`): `admin`
 * fills its pane and scrolls internally; `page` (a served page) is content-sized
 * — a `h-full` + `overflow-auto` block inside a content-sized grid row collapses
 * to nothing on WebKit (owner-reported on iOS, #2490), so the page render never
 * depends on a percentage height.
 */
import { computed, inject, ref, type Ref } from 'vue'
import { LAYOUT_RENDER_CONTEXT_KEY, type LayoutRenderContext } from '../composables/useCroutonLayoutRenderContext'

withDefaults(defineProps<{
  collection?: string
  /** Optional heading (the composer passes the collection label). */
  heading?: string
}>(), {})

const renderContext = inject<Ref<LayoutRenderContext>>(
  LAYOUT_RENDER_CONTEXT_KEY,
  ref<LayoutRenderContext>('admin'),
)
const isPage = computed(() => renderContext.value === 'page')
</script>

<template>
  <div class="@container" :class="isPage ? '' : 'h-full overflow-auto'">
    <div class="px-4 py-2 border-b border-default text-sm font-semibold">
      {{ heading || 'New' }}
    </div>

    <div v-if="collection" class="p-4">
      <CroutonFormDynamicLoader :collection="collection" action="create" />
    </div>

    <div
      v-else
      class="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center"
    >
      Configure a collection to show its form.
    </div>
  </div>
</template>
