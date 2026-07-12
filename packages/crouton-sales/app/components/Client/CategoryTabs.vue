<template>
  <!-- Helper POS / workspace lists: plain UTabs (read-only, no drag).
       min-w-fit keeps every label readable: tabs stretch when they fit and
       the row scrolls horizontally when they don't (instead of all tabs
       shrinking to single letters on narrow screens). -->
  <UTabs
    v-if="!sortableMode"
    :model-value="modelValue ?? fallbackValue"
    :items="tabItems"
    :content="false"
    :ui="{ list: 'overflow-x-auto', trigger: 'flex-1 min-w-fit' }"
    @update:model-value="onTabChange"
  />

  <!-- Admin POS: a custom tab row that Vue and SortableJS co-own (same
       pattern as ProductList). UTabs can't be dragged safely — Reka UI's
       animated indicator element gets measured against DOM that Sortable
       just moved, which breaks the tab styling on drop. -->
  <ul
    v-else
    ref="listEl"
    role="tablist"
    class="flex w-full items-center gap-1 rounded-lg bg-elevated p-1 overflow-x-auto"
  >
    <li
      v-for="cat in orderedCategories"
      :key="cat.id"
      role="tab"
      tabindex="0"
      :aria-selected="isActive(cat.id)"
      class="group/tab flex-1 min-w-fit flex items-center justify-center gap-1.5 rounded-md
             px-3 py-1.5 text-sm font-medium cursor-pointer select-none transition-colors"
      :class="isActive(cat.id)
        ? 'bg-primary text-inverted'
        : 'text-muted hover:text-highlighted hover:bg-elevated/60'"
      @click="onTabChange(cat.id)"
      @keydown.enter.self="onTabChange(cat.id)"
    >
      <!-- Drag grip (left, hover-revealed; the only drag surface) -->
      <span
        class="tab-drag-handle inline-flex items-center
               opacity-0 group-hover/tab:opacity-100 pointer-coarse:opacity-100 transition-opacity"
        :class="reorderPending ? 'cursor-wait opacity-40!' : 'cursor-grab active:cursor-grabbing'"
        @click.stop
      >
        <UIcon name="i-lucide-grip-vertical" class="size-3.5" />
      </span>

      <!-- Label, or the inline rename input -->
      <input
        v-if="editingId === cat.id"
        :ref="setEditInput"
        v-model="editingTitle"
        type="text"
        class="bg-transparent outline-none text-center min-w-0 w-28 border-b border-current/40"
        @click.stop
        @keydown.enter.stop.prevent="commitEdit"
        @keydown.esc.stop.prevent="cancelEdit"
        @blur="commitEdit"
      >
      <span v-else class="truncate">{{ withCount(cat.title, counts?.[cat.id] || 0) }}</span>

      <!-- Delete (rename mode only): two-step — first tap arms, second deletes.
           mousedown.prevent keeps the input focused so the click lands. -->
      <span
        v-if="editingId === cat.id"
        role="button"
        :aria-label="confirmDeleteId === cat.id ? t('sales.common.remove') : t('common.delete')"
        class="inline-flex items-center justify-center size-6 rounded-full shrink-0 active:scale-95 transition-all"
        :class="confirmDeleteId === cat.id ? 'bg-error text-inverted' : 'bg-black/15 hover:bg-black/30'"
        @mousedown.stop.prevent
        @click.stop="onDeleteClick(cat.id)"
      >
        <UIcon :name="confirmDeleteId === cat.id ? 'i-lucide-check' : 'i-lucide-trash-2'" class="size-3.5" />
      </span>

      <!-- Rename pencil (right, active tab only) -->
      <span
        v-if="isActive(cat.id) && editingId !== cat.id"
        role="button"
        :aria-label="t('common.edit')"
        class="inline-flex items-center justify-center size-6 rounded-full shrink-0
               bg-black/15 hover:bg-black/30 active:scale-95 transition-all
               opacity-0 group-hover/tab:opacity-100 pointer-coarse:opacity-100"
        @click.stop="startEdit(cat.id)"
      >
        <UIcon name="i-lucide-pencil" class="size-3.5" />
      </span>
    </li>

    <!-- Draft tab: spawned by "+", commits on enter/blur/click-outside, vanishes if empty -->
    <li
      v-if="creating"
      role="presentation"
      class="flex-1 min-w-fit flex items-center justify-center rounded-md px-3 py-1.5
             text-sm font-medium bg-elevated/60 text-highlighted"
    >
      <input
        :ref="setDraftInput"
        v-model="draftTitle"
        type="text"
        class="bg-transparent outline-none text-center min-w-0 w-28 border-b border-current/40"
        @click.stop
        @keydown.enter.stop.prevent="commitCreate"
        @keydown.esc.stop.prevent="cancelCreate"
        @blur="commitCreate"
      >
    </li>

    <!-- Add category: starts a draft tab instead of opening a form -->
    <li role="presentation" class="shrink-0">
      <!-- UButton, not a raw button, so themes reach it (#1410) -->
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-plus"
        square
        class="size-8 justify-center text-muted hover:text-highlighted"
        :aria-label="t('sales.workspace.add')"
        @click="startCreate"
      />
    </li>
  </ul>
</template>

<script setup lang="ts">
import { useSortable } from '@vueuse/integrations/useSortable'
import type { TabsItem } from '@nuxt/ui'
const { t } = useT()
import type { SalesCategory } from '../../types'

const props = withDefaults(defineProps<{
  categories: SalesCategory[]
  modelValue: string | null
  // Count to badge on each tab, keyed by category id. Meaning is up to the
  // caller (cart quantity in the POS, product count in the admin workspace).
  // Hidden when zero.
  counts?: Record<string, number>
  // Show the leading "All" tab (default). Set false to force a category selection.
  showAll?: boolean
  // Admin POS: drag grip (left, hover) reorders tabs (emits 'reorder'); pencil
  // on the active tab renames inline (emits 'rename'). Only effective when
  // showAll is off, so indices map 1:1 onto categories.
  editable?: boolean
  // True while the parent is persisting a previous 'reorder'. Dragging is
  // disabled until it flips back — a drag started mid-save would be dropped
  // by the parent and snap back on the next refetch.
  reorderPending?: boolean
}>(), { showAll: true, counts: () => ({}) })

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  'rename': [payload: { id: string, title: string }]
  'create': [payload: { title: string }]
  'delete': [payload: { id: string }]
  'reorder': [updates: Array<{ id: string, order: number }>]
}>()

