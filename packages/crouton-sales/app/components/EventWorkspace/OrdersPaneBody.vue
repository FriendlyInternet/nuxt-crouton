<script setup lang="ts">
/**
 * The orders pane's body — the `<Suspense>`-wrapped OrdersTab (#1846).
 *
 * Extracted because three places render exactly this: the Shell's desktop
 * splitter pane, the Shell's narrow-mode slideover, and PaneHost's deep-entry
 * modal. They must stay identical — OrdersTab is async-setup, so each host
 * needs its own Suspense boundary, and a host that forgot the fallback would
 * show a blank pane while the tab resolves.
 *
 * `filtersOpen` / `activeFilterCount` are passed straight through, because each
 * host owns its own header and hosts the filter toggle there.
 */
defineProps<{ event: Record<string, any> }>()

const filtersOpen = defineModel<boolean>('filtersOpen', { default: false })
const emit = defineEmits<{ 'update:activeFilterCount': [count: number] }>()

const { t } = useT()
</script>

<template>
  <Suspense>
    <SalesEventWorkspaceOrdersTab
      v-model:filters-open="filtersOpen"
      :event="event"
      @update:active-filter-count="emit('update:activeFilterCount', $event)"
    />
    <template #fallback>
      <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
    </template>
  </Suspense>
</template>
