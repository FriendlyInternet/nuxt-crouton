<template>
  <div class="flex flex-col gap-3 border-t border-default pt-4 mt-auto sm:flex-row sm:items-center sm:justify-between">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <!-- Rows-per-page selector: hidden on mobile to keep the footer lean -->
      <span class="hidden text-sm text-muted sm:inline">{{ t('table.rowsPerPageColon') }}</span>
      <USelect
        :aria-label="tString('table.rowsPerPage')"
        :model-value="pageCount"
        :items="pageSizeItems"
        class="hidden w-20 sm:block"
        size="xs"
        @update:model-value="handlePageCountChange"
      />
      <!-- Compact count on mobile -->
      <span class="text-sm text-muted sm:hidden">
        <span class="font-medium">{{ pageFrom }}</span>–<span class="font-medium">{{ pageTo }}</span>
        / <span class="font-medium">{{ totalItems }}</span>
      </span>
      <!-- Full sentence on larger screens -->
      <span class="hidden text-sm text-muted sm:inline">
        {{ t('table.showing') }}
        <span class="font-medium">{{ pageFrom }}</span>
        {{ t('table.to') }}
        <span class="font-medium">{{ pageTo }}</span>
        {{ t('table.of') }}
        <span class="font-medium">{{ totalItems }}</span>
        {{ t('table.results') }}
      </span>
    </div>

    <div class="flex items-center justify-end gap-1.5">
      <UPagination
        :page="page"
        :items-per-page="pageCount"
        :total="totalItems"
        :disabled="loading"
        @update:page="handlePageChange"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { TablePaginationProps } from '../types/table'

const { t, tString } = useT()

const props = withDefaults(defineProps<TablePaginationProps>(), {
  loading: false,
  pageSizes: () => [5, 10, 20, 30, 40]
})

const emit = defineEmits<{
  'update:page': [value: number]
  'update:pageCount': [value: number]
}>()

const pageSizeItems = computed(() =>
  props.pageSizes?.map(size => ({
    label: String(size),
    value: size
  })) || []
)

const pageFrom = computed(() => {
  if (props.totalItems === 0) return 0
  return (props.page - 1) * props.pageCount + 1
})

const pageTo = computed(() => {
  return Math.min(props.page * props.pageCount, props.totalItems)
})

const handlePageChange = (value: number) => {
  emit('update:page', value)
}

const handlePageCountChange = (value: number) => {
  emit('update:pageCount', value)
}
</script>
