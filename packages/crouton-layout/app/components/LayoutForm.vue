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
 */
withDefaults(defineProps<{
  collection?: string
  /** Optional heading (the composer passes the collection label). */
  heading?: string
}>(), {})
</script>

<template>
  <div class="@container h-full overflow-auto">
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