// The custom (draggable) row replaces UTabs only in the editable POS.
const sortableMode = computed(() => props.editable && !props.showAll)

// Local mutable copy that useSortable reorders in place on drop.
const orderedCategories = ref<SalesCategory[]>([])
watch(() => props.categories, (v) => { orderedCategories.value = [...(v || [])] }, { immediate: true })

const totalCount = computed(() =>
  Object.values(props.counts).reduce((sum, count) => sum + count, 0),
)

// Append a "(n)" badge only when there are items in the cart for that tab.
function withCount(label: string, count: number): string {
  return count > 0 ? `${label} (${count})` : label
}

const tabItems = computed<TabsItem[]>(() => {
  const items: TabsItem[] = []

  if (props.showAll) {
    items.push({
      label: withCount(t('sales.categories.all'), totalCount.value),
      value: 'all',
    })
  }

  for (const cat of orderedCategories.value) {
    items.push({
      label: withCount(cat.title, props.counts[cat.id] || 0),
      value: cat.id,
    })
  }

  return items
})

// When "All" is hidden, fall back to the first category instead of 'all'.
const fallbackValue = computed(() =>
  props.showAll ? 'all' : (orderedCategories.value[0]?.id ?? 'all'),
)

function isActive(categoryId: string): boolean {
  return (props.modelValue ?? fallbackValue.value) === categoryId
}

function onTabChange(value: string | number) {
  emit('update:modelValue', value === 'all' ? null : String(value))
}

// --- Inline rename (editable POS) -------------------------------------------
// The pencil swaps the active tab's label for an input; enter/blur commits
// (emits 'rename' for the parent to persist), esc cancels.
const editingId = ref<string | null>(null)
const editingTitle = ref('')

