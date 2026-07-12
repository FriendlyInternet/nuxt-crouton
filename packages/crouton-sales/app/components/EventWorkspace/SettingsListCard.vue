<script setup lang="ts">
/**
 * Compact editable list card for the event Settings tab
 * (categories / locations / printers).
 *
 * Rows reuse the POS product-card affordances: hovering slides a drag grip in
 * from the left (only when `orderField` is set) and an edit pencil in from the
 * right, with the row content padding inward so nothing is covered.
 * Reordering persists the visual index into `orderField` on each changed row.
 */
import { useSortable } from '@vueuse/integrations/useSortable'

interface ListRow {
  id: string
  title: string
  subtitle?: string
  /** Optional status dot before the title (e.g. printer online state). */
  led?: { class: string, label?: string }
  [key: string]: any
}

const props = defineProps<{
  title: string
  collection: string
  rows: ListRow[]
  pending?: boolean
  emptyLabel?: string
  /** Initial data for the create form (usually { eventId }). */
  createData?: Record<string, any>
  /** Enable drag-reorder, persisting the visual index into this field. */
  orderField?: string
}>()

const { t } = useT()
const { open } = useCrouton()
const { update } = useCollectionMutation(props.collection)

function openCreate() {
  open('create', props.collection, [], 'slideover', props.createData)
}

function openEdit(id: string) {
  open('update', props.collection, [id], 'slideover')
}

// Local mutable copy that useSortable reorders in place on drop.
const ordered = ref<ListRow[]>([])
watch(() => props.rows, (v) => { ordered.value = [...(v || [])] }, { immediate: true })

const listEl = ref<HTMLElement | null>(null)

async function persistOrder(list: typeof ordered.value) {
  const field = props.orderField
  if (!field) return
  const changed = list
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => (row[field] ?? 0) !== index)
  await Promise.all(changed.map(({ row, index }) => update(row.id, { [field]: index })))
}

// Apply SortableJS's move (oldIndex → newIndex) to a copy of the list.
function withMove(list: typeof ordered.value, from: number, to: number) {
  const next = [...list]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return next
  next.splice(to, 0, moved)
  return next
}

if (import.meta.client && props.orderField) {
  useSortable(listEl, ordered, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'opacity-50',
    // Derive the new order from the drag event itself — SortableJS's
    // oldIndex/newIndex are the source of truth. (Don't read the bound array
    // here: useSortable syncs it on nextTick, so at this point it's still the
    // pre-drag order — which is exactly why we apply the move to it, #1550.)
    onEnd: (evt: { oldIndex?: number, newIndex?: number }) => {
      const { oldIndex, newIndex } = evt
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return
      persistOrder(withMove(ordered.value, oldIndex, newIndex))
    }
  })
}
</script>

<template>
  <UCard :ui="{ body: 'p-2 sm:p-3' }">
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <h3 class="font-semibold">{{ title }}</h3>
        <div class="flex items-center gap-2">
          <slot name="header-actions" />
          <UButton size="xs" variant="outline" icon="i-lucide-plus" @click="openCreate">
            {{ t('sales.common.add') }}
          </UButton>
        </div>
      </div>
    </template>

    <div v-if="pending" class="p-4 text-center text-muted text-sm">
      {{ t('sales.common.loading') }}
    </div>
    <ul v-else-if="ordered.length" ref="listEl" class="flex flex-col gap-1">
      <li
        v-for="row in ordered"
        :key="row.id"
        class="group/row relative overflow-hidden rounded-lg bg-elevated/40 hover:bg-elevated/70 transition-colors"
      >
        <div
          v-if="orderField"
          class="absolute left-0 top-0 bottom-0 z-10 flex items-center px-1.5
                 transition-transform duration-200 ease-out -translate-x-full group-hover/row:translate-x-0
                 pointer-coarse:translate-x-0"
        >
          <UIcon
            name="i-lucide-grip-vertical"
            class="drag-handle size-4 text-muted cursor-grab active:cursor-grabbing"
          />
        </div>
        <button
          type="button"
          class="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center px-2.5
                 bg-elevated/95 hover:bg-elevated text-muted hover:text-highlighted cursor-pointer
                 transition-all duration-200 ease-out translate-x-full group-hover/row:translate-x-0
                 pointer-coarse:translate-x-0"
          :aria-label="t('common.edit')"
          @click.stop="openEdit(row.id)"
        >
          <UIcon name="i-lucide-pencil" class="size-4" />
        </button>
        <div
          class="px-3 py-2 transition-[padding] duration-200 ease-out group-hover/row:pe-9 pointer-coarse:pe-9"
          :class="orderField ? 'group-hover/row:ps-7 pointer-coarse:ps-7' : ''"
        >
          <div class="flex items-center gap-2 min-w-0">
            <UTooltip v-if="row.led" :text="row.led.label">
              <span class="size-2 rounded-full shrink-0" :class="row.led.class" />
            </UTooltip>
            <p class="text-sm font-medium truncate">{{ row.title }}</p>
          </div>
          <p v-if="row.subtitle" class="text-xs text-muted truncate" :class="row.led ? 'ps-4' : ''">{{ row.subtitle }}</p>
        </div>
      </li>
    </ul>
    <div v-else class="p-4 text-center text-muted text-sm">
      {{ emptyLabel || t('sales.common.none') }}
    </div>

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UCard>
</template>
