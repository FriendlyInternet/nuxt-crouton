<template>
  <div class="flex items-center gap-1.5 w-full">
    <UInput
      :model-value="modelValue"
      icon="i-lucide-search"
      :placeholder="placeholder ?? t('table.searchPlaceholder')"
      class="w-full sm:max-w-sm"
      @update:model-value="handleSearch"
    />
  </div>
</template>

<script lang="ts" setup>
import { useDebounceFn } from '@vueuse/core'
import type { TableSearchProps } from '../types/table'

const props = withDefaults(defineProps<TableSearchProps>(), {
  placeholder: undefined,
  debounceMs: 300
})

const { t } = useT()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// Debounced search handler
const handleSearch = useDebounceFn((value: string) => {
  emit('update:modelValue', value)
}, props.debounceMs)
</script>