function startEdit(categoryId: string) {
  const cat = orderedCategories.value.find(c => c.id === categoryId)
  if (!cat) return
  editingId.value = categoryId
  editingTitle.value = cat.title
}

// Template refs double as autofocus + click-outside anchors. Blur alone can't
// close these inputs: programmatic focus() is ignored on touch devices outside
// a direct tap handler, so an untouched input never receives focus and never
// blurs — onClickOutside below covers that path.
const editInputEl = ref<HTMLInputElement | null>(null)
const draftInputEl = ref<HTMLInputElement | null>(null)

function setEditInput(el: unknown) {
  const input = el instanceof HTMLInputElement ? el : null
  if (input && input !== editInputEl.value) input.focus()
  editInputEl.value = input
}

function setDraftInput(el: unknown) {
  const input = el instanceof HTMLInputElement ? el : null
  if (input && input !== draftInputEl.value) input.focus()
  draftInputEl.value = input
}

onClickOutside(editInputEl, commitEdit)
onClickOutside(draftInputEl, commitCreate)

function commitEdit() {
  // Blur fires after enter — the first commit clears editingId, so bail.
  if (!editingId.value) return
  const id = editingId.value
  const title = editingTitle.value.trim()
  const original = orderedCategories.value.find(c => c.id === id)?.title
  editingId.value = null
  confirmDeleteId.value = null
  if (title && title !== original) {
    emit('rename', { id, title })
  }
}

function cancelEdit() {
  editingId.value = null
  confirmDeleteId.value = null
}

// Inline delete (two-step) — the trash in rename mode arms a confirm on the
// first tap, deletes on the second. `@mousedown.prevent` on the button keeps
// the rename input focused so its blur/click-outside doesn't exit edit mode
// before the click lands (same touch-focus reality the rename input handles).
const confirmDeleteId = ref<string | null>(null)
function onDeleteClick(id: string) {
  if (confirmDeleteId.value === id) {
    confirmDeleteId.value = null
    editingId.value = null
    emit('delete', { id })
  }
  else {
    confirmDeleteId.value = id
  }
}

// --- Inline create (editable POS) -------------------------------------------
// "+" spawns a draft tab with a focused input; a non-empty commit emits
// 'create' (parent persists + selects), an empty one just removes the draft.
const creating = ref(false)
const draftTitle = ref('')

function startCreate() {
  creating.value = true
  draftTitle.value = ''
}

function commitCreate() {
  if (!creating.value) return
  const title = draftTitle.value.trim()
  creating.value = false
  if (title) emit('create', { title })
}

function cancelCreate() {
  creating.value = false
}

// --- Tab drag-reorder (editable POS) ---------------------------------------
// Vue renders the row from orderedCategories and useSortable mutates the same
// array on drop — no separate indicator element to fall out of sync.
const listEl = ref<HTMLElement | null>(null)

const orderOf = (c: SalesCategory) => (c as any).displayOrder ?? 0

function emitNewOrder() {
  const updates: Array<{ id: string, order: number }> = []
  orderedCategories.value.forEach((c, index) => {
    if (orderOf(c) !== index) updates.push({ id: c.id, order: index })
  })
  if (updates.length) emit('reorder', updates)
}

if (import.meta.client && props.editable) {
  const sortable = useSortable(listEl, orderedCategories, {
    animation: 150,
    handle: '.tab-drag-handle',
    // Only real tabs are sortable — the draft tab and the "+" li are
    // role="presentation" and must not shift the index mapping.
    draggable: '[role="tab"]',
    ghostClass: 'opacity-50',
    disabled: props.reorderPending,
    // useSortable syncs the bound `orderedCategories` array on nextTick (async),
    // so read it AFTER the tick — reading synchronously here sees the pre-drag
    // order, diffs to zero changes, and the reorder never persists (#1550).
    onEnd: async (evt: { oldIndex?: number, newIndex?: number }) => {
      if (evt.oldIndex === evt.newIndex) return
      await nextTick()
      emitNewOrder()
    }
  })
  watch(() => props.reorderPending, (pending) => {
    sortable.option('disabled', !!pending)
  })
}
</script>
