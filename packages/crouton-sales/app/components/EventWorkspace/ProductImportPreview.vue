<script setup lang="ts">
/**
 * The rehearsal half of the paste-import (#1657): what WOULD happen, before anything
 * is written. Split out of `ProductImportModal.vue` so neither template grows past
 * the size the complexity gate allows, and so the preview can be reasoned about
 * (and later reused) on its own.
 *
 * Presentational only — it renders the parse result and reports the user's
 * per-duplicate decisions upward; it never fetches or writes.
 */
import type { ParsedProductRow, RelationToCreate } from '../../utils/parse-product-paste'

const props = defineProps<{
  rows: ParsedProductRow[]
  relations: RelationToCreate[]
  /** 1-based rowIndexes of duplicates the user chose to create anyway. */
  forced: Set<number>
}>()

const emit = defineEmits<{ toggleForced: [rowIndex: number] }>()

const { t } = useT()

/**
 * One tally per status, as a list so the template renders them with a single `v-for`
 * rather than three near-identical conditional badges. `new` always shows (0 New is
 * meaningful — it says nothing will import); the other two only when non-zero.
 */
const tallies = computed(() => {
  const count = (s: ParsedProductRow['status']) => props.rows.filter(r => r.status === s).length
  return [
    { key: 'new', color: 'success' as const, icon: 'i-lucide-circle-check', n: count('new'), label: t('sales.import.statusNew', 'New') },
    { key: 'duplicate', color: 'warning' as const, icon: 'i-lucide-copy', n: count('warn-duplicate'), label: t('sales.import.statusDuplicate', 'Already exists') },
    { key: 'error', color: 'error' as const, icon: 'i-lucide-circle-x', n: count('error'), label: t('sales.import.statusError', 'Error') },
  ].filter(tally => tally.key === 'new' || tally.n > 0)
})

const relationSummary = computed(() => props.relations.map(r => r.title).join(', '))

const columns = computed(() => [
  { accessorKey: 'rowIndex', header: '#' },
  { accessorKey: 'title', header: t('sales.import.fieldTitle', 'Product name') },
  { accessorKey: 'price', header: t('sales.import.fieldPrice', 'Price') },
  { accessorKey: 'categoryTitle', header: t('sales.import.fieldCategory', 'Category') },
  { accessorKey: 'locationTitle', header: t('sales.import.fieldLocation', 'Location') },
  { accessorKey: 'status', header: t('sales.import.statusHeader', 'Status') },
])

/**
 * Status is carried by icon + text as well as colour — colour alone would leave a
 * colour-blind user unable to tell "will import" from "will be skipped".
 */
function badge(row: ParsedProductRow) {
  if (row.status === 'error') {
    return { color: 'error' as const, icon: 'i-lucide-circle-x', label: row.error ?? t('sales.import.statusError', 'Error') }
  }
  if (row.status === 'warn-duplicate') {
    return { color: 'warning' as const, icon: 'i-lucide-copy', label: t('sales.import.statusDuplicate', 'Already exists') }
  }
  return { color: 'success' as const, icon: 'i-lucide-circle-check', label: t('sales.import.statusNew', 'New') }
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="relations.length"
      color="warning"
      variant="soft"
      icon="i-lucide-triangle-alert"
      :title="t('sales.import.willCreateTitle', 'Will also be created')"
      :description="relationSummary"
    />

    <!-- Announced politely: the preview re-renders on every keystroke, so a live
         region on the whole table would be a screen-reader firehose. This summary
         is the one thing worth speaking. -->
    <div class="flex flex-wrap items-center gap-2 text-sm" aria-live="polite" aria-atomic="true">
      <UBadge v-for="tally in tallies" :key="tally.key" :color="tally.color" variant="soft" :icon="tally.icon">
        {{ tally.n }} {{ tally.label }}
      </UBadge>
    </div>

    <div class="overflow-x-auto border border-default rounded-lg">
      <UTable :data="rows" :columns="columns" :aria-label="t('sales.import.previewLabel', 'Import preview')">
        <template #status-cell="{ row }">
          <div class="flex items-center gap-2">
            <UBadge :color="badge(row.original).color" variant="soft" :icon="badge(row.original).icon">
              {{ badge(row.original).label }}
            </UBadge>
            <USwitch
              v-if="row.original.status === 'warn-duplicate'"
              :model-value="forced.has(row.original.rowIndex)"
              size="sm"
              :label="t('sales.import.createAnyway', 'Create anyway')"
              @update:model-value="emit('toggleForced', row.original.rowIndex)"
            />
          </div>
        </template>
      </UTable>
    </div>
  </div>
</template>
