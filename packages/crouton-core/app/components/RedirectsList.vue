<template>
  <CroutonCollection
    :layout="layout"
    collection="croutonRedirects"
    :columns="columns"
    :rows="redirects || []"
    :loading="pending"
  >
    <template #header>
      <CroutonTableHeader
        :title="$t('redirects.title')"
        :collection="'croutonRedirects'"
        createButton
      />
    </template>
    <template #statusCode-cell="{ row }">
      <UBadge
        :color="row.original.statusCode === '301' ? 'primary' : 'warning'"
        variant="subtle"
        size="sm"
      >
        {{ row.original.statusCode }}
      </UBadge>
    </template>
    <template #isActive-cell="{ row }">
      <CroutonBoolean :value="row.original.isActive" />
    </template>
    <template #fromPath-cell="{ row }">
      <span class="font-mono text-sm">{{ row.original.fromPath }}</span>
      <span class="text-[var(--ui-text-dimmed)] mx-1">&rarr;</span>
      <span class="font-mono text-sm">{{ row.original.toPath }}</span>
    </template>
  </CroutonCollection>
</template>

<script setup lang="ts">
import useCroutonRedirects from '../composables/useCroutonRedirects'

withDefaults(defineProps<{
  layout?: any
}>(), {
  layout: 'table'
})

const { t } = useT()
const { columns: baseColumns } = useCroutonRedirects()

// Column headers in the config are static English; translate them here
const columnHeaderKeys: Record<string, string> = {
  fromPath: 'redirects.columnFrom',
  toPath: 'redirects.columnTo',
  statusCode: 'redirects.columnStatus',
  isActive: 'redirects.active'
}
const columns = computed(() =>
  baseColumns.map(column => ({
    ...column,
    header: columnHeaderKeys[column.accessorKey] ? t(columnHeaderKeys[column.accessorKey]!) : column.header
  }))
)

const { items: redirects, pending } = await useCollectionQuery(
  'croutonRedirects'
)
</script>
