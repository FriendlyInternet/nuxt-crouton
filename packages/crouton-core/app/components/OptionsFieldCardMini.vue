<script setup lang="ts">
const { t } = useT()
/**
 * OptionsFieldCardMini - Display options field values from a settings collection
 *
 * Resolves ID/value references from options fields by fetching the settings collection
 * and looking up the options in its repeater field.
 *
 * Example:
 * - Settings has groups: [{id: '1', value: 'kids', label: 'Kids'}, {id: '2', value: 'adults', label: 'Adults'}]
 * - Booking has group: 'kids' (value reference)
 * - This component fetches settings, resolves 'kids' to {value: 'kids', label: 'Kids'}
 * - Then displays the label in a badge
 *
 * Unlike DependentFieldCardMini, this fetches from a singleton settings collection
 * rather than a specific parent item ID.
 */

const props = defineProps<{
  value: string | string[] | null // Value(s) of selected option(s)
  optionsCollection: string // Settings collection (e.g., 'bookingsSettings')
  optionsField: string // Field in settings (e.g., 'groups')
}>()

// Fetch settings collection (typically a singleton per team)
const { items, pending, error } = await useCollectionQuery(props.optionsCollection)

// Get the first settings record (singleton pattern)
const settingsRecord = computed(() => items.value?.[0] || null)

// Extract options from the specific field
const options = computed(() => {
  if (!settingsRecord.value) return []
  const fieldData = settingsRecord.value[props.optionsField]
  if (!Array.isArray(fieldData)) return []
  return fieldData
})

// Resolve values to full objects from settings field array
const resolvedItems = computed(() => {
  if (!options.value.length || !props.value) return []

  const values = Array.isArray(props.value) ? props.value : [props.value]

  return values
    .map(val => {
      // Match by value, id, or label (in that order)
      return options.value.find((opt: any) =>
        opt.value === val || opt.id === val || opt.label === val
      )
    })
    .filter(Boolean)
})

// Check if we have items to display
const hasItems = computed(() => resolvedItems.value.length > 0)

// Get display label for an option item
const getLabel = (item: any): string => {
  return item.label || item.value || item.id || ''
}
</script>

<template>
  <div class="text-sm">
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
        {{ getLabel(item) }}
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
