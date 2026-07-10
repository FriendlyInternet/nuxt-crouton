<template>
  <div class="w-full">
    <!-- Error state -->
    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-alert-triangle"
      :title="t('errors.unableToLoad')"
      :description="getErrorMessage()"
      class="mb-2"
    />

    <!-- Select menu (single or multiple) -->
    <USelectMenu
      v-model="selected"
      :items="items"
      value-key="id"
      :label-key="labelKey"
      :placeholder="t('reference.selectPlaceholder', { label: label || collection })"
      :loading="pending || inlineCreating"
      :filter-fields="filterFields"
      :disabled="!!error"
      :multiple="multiple"
      :create-item="inlineCreate"
      size="xl"
      searchable
      class="w-full"
      @create="handleInlineCreate"
    >
      <!-- Explicitly show the selected value label since value-key returns ID, not object -->
      <template #default="{ modelValue }">
        <span v-if="modelValue && !multiple" class="truncate">
          {{ getItemLabel(modelValue as string) }}
        </span>
        <span v-else-if="modelValue && multiple && (modelValue as string[]).length > 0" class="truncate">
          {{ (modelValue as string[]).map(id => getItemLabel(id)).join(', ') }}
        </span>
        <span v-else class="text-dimmed truncate">
          {{ t('reference.selectPlaceholder', { label: label || collection }) }}
        </span>
      </template>

      <template #item-label="{ item }">
        <span class="inline-flex items-center gap-1.5">
          <span class="truncate">{{ tContent(item, labelKey) || (item as Record<string, any>)?.id }}</span>
          <UButton
            v-if="showEdit"
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="t('actions.edit')"
            @click.stop.prevent="handleEdit((item as Record<string, any>)?.id)"
          />
        </span>
      </template>

      <template #create-item-label="{ item }">
        {{ t('reference.createNamed', { params: { name: item } }) }}
      </template>

      <template #empty="{ searchTerm }">
        {{ searchTerm
          ? t('reference.noResults', { searchTerm })
          : t('reference.noData', { label: (label || collection).toLowerCase() }) }}
      </template>

      <template #content-top>
        <div class="p-1">
          <UButton
            v-if="!hideCreate"
            color="neutral"
            icon="i-lucide-plus"
            variant="soft"
            block
            @click="handleCreate"
          >
            {{ t('reference.createNew', { label: label || collection }) }}
          </UButton>
        </div>
      </template>
    </USelectMenu>
  </div>
</template>

<script setup lang="ts">
import type { ComputedRef, Ref } from 'vue'

interface Props {
  modelValue: string | string[] | null | undefined
  collection: string
  label?: string
  labelKey?: string
  filterFields?: string[]
  hideCreate?: boolean
  showEdit?: boolean
  /** Type-to-create: an unmatched search term shows an "Add \"<term>\"" row
   *  that creates the item inline (labelKey = term, plus createInitialData)
   *  and selects it — no slideover. Opt-in: only enable for collections where
   *  a bare label is a valid create payload. */
  inlineCreate?: boolean
  multiple?: boolean
  query?: ComputedRef<Record<string, any>> | Ref<Record<string, any>>
  // Initial data to seed the nested create form when "Create new" is clicked.
  // Lets a parent form pass context (e.g. { eventId }) so the new referenced
  // item inherits it instead of starting blank.
  createInitialData?: Record<string, any>
}

const props = withDefaults(defineProps<Props>(), {
  labelKey: 'title',
  filterFields: () => ['title'],
  multiple: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string | string[] | null]
}>()

const { open, close } = useCrouton()
const { t, tContent } = useT()

// Fetch items from the referenced collection (with optional query filter)
const { items, pending, refresh, error } = await useCollectionQuery(props.collection, {
  query: props.query
})

