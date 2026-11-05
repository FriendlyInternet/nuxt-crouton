<script setup lang="ts">
import { collectionForms } from '#build/crouton-collection-forms.mjs'
const { t } = useT()
/**
 * DependentFieldCardMini - Display dependent field values with proper resolution
 *
 * Resolves ID references from dependent fields to full objects by fetching the parent item
 * and looking up the options in its JSON array field.
 *
 * Example:
 * - Location has slots: [{id: '1', label: 'Morning'}, {id: '2', label: 'Afternoon'}]
 * - Booking has slot: ['1'] (ID reference)
 * - This component fetches location, resolves '1' to {id: '1', label: 'Morning'}
 * - Then displays using custom CardMini or fallback badges
 */

const props = defineProps<{
  value: string | string[] | null // ID(s) of selected option(s)
  dependentValue: string // Parent item ID (e.g., locationId)
  dependentCollection: string // Parent collection (e.g., 'bookingsLocations')
  dependentField: string // Field in parent (e.g., 'slots')
}>()

// Fetch parent item using useCollectionItem (cached automatically!)
const { item: parentItem, pending, error } = await useCollectionItem(
  props.dependentCollection,
  computed(() => props.dependentValue)
)

// Singularize function for component name resolution
const singularize = (word: string): string => {
  if (word.endsWith('ies')) {
    return word.slice(0, -3) + 'y' // entries → entry
  }
  if (word.endsWith('s')) {
    return word.slice(0, -1) // slots → slot
  }
  return word
}

// Resolve the Card component dynamically
const customComponent = computed(() => {
  const collectionPascal = props.dependentCollection
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

  const fieldSingular = singularize(props.dependentField)

  const fieldPascal = fieldSingular
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

  const componentName = `${collectionPascal}${fieldPascal}CardMini`

  return collectionForms[componentName] ?? null
})

// Resolve IDs to full objects from parent's field array
const resolvedItems = computed(() => {
  if (!parentItem.value || !props.value) return []

  const ids = Array.isArray(props.value) ? props.value : [props.value]
  const fieldData = parentItem.value[props.dependentField] || []

  const result = ids
    .map(id => fieldData.find((opt: any) => opt.id === id))
    .filter(Boolean)

  return result
})

// Check if we have items to display
const hasItems = computed(() => resolvedItems.value.length > 0)
</script>

<template>
  <!-- Use custom component if it exists -->
  <component
    :is="customComponent"
    v-if="customComponent && hasItems"
    :value="resolvedItems"
  />

  <!-- Fallback: default badges -->
  <div
    v-else
    class="text-sm"
  >
    <!-- Loading state -->
    <USkeleton
      v-if="pending"
      class="h-5 w-20"
    />

    <!-- Error state -->
    <span
      v-else-if="error"
      class="text-red-500 text-xs"
    >
      {{ t('errors.errorLoading') }}
    </span>

    <!-- Empty state -->
    <span
      v-else-if="!hasItems"
      class="text-gray-400"
    >
      —
    </span>

    <!-- Default rendering: badges with labels -->
    <div
      v-else
      class="flex flex-wrap gap-1"
    >
      <UBadge
        v-for="(item, index) in resolvedItems.slice(0, 3)"
        :key="index"
        color="neutral"
        variant="subtle"
      >
        {{ item.label || item.value || item.id }}
      </UBadge>
      <UBadge
        v-if="resolvedItems.length > 3"
        color="neutral"
        variant="subtle"
      >
        {{ t('common.moreCount', { count: resolvedItems.length - 3 }) }}
      </UBadge>
    </div>
  </div>
</template>
