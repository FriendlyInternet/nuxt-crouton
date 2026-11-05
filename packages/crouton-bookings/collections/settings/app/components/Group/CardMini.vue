<template>
  <div class="text-sm">
    <template v-if="normalizedValue.length > 0">
      <div class="flex flex-wrap gap-1">
        <UBadge
          v-for="(item, index) in normalizedValue.slice(0, 3)"
          :key="index"
          color="neutral"
          variant="subtle"
        >
          {{ item.label || item.value || item }}
        </UBadge>
        <UBadge v-if="normalizedValue.length > 3" color="neutral" variant="subtle">
          +{{ normalizedValue.length - 3 }} more
        </UBadge>
      </div>
    </template>
    <span v-else class="text-gray-400">—</span>
  </div>
</template>

<script setup lang="ts">
interface Props {
  value?: any[] | any | null  // Can be array of objects OR single object OR null
}

const props = defineProps<Props>()

// Normalize to array for consistent handling
// Handles both source (repeater with array) and target (dependent field with resolved objects)
const normalizedValue = computed(() => {
  if (!props.value) return []
  return Array.isArray(props.value) ? props.value : [props.value]
})
</script>
