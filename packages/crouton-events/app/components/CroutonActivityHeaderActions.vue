<script setup lang="ts">
/**
 * Phone header actions for the Activité page (#4036): one button group of three icon-only
 * buttons — Actualiser, Filtres (with a count badge when a filter is on), Exporter (dropdown).
 */
const props = withDefaults(defineProps<{
  /** Number of active select filters (collection, action, person) */
  filterCount?: number
  exporting?: boolean
}>(), {
  filterCount: 0,
  exporting: false
})

const emit = defineEmits<{
  refresh: []
  filters: []
  export: [format: 'csv' | 'json']
}>()

const { t } = useI18n()

const exportItems = computed(() => [[
  { label: t('events.log.exportCsv'), icon: 'i-lucide-file-spreadsheet', onSelect: () => emit('export', 'csv') },
  { label: t('events.log.exportJson'), icon: 'i-lucide-file-json', onSelect: () => emit('export', 'json') }
]])
</script>

<template>
  <UFieldGroup class="crouton-activity-header-actions">
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-refresh-cw"
      :aria-label="t('events.log.refresh')"
      @click="emit('refresh')"
    />
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-sliders-horizontal"
      :aria-label="t('events.filters.open')"
      class="crouton-activity-filters-toggle"
      @click="emit('filters')"
    >
      <template
        v-if="props.filterCount"
        #trailing
      >
        <UBadge
          :label="props.filterCount"
          :aria-label="t('events.filters.activeCount', { n: props.filterCount }, props.filterCount)"
          size="sm"
          variant="solid"
          class="crouton-activity-filters-count"
        />
      </template>
    </UButton>
    <UDropdownMenu :items="exportItems">
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-download"
        :aria-label="t('events.log.export')"
        :loading="props.exporting"
      />
    </UDropdownMenu>
  </UFieldGroup>
</template>
