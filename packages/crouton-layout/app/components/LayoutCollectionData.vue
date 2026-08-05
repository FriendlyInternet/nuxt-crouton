<script setup lang="ts">
/**
 * CroutonLayoutCollectionData — the data-fetching inner of `CroutonLayoutCollection`
 * (Sprint 4, #709). Kept separate so the async `useCollectionQuery` lives behind a
 * `<Suspense>` the guard owns: a freshly dropped, not-yet-configured block never
 * triggers a fetch for an undefined collection.
 *
 * Two render contexts (#983, `collection-page-render`):
 *  - `admin` (default) — hands the rows to `CroutonCollection`, which FILLS its
 *    pane and scrolls internally (the working dashboard surface). Unchanged.
 *  - `page` — a CONTENT-SIZED render: shows `pageSize` rows at natural height with
 *    NO internal scrollbar, then a bounded viewer control (load-more / paginate /
 *    search), plus the display variant (rows / cards). An empty list collapses to
 *    a compact block, not a full-height void. Reuses the shared per-row card
 *    (`CroutonDefaultCard`) — the same card the admin list/grid render — so the
 *    page render stays inside the expressiveness boundary (no per-instance flex).
 */
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  collection: string
  /** Display variant. `list`/`grid` reflow gracefully in a pane; `table` needs more width. */
  layout?: 'list' | 'grid' | 'table'
  /** Which render context — see the block-level `LAYOUT_RENDER_CONTEXT_KEY`. */
  context?: 'admin' | 'page'
  /** Page-context: items shown before the viewer control. */
  pageSize?: number
  /** Page-context: the bounded viewer control. */
  viewer?: 'load-more' | 'paginate' | 'search'
}>(), { layout: 'list', context: 'admin', pageSize: 10, viewer: 'load-more' })

const { items, pending } = await useCollectionQuery(props.collection)
const all = computed<any[]>(() => items.value ?? [])

// --- Page-context bounded viewer (load-more / paginate / search) -----------------
// Search filters the full set (client-side over the row's own values — a preview
// render, so no server round-trip); paginate/load-more slice it.
const q = ref('')
const filtered = computed<any[]>(() => {
  if (props.viewer !== 'search' || !q.value.trim()) return all.value
  const needle = q.value.trim().toLowerCase()
  return all.value.filter(row => JSON.stringify(row).toLowerCase().includes(needle))
})

const shown = ref(props.pageSize) // load-more accumulator
const page = ref(1) // paginate cursor
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / props.pageSize)))

const rows = computed<any[]>(() => {
  const src = filtered.value
  if (props.viewer === 'paginate') {
    const start = (page.value - 1) * props.pageSize
    return src.slice(start, start + props.pageSize)
  }
  if (props.viewer === 'search') return src.slice(0, props.pageSize)
  return src.slice(0, shown.value) // load-more (default)
})

const remaining = computed(() => Math.max(0, all.value.length - shown.value))
const hasMore = computed(() => props.viewer === 'load-more' && remaining.value > 0)
function loadMore() { shown.value += props.pageSize }

const isEmpty = computed(() => !pending.value && all.value.length === 0)
const asCards = computed(() => props.layout === 'grid') // rows (list/table) vs cards (grid)
</script>

<template>
  <!-- ADMIN: fill the pane, scroll internally (unchanged). -->
  <CroutonCollection
    v-if="context !== 'page'"
    :collection="collection"
    :layout="layout"
    :rows="all"
    :loading="pending"
    create
    class="h-full"
  />

  <!-- PAGE: content-height, no internal scrollbar; bounded viewer control. -->
  <template v-else>
    <!-- empty → a small block, not a full-height void -->
    <div
      v-if="isEmpty"
      data-handoff="collection-empty"
      class="rounded-md border border-dashed border-default p-4 text-center text-sm text-muted"
    >
      No {{ collection }} yet
    </div>

    <div v-else>
      <!-- search box (top) -->
      <div v-if="viewer === 'search'" class="p-2">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          size="sm"
          placeholder="Search…"
          class="w-full"
        />
      </div>

      <!-- cards variant -->
      <div
        v-if="asCards"
        class="grid grid-cols-1 @sm:grid-cols-2 @2xl:grid-cols-3 gap-3 p-2"
      >
        <CroutonDefaultCard
          v-for="(row, i) in rows"
          :key="row.id || i"
          :item="row"
          layout="grid"
          :collection="collection"
        />
      </div>

      <!-- rows variant (list / table both render as a content-height row list) -->
      <ul v-else role="list" class="divide-y divide-default">
        <li
          v-for="(row, i) in rows"
          :key="row.id || i"
          class="px-3 py-2"
        >
          <CroutonDefaultCard
            :item="row"
            layout="list"
            :collection="collection"
          />
        </li>
      </ul>

      <!-- viewer control (bottom) -->
      <div v-if="hasMore" class="p-2 text-center">
        <UButton size="xs" variant="soft" color="neutral" @click="loadMore">
          Load more ({{ remaining }} more)
        </UButton>
      </div>
      <div v-else-if="viewer === 'paginate' && pageCount > 1" class="flex justify-center p-2">
        <UPagination
          v-model:page="page"
          :total="filtered.length"
          :items-per-page="pageSize"
          size="xs"
        />
      </div>
      <div v-else-if="viewer === 'search'" class="px-3 pb-2 text-xs text-muted">
        Showing {{ rows.length }} of {{ filtered.length }}<span v-if="filtered.length !== all.length"> (filtered from {{ all.length }})</span>
      </div>
    </div>
  </template>
</template>
