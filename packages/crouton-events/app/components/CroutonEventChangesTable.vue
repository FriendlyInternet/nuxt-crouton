<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { EventChange, EventOperation } from '../types/events'

const props = defineProps<{
  changes: EventChange[]
  operation?: EventOperation
  /** Collection name — used to show each field's label instead of its raw name */
  collection?: string
}>()

const { t } = useI18n()
const { getConfig } = useCollections()

// Translate a label with the same missing-key fallback as AdminSidebar
function tLabel(label: string): string {
  const translated = t(label)
  if (!translated || (translated.startsWith('[') && translated.endsWith(']'))) return label
  return translated
}

const fieldLabels = computed(() => {
  const fields = props.collection ? getConfig(props.collection)?.fields : undefined
  return new Map((fields || []).map(f => [f.name, f.label]))
})

interface ChangeRow {
  field: string
  label: string
  display: ReturnType<typeof getChangeDisplay>
}

const rows = computed<ChangeRow[]>(() => (props.changes || []).map((change) => {
  const label = fieldLabels.value.get(change.fieldName)
  return {
    field: change.fieldName,
    label: label ? tLabel(label) : change.fieldName,
    display: getChangeDisplay(change)
  }
}))

const columns = computed<TableColumn<ChangeRow>[]>(() => {
  const cols: TableColumn<ChangeRow>[] = [{ accessorKey: 'label', header: t('events.changes.field') }]
  if (props.operation !== 'create') cols.push({ id: 'before', header: t('events.changes.before') })
  if (props.operation !== 'delete') {
    cols.push({ id: 'after', header: props.operation === 'create' ? t('events.changes.value') : t('events.changes.after') })
  }
  return cols
})
</script>

<template>
  <UTable
    class="crouton-event-changes-table"
    :data="rows"
    :columns="columns"
    :empty="t('events.changes.empty')"
    :ui="{ td: 'align-top whitespace-normal' }"
  >
    <template #label-cell="{ row }">
      <span
        class="font-medium"
        :title="row.original.field"
      >{{ row.original.label }}</span>
    </template>

    <template #before-cell="{ row }">
      <template v-if="row.original.display.hasOld">
        <pre
          v-if="row.original.display.isOldComplex"
          class="text-xs whitespace-pre-wrap text-error bg-error/10 rounded p-2 overflow-x-auto max-h-32"
        >{{ row.original.display.oldValue }}</pre>
        <span
          v-else
          class="text-xs text-error"
          :class="{ 'line-through': operation === 'update' }"
        >{{ row.original.display.oldValue }}</span>
      </template>
      <span
        v-else
        class="text-dimmed text-xs"
      >—</span>
    </template>

    <template #after-cell="{ row }">
      <template v-if="row.original.display.hasNew">
        <pre
          v-if="row.original.display.isNewComplex"
          class="text-xs whitespace-pre-wrap text-success bg-success/10 rounded p-2 overflow-x-auto max-h-32"
        >{{ row.original.display.newValue }}</pre>
        <span
          v-else
          class="text-xs text-success"
        >{{ row.original.display.newValue }}</span>
      </template>
      <span
        v-else
        class="text-dimmed text-xs"
      >—</span>
    </template>
  </UTable>
</template>
