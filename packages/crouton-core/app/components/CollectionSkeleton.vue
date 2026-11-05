<script setup lang="ts">
/**
 * CroutonCollectionSkeleton
 *
 * Layout-aware loading placeholder for the collection viewer. Rendered as the
 * <Suspense> fallback while the async generated List component resolves its
 * data, so the viewer shows one calm, centered shimmer (sized to match the real
 * layout, avoiding a jump) and then reveals the fully-populated result at once —
 * instead of an empty table that fills in row-by-row.
 *
 * `layout` is a plain string (not LayoutType) so it accepts the viewer's wider
 * set, including the 'cards' grid-size alias.
 */
const props = withDefaults(defineProps<{
  layout?: string
  rows?: number
}>(), {
  layout: 'table',
  rows: 6
})

// Grid/card layouts share a card-grid skeleton; everything else falls back to rows.
const { t } = useT()

const isGrid = computed(() => props.layout === 'grid' || props.layout === 'cards')
</script>

<template>
  <div
    class="h-full w-full p-4"
    role="status"
    aria-busy="true"
    :aria-label="t('common.loading')"
  >
    <!-- Toolbar (search + actions) to match the real table header height -->
    <div class="flex items-center gap-2 mb-4">
      <USkeleton class="h-9 flex-1 min-w-0 rounded-md" />
      <USkeleton class="h-9 w-9 rounded-md shrink-0" />
    </div>

    <!-- Grid / cards layout -->
    <div
      v-if="isGrid"
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <div
        v-for="i in rows"
        :key="i"
        class="flex flex-col gap-3 p-4 border border-default rounded-lg"
      >
        <USkeleton class="h-32 w-full rounded-md" />
        <USkeleton class="h-5 w-3/4 rounded" />
        <USkeleton class="h-4 w-1/2 rounded" />
      </div>
    </div>

    <!-- Table / list layout -->
    <div
      v-else
      class="flex flex-col gap-1"
    >
      <!-- Header row -->
      <div class="flex items-center gap-4 px-2 py-3 border-b border-default">
        <USkeleton class="h-4 w-4 rounded shrink-0" />
        <USkeleton class="h-4 w-1/4 rounded" />
        <USkeleton class="h-4 w-1/3 rounded" />
        <USkeleton class="h-4 w-1/5 rounded ml-auto" />
      </div>

      <!-- Body rows -->
      <div
        v-for="i in rows"
        :key="i"
        class="flex items-center gap-4 px-2 py-4 border-b border-default/60"
      >
        <USkeleton class="h-4 w-4 rounded shrink-0" />
        <USkeleton class="h-4 w-1/4 rounded" />
        <USkeleton class="h-4 w-1/3 rounded" />
        <USkeleton class="h-7 w-16 rounded-md ml-auto" />
      </div>
    </div>
  </div>
</template>
