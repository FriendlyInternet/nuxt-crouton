<script setup lang="ts">
/**
 * CroutonLayoutCollectionData — the data-fetching inner of `CroutonLayoutCollection`
 * (Sprint 4, #709). Kept separate so the async `useCollectionQuery` lives behind a
 * `<Suspense>` the guard owns: a freshly dropped, not-yet-configured block never
 * triggers a fetch for an undefined collection.
 *
 * Renders REAL rows of a generated collection (resolved by name through the live
 * collection registry), responsive to its pane via container queries on the
 * wrapping `CroutonLayoutCollection`. This is the production replacement for the
 * `LayoutSpikeList` placeholder.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  collection: string
  /** Display layout for the rows. `list`/`grid` reflow gracefully in a pane; `table` needs more width. */
  layout?: 'list' | 'grid' | 'table'
}>(), { layout: 'list' })

const { items, pending } = await useCollectionQuery(props.collection)
const rows = computed(() => items.value ?? [])
</script>

<template>
  <CroutonCollection
    :collection="collection"
    :layout="layout"
    :rows="rows"
    :loading="pending"
    create
    class="h-full"
  />
</template>
