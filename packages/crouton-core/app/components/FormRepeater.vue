<script setup lang="ts">
import { collectionForms } from '#build/crouton-collection-forms.mjs'
import { nanoid } from 'nanoid'
import { useSortable } from '@vueuse/integrations/useSortable'
import type { SortableEvent } from 'sortablejs'

interface Props {
  modelValue: any[] | null | undefined
  componentName: string
  addLabel?: string
  sortable?: boolean
}

const { t } = useT()

const props = withDefaults(defineProps<Props>(), {
  addLabel: 'Add Item',
  sortable: true
})

const emit = defineEmits<{
  'update:modelValue': [value: any[]]
}>()

// Use ref for useSortable compatibility (per VueUse docs)
const items = ref<any[]>(props.modelValue || [])

const containerRef = ref<HTMLElement>()

// Track if we're currently emitting to prevent sync loops
const isEmitting = ref(false)

// Enable drag-to-reorder - useSortable mutates items ref directly on drag
useSortable(containerRef, items, {
  animation: 200,
  handle: '.drag-handle',
  ghostClass: 'opacity-50',
  disabled: !props.sortable,
  onUpdate: (event: SortableEvent) => moveItem(event.oldIndex!, event.newIndex!)
})

// One reorder path for drag and the row menu. The isEmitting guard stops the
// parent's echo of our own emit from resetting items mid-reorder.
function moveItem(from: number, to: number) {
  if (from === to || to < 0 || to >= items.value.length) return
  isEmitting.value = true

  const reordered = [...items.value]
  const movedItem = reordered.splice(from, 1)[0]
  reordered.splice(to, 0, movedItem)

  items.value = reordered
  emit('update:modelValue', reordered)

  nextTick(() => {
    isEmitting.value = false
  })
}

// Keyboard/touch reorder: announced to screen readers, focus follows the row
const announcement = ref('')
const focusAfterClose = ref<number | null>(null)

function moveByMenu(index: number, to: number) {
  moveItem(index, to)
  announcement.value = t('repeater.moved', { position: to + 1, total: items.value.length })
  focusAfterClose.value = to
}

function rowMenuItems(index: number) {
  const remove = {
    label: t('common.remove'),
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => removeItem(index)
  }
  if (!props.sortable || items.value.length < 2) return [[remove]]
  return [
    [
      {
        label: t('repeater.moveUp'),
        icon: 'i-lucide-arrow-up',
        disabled: index === 0,
        onSelect: () => moveByMenu(index, index - 1)
      },
      {
        label: t('repeater.moveDown'),
        icon: 'i-lucide-arrow-down',
        disabled: index === items.value.length - 1,
        onSelect: () => moveByMenu(index, index + 1)
      }
    ],
    [remove]
  ]
}

// Rows are keyed `item.id || index`, so look the row up by its new index.
// Escape returns focus to the same row; after Remove, to the row that took its place.
function onMenuCloseAutoFocus(event: Event, index: number) {
  event.preventDefault()
  const target = Math.min(focusAfterClose.value ?? index, items.value.length - 1)
  focusAfterClose.value = null
  nextTick(() => {
    containerRef.value?.children[target]
      ?.querySelector<HTMLElement>('[data-testid="repeater-row-menu"]')
      ?.focus()
  })
}

// Watch for external changes to props.modelValue and sync to items ref
// BUT don't break useSortable by creating new array references during our own emissions
watch(() => props.modelValue, (newVal) => {
  if (newVal && !isEmitting.value) {
    // Only sync if this is a true external change (not from our own emit)
    items.value = [...newVal]
  }
}, { deep: true })

const addItem = () => {
  const newItem = { id: nanoid() }
  items.value = [...items.value, newItem]
  emit('update:modelValue', items.value)
}

const removeItem = (index: number) => {
  items.value = items.value.filter((_, i) => i !== index)
  emit('update:modelValue', items.value)
}

const updateItem = (index: number, val: any) => {
  const newItems = [...items.value]
  newItems[index] = val
  items.value = newItems
  emit('update:modelValue', items.value)
}

// Repeater item from the build-time collection map (Nuxt's resolved winner)
const itemComponent = computed(() => collectionForms[props.componentName])

// A wrong repeater name is a bug in every environment: warn once per mount.
// The text is on the e2e console guard's fail list (e2e/console-guard.cjs).
onMounted(() => {
  if (!itemComponent.value) {
    console.warn(`[CroutonFormRepeater] Failed to resolve component: ${props.componentName} — check the component file exists in a layer's components dir and the name matches its canonical name (<Layer><Plural><Field>Input)`)
  }
})
</script>

<template>
  <!-- Empty state -->
  <UCard v-if="items.length === 0">
    <div class="text-center text-gray-500">
      {{ t('repeater.emptyState', { label: addLabel }) }}
    </div>
  </UCard>

  <!-- Items list -->
  <div
    ref="containerRef"
    class="space-y-2 mb-3"
  >
    <UCard
      v-for="(item, index) in items"
      :key="item.id || index"
      :ui="{ body: 'sm:p-2 p-2' }"
    >
      <!-- One row: handle · item · menu. Controls stay top-aligned and the
           item grows (flex-1 min-w-0), so multi-field items still fit and a
           long value can't push the menu button off a narrow screen. -->
      <div class="flex items-start gap-2">
        <!-- Drag handle (only if sortable) -->
        <UButton
          v-if="sortable"
          type="button"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-grip-vertical"
          class="drag-handle cursor-move shrink-0"
          :aria-label="t('form.dragToReorder')"
        />

        <!-- Item component -->
        <div class="flex-1 min-w-0">
          <component
            :is="itemComponent"
            v-if="itemComponent"
            :model-value="item"
            @update:model-value="(val: unknown) => updateItem(index, val)"
          />
          <UAlert
            v-else
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="t('repeater.componentMissing', { name: componentName })"
            data-testid="repeater-missing-component"
          />
        </div>

        <!-- Row menu: Move up / Move down / Remove -->
        <!-- runtime-cost-ok: repeater rows are a short, user-built list; the menu items are per-row (move/remove by index) -->
        <UDropdownMenu
          :items="rowMenuItems(index)"
          :content="{ align: 'end', onCloseAutoFocus: (e: Event) => onMenuCloseAutoFocus(e, index) }"
        >
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-ellipsis-vertical"
            class="shrink-0"
            data-testid="repeater-row-menu"
            :aria-label="t('repeater.actions', { position: index + 1, total: items.length })"
          />
        </UDropdownMenu>
      </div>
    </UCard>
  </div>

  <!-- Outside containerRef: Sortable treats every child there as a row -->
  <div
    class="sr-only"
    aria-live="polite"
    data-testid="repeater-live"
  >
    {{ announcement }}
  </div>

  <!-- Add button -->
  <UButton
    type="button"
    color="primary"
    variant="outline"
    block
    @click="addItem"
  >
    <template #leading>
      <UIcon name="i-lucide-plus" />
    </template>
    {{ addLabel }}
  </UButton>
</template>
