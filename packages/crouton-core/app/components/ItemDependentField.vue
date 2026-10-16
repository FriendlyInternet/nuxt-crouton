<script setup lang="ts">
const { t } = useT()
const props = defineProps<{
  valueId: string
  parentId: string
  parentCollection: string
  parentField: string
  displayField?: string // Optional: which field to display (defaults to 'label', then 'value', then 'id')
}>()

// Use the resolver composable to fetch and resolve the dependent field value
const { resolvedValue, pending, error } = await useDependentFieldResolver({
  valueId: computed(() => props.valueId),
  parentId: computed(() => props.parentId),
  parentCollection: props.parentCollection,
  parentField: props.parentField
})

// Determine which value to display
const displayValue = computed(() => {
  if (!resolvedValue.value) return null

  // Use specified display field if provided
  if (props.displayField && resolvedValue.value[props.displayField]) {
    return resolvedValue.value[props.displayField]
  }

  // Otherwise use sensible defaults: label > value > id
  return (
    resolvedValue.value.label
    || resolvedValue.value.value
    || resolvedValue.value.id
    || JSON.stringify(resolvedValue.value)
  )
})
</script>

<template>
  <div class="inline-block">
    <!-- Loading state -->
    <USkeleton
      v-if="pending"
      class="h-4 w-24"
    />

    <!-- Error state -->
    <span
      v-else-if="error"
      class="text-red-500 text-sm"
    >
      {{ t('errors.errorLoading') }}
    </span>

    <!-- No value found -->
    <span
      v-else-if="!resolvedValue"
      class="text-gray-400 text-sm italic"
    >
      {{ t('common.notFound') }}
    </span>

    <!-- Display resolved value -->
    <UBadge
      v-else
      color="neutral"
      variant="subtle"
      size="md"
      :ui="{ base: 'font-medium' }"
    >
      {{ displayValue }}
    </UBadge>
  </div>
</template>
