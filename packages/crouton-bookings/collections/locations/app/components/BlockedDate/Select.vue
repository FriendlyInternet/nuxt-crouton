<template>
  <div>
    <div v-if="pending" class="flex items-center gap-2 text-sm text-gray-500">
      <UIcon name="i-lucide-refresh-cw" class="animate-spin" />
      Loading options...
    </div>

    <div v-else-if="error" class="text-sm text-red-500">
      Failed to load options
    </div>

    <div v-else-if="!dependentValue" class="text-sm text-gray-500">
      {{ dependentLabel }} required
    </div>

    <div v-else-if="!options || options.length === 0" class="text-sm text-gray-500">
      No options available
    </div>

    <CroutonFormDependentSelectOption
      v-else
      v-model="localValue"
      :options="options"
      :multiple="multiple"
      dependent-collection="bookingsLocations"
      dependent-field="blockedDates"
      :card-variant="cardVariant"
    />
  </div>
</template>

<script setup lang="ts">
interface Option {
  id: string
  label: string
  value?: string
}

interface Props {
  modelValue?: string[] | null     // Array for consistent handling
  options?: Option[]
  pending?: boolean
  error?: any
  dependentValue?: string | null
  dependentLabel?: string
  multiple?: boolean               // Support multiple selection
  cardVariant?: string             // Card size: 'Mini', 'Medium', 'Huge', etc.
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  options: () => [],
  pending: false,
  error: null,
  dependentValue: null,
  dependentLabel: 'Selection',
  multiple: false,
  cardVariant: 'Mini'
})

const emit = defineEmits<{
  'update:modelValue': [value: string[] | null]
}>()

// Local model for v-model binding
const localValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})
</script>