// Helper to get user-friendly error message
const getErrorMessage = () => {
  if (!error.value) return ''

  const status = error.value.statusCode || error.value.status

  if (status === 404) {
    return t('errors.notFound')
  }

  if (status === 403) {
    return t('errors.noPermission')
  }

  if (status >= 500) {
    return t('errors.serverError')
  }

  return error.value.statusMessage || t('errors.loadingData')
}

// Computed map for reactive label lookup - uses tContent to resolve translations
const itemLabelsMap = computed(() => {
  const map = new Map<string, string>()
  for (const item of items.value) {
    // Use tContent to resolve translated field, falls back to direct field access
    const label = tContent(item, props.labelKey) || item.id
    map.set(item.id, label)
  }
  return map
})

// Helper to get item label by ID (uses computed map for reactivity)
const getItemLabel = (id: string): string => {
  return itemLabelsMap.value.get(id) || id
}

// Instance-specific state to prevent cross-contamination between multiple forms
const localValue = ref<string | string[] | null>(
  props.multiple
    ? (Array.isArray(props.modelValue) ? props.modelValue : [])
    : (props.modelValue ?? null)
)

// Watch props.modelValue for external changes
watch(() => props.modelValue, (newValue) => {
  if (props.multiple) {
    localValue.value = Array.isArray(newValue) ? newValue : []
  } else {
    localValue.value = newValue ?? null
  }
})

// Computed v-model for two-way binding
// With value-key="id", USelectMenu expects the ID as modelValue
// It internally finds and displays the matching item
const selected = computed({
  get: () => {
    return localValue.value
  },
  set: (value: string | string[] | null) => {
    localValue.value = value
    emit('update:modelValue', value)
  }
})

// Track the initial items count to detect new items
const initialItemsCount = ref(items.value.length)
const isCreating = ref(false)

// Handle create button click
const handleCreate = () => {
  isCreating.value = true
  open('create', props.collection, [], 'slideover', props.createInitialData)
}

// Inline type-to-create (inlineCreate prop): create with the search term as
// the label and select the result, skipping the slideover form entirely.
const { create: createItem } = useCollectionMutation(props.collection)
const inlineCreating = ref(false)

async function handleInlineCreate(term: string) {
  const label = term.trim()
  if (!label || inlineCreating.value) return

  // create-item hides on exact matches, but Enter can still race a list
  // refresh — select the existing item instead of creating a duplicate.
  const existing = items.value.find(i => (tContent(i, props.labelKey) || '').trim().toLowerCase() === label.toLowerCase())
  if (existing) {
    selected.value = props.multiple
      ? [...(Array.isArray(localValue.value) ? localValue.value : []), existing.id]
      : existing.id
    return
  }

  inlineCreating.value = true
  try {
    const created = await createItem({ [props.labelKey]: label, ...props.createInitialData })
    if (created?.id) {
      selected.value = props.multiple
        ? [...(Array.isArray(localValue.value) ? localValue.value : []), created.id]
        : created.id
    }
  } finally {
    inlineCreating.value = false
  }
}

// Handle per-item edit button click. Mirrors create: opens the same slideover
// flow. Edited labels refresh live since useCollectionMutation invalidates the
// collection cache that backs `items`.
const handleEdit = (id: string) => {
  if (!id) return
  open('update', props.collection, [id], 'slideover')
}

// Watch for new items after creation
watch(() => items.value.length, async (newCount, oldCount) => {
  if (isCreating.value && newCount > oldCount) {
    // A new item was added - find it and select it
    const newItem = items.value[items.value.length - 1]
    if (newItem) {
      if (props.multiple) {
        const currentIds = localValue.value as string[]
        const updatedIds = [...currentIds, newItem.id]
        localValue.value = updatedIds
        emit('update:modelValue', updatedIds)
      } else {
        localValue.value = newItem.id
        emit('update:modelValue', newItem.id)
      }
      isCreating.value = false
    }
  }
})

// Refresh items when component mounts to ensure we have latest data
onMounted(() => {
  refresh()
})
</script>
