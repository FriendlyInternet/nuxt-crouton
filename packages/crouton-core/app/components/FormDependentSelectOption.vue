<template>
  <div class="flex flex-wrap gap-2">
    <div
      v-for="option in options"
      :key="option.id"
      class="w-fit cursor-pointer transition-all"
      :class="[
        isSelected(option.id)
          ? 'ring-2 ring-primary-500 rounded-lg'
          : 'opacity-70 hover:opacity-100'
      ]"
      @click="handleSelect(option.id)"
    >
      <component
        :is="cardComponent"
        v-if="cardComponent"
        :value="option"
      />
      <UBadge
        v-else
        color="neutral"
        variant="subtle"
      >
        {{ option.label || option.value || option.id }}
      </UBadge>
    </div>
  </div>
</template>

<script setup lang="ts">
import { collectionForms } from '#build/crouton-collection-forms.mjs'
interface Option {
  id: string
  label?: string
  value?: string
  [key: string]: any
}

interface Props {
  modelValue?: string[] | null
  options?: Option[]
  multiple?: boolean
  dependentCollection: string
  dependentField: string
  cardVariant?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  options: () => [],
  multiple: false,
  cardVariant: 'Mini'
})

const emit = defineEmits<{
  'update:modelValue': [value: string[] | null]
}>()

// Simple singularization utility - removes trailing 's'
// Handles common cases: slots → slot, items → item, entries → entry
const singularize = (word: string): string => {
  // Handle common plural patterns
  if (word.endsWith('ies')) {
    return word.slice(0, -3) + 'y' // entries → entry
  }
  if (word.endsWith('s')) {
    return word.slice(0, -1) // slots → slot
  }
  return word
}

// Resolve the Card component dynamically
const cardComponent = computed(() => {
  // Build component name: Crouton{Collection}{Field}Card{Variant}
  // Use singular form for component naming convention
  // Example: field "slots" → component "Slot" → CroutonBookingsLocationsSlotCardMini
  const collectionPascal = props.dependentCollection
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

  // Convert field name to singular for component lookup
  const fieldSingular = singularize(props.dependentField)

  const fieldPascal = fieldSingular
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

  // Build component name WITHOUT "Crouton" prefix
  // Auto-imported components use their layer prefix (e.g., BookingsLocations)
  // NOT the Crouton prefix
  const componentName = `${collectionPascal}${fieldPascal}Card${props.cardVariant}`

  // Not in the map → null, the caller falls back to a badge
  return collectionForms[componentName] ?? null
})

// Check if an option is selected
const isSelected = (id: string): boolean => {
  return props.modelValue?.includes(id) ?? false
}

// Handle option selection
const handleSelect = (id: string) => {
  if (props.multiple) {
    // Multiple selection: toggle the ID in the array
    const current = props.modelValue || []
    const newValue = current.includes(id)
      ? current.filter(i => i !== id)
      : [...current, id]
    emit('update:modelValue', newValue.length > 0 ? newValue : null)
  } else {
    // Single selection: replace with new ID (still as array)
    const newValue = isSelected(id) ? null : [id]
    emit('update:modelValue', newValue)
  }
}
</script>
