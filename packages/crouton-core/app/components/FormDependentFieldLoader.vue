<template>
  <component
    :is="resolvedComponent"
    v-if="resolvedComponent"
    v-model="modelValue"
    :options="options"
    :pending="pending"
    :error="error"
    :dependent-value="dependentValue"
    :dependent-label="dependentLabel"
    :dependent-collection="dependentCollection"
    :dependent-field="dependentField"
    :multiple="multiple"
    :card-variant="cardVariant"
    v-bind="$attrs"
  />
  <div
    v-else
    class="text-sm text-red-500"
  >
    Component not found for field: {{ dependentField }}
  </div>
</template>

<script setup lang="ts">
import { collectionForms } from '#build/crouton-collection-forms.mjs'

interface Props {
  modelValue?: string[] | null
  dependentValue?: string | null
  dependentCollection: string
  dependentField: string
  dependentLabel?: string
  multiple?: boolean
  cardVariant?: string
  idKey?: string
  labelKey?: string
  valueKey?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  dependentValue: null,
  dependentLabel: 'Selection',
  multiple: false,
  cardVariant: 'Mini',
  idKey: 'id',
  labelKey: 'label',
  valueKey: 'value'
})

const emit = defineEmits<{
  'update:modelValue': [value: string[] | null]
}>()

// Get component maps from useCollections
const { dependentFieldComponentMap } = useCollections()

// Resolve custom component or fall back to default
const resolvedComponent = computed(() => {
  // Check if there's a custom component registered for this field
  const customComponent = dependentFieldComponentMap[props.dependentCollection]?.[props.dependentField]

  if (customComponent && Object.hasOwn(collectionForms, customComponent)) {
    return collectionForms[customComponent]
  }

  // Fall back to default FormDependentButtonGroup
  return resolveComponent('CroutonFormDependentButtonGroup')
})

// Reactive fetch of the dependent item when dependentValue changes
// Use computed ref to ensure proper reactivity tracking
const dependentId = computed(() => props.dependentValue || '')

const { item, pending, error } = await useCollectionItem(
  props.dependentCollection,
  dependentId
)

// Extract options from the dependent field
const options = computed(() => {
  if (!item.value || !props.dependentField) return []

  const fieldData = item.value[props.dependentField]

  if (!Array.isArray(fieldData)) return []

  // Map the field data to a consistent format
  return fieldData.map((option: any) => ({
    ...option, // Spread everything
    id: option[props.idKey] || option.id // Only normalize id
    // Remove label and value - let card components use actual properties
  }))
})

// Create a local model that syncs with parent
// Normalize empty strings to null for consistent type handling
const modelValue = computed({
  get: () => {
    // Normalize undefined/empty values to null for consistent type handling
    if (!props.modelValue || (Array.isArray(props.modelValue) && props.modelValue.length === 0)) {
      return null
    }
    return props.modelValue
  },
  set: value => emit('update:modelValue', value)
})

// Watch for dependent value changes and clear selection if it changes
watch(() => props.dependentValue, (newValue, oldValue) => {
  // If the dependent value changes and we have a selection, clear it
  if (oldValue && newValue !== oldValue && props.modelValue) {
    emit('update:modelValue', null)
  }
})

// Watch for options changes and clear selection if current value is not in options
watch(options, (newOptions) => {
  if (props.modelValue && newOptions.length > 0) {
    const isValid = newOptions.some(opt => opt.id === props.modelValue)
    if (!isValid) {
      emit('update:modelValue', null)
    }
  }
})
</script>
