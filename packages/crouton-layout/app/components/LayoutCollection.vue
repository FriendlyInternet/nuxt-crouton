<script setup lang="ts">
/**
 * CroutonLayoutCollection — a REAL data-bound list block (Sprint 4, #709).
 *
 * Placed by the deterministic layout pass (`composeDefaultLayout`) with a
 * `collection` in its config; renders that generated collection's actual rows
 * via `CroutonCollection`. Replaces the throwaway `LayoutSpikeList` placeholder.
 *
 * Container-responsive (#710): `@container` sizes the surface to ITS pane, not
 * the viewport. Tolerates a missing `collection` (a block just dragged from the
 * palette, before it's configured) — it shows a hint instead of fetching, so the
 * editor never trips on an undefined collection. The fetch itself is isolated in
 * `CroutonLayoutCollectionData` behind `<Suspense>`.
 */
withDefaults(defineProps<{
  collection?: string
  layout?: 'list' | 'grid' | 'table'
  /** Optional heading (the composer passes the collection label). */
  heading?: string
}>(), { layout: 'list' })
</script>

<template>
  <div class="@container h-full overflow-auto">
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
