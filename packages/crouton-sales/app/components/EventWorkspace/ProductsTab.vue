<script setup lang="ts">
import { useSortable } from '@vueuse/integrations/useSortable'
import type { SalesEvent } from '~~/layers/sales/collections/events/types'
import type { SalesProduct } from '~~/layers/sales/collections/products/types'

const props = defineProps<{ event: SalesEvent }>()

const { t } = useT()
const { open } = useCrouton()

const eventQuery = computed(() => ({ eventId: props.event.id }))

const { items: products, pending: productsPending } = await useCollectionQuery('salesProducts', { query: eventQuery })
const { items: categories } = await useCollectionQuery('salesCategories', { query: eventQuery })
const { items: locations } = await useCollectionQuery('salesLocations', { query: eventQuery })
const { items: printers } = await useCollectionQuery('salesPrinters', { query: eventQuery })

const selectedCategoryId = ref<string | null>(null)

// Admin products view has no "All" tab — default to the first category once loaded.
watch(categories, (cats) => {
  const list = (cats as { id: string }[] | null) || []
  const first = list[0]
  if (!selectedCategoryId.value && first) selectedCategoryId.value = first.id
}, { immediate: true })

// `order` is the sortable position column (a reserved field, not in the typed schema)
const orderOf = (p: SalesProduct) => Number((p as any).order ?? 0) || 0

const productCountsByCategory = computed(() => {
  const counts: Record<string, number> = {}
  const list = (products.value as SalesProduct[] | null) || []
  for (const p of list) {
    if (p.categoryId) counts[p.categoryId] = (counts[p.categoryId] || 0) + 1
  }
  return counts
})

const filteredProducts = computed(() => {
  const list = [...((products.value as SalesProduct[] | null) || [])]
  list.sort((a, b) => orderOf(a) - orderOf(b) || a.title.localeCompare(b.title))
  if (!selectedCategoryId.value) return list
  return list.filter(p => p.categoryId === selectedCategoryId.value)
})

// Local mutable copy that useSortable reorders in place on drop.
const orderedProducts = ref<SalesProduct[]>([])
watch(filteredProducts, (v) => { orderedProducts.value = [...v] }, { immediate: true })

const listEl = ref<HTMLElement | null>(null)
// Standardized sortable: persist the new visual order through the generated
// /reorder endpoint (order = index) instead of per-item PATCH.
const { reorderSiblings, reordering } = useTreeMutation('salesProducts')

async function persistOrder() {
  if (reordering.value) return
  const updates: Array<{ id: string, order: number }> = []
  orderedProducts.value.forEach((p, index) => {
    if (orderOf(p) !== index) updates.push({ id: p.id, order: index })
  })
  if (updates.length) await reorderSiblings(updates)
}

// useSortable mutates orderedProducts on drop, but only on nextTick (async),
// so read it AFTER the tick — reading synchronously in onEnd sees the pre-drag
// order, diffs to zero changes, and the reorder never persists (#1550).
if (import.meta.client) {
  useSortable(listEl, orderedProducts, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'opacity-50',
    chosenClass: 'bg-elevated',
    onEnd: async (evt: { oldIndex?: number, newIndex?: number }) => {
      if (evt.oldIndex === evt.newIndex) return
      await nextTick()
      persistOrder()
    }
  })
}

const categoryName = (id?: string) =>
  ((categories.value as { id: string, title: string }[] | null) || []).find(c => c.id === id)?.title

const locationName = (id?: string) =>
  id ? ((locations.value as { id: string, title: string }[] | null) || []).find(l => l.id === id)?.title : undefined

// Printers route per location, so a product's printer(s) = the active printers
// at its location. Joined into a comma-separated label (empty ⇒ nothing shown).
const printerLabel = (locationId?: string) => {
  if (!locationId) return undefined
  const list = ((printers.value as { locationId: string, title: string, isActive?: boolean }[] | null) || [])
    .filter(p => p.locationId === locationId && p.isActive !== false)
    .map(p => p.title)
  return list.length ? list.join(', ') : undefined
}

// Format prices in the event's currency.
const { format: formatPrice } = useSalesCurrency(() => props.event.currency)

function openCreateProduct() {
  open('create', 'salesProducts', [], 'slideover', { eventId: props.event.id })
}

function openEditProduct(id: string) {
  open('update', 'salesProducts', [id], 'slideover')
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <SalesClientCategoryTabs
        v-model="selectedCategoryId"
        :categories="(categories as any[]) || []"
        :counts="productCountsByCategory"
        :show-all="false"
      />
      <UButton color="primary" size="sm" icon="i-lucide-plus" @click="openCreateProduct">
        {{ t('sales.workspace.addProduct') }}
      </UButton>
    </div>

    <div v-if="productsPending" class="p-6 text-center text-muted">
      {{ t('sales.workspace.loadingProducts') }}
    </div>

    <ul
      v-else-if="orderedProducts.length > 0"
      ref="listEl"
      role="list"
      class="divide-y divide-default rounded-lg border border-default overflow-hidden"
    >
      <li
        v-for="product in orderedProducts"
        :key="product.id"
        class="group flex items-center gap-3 px-3 py-2.5 bg-default hover:bg-elevated/50 transition-all cursor-pointer"
        :class="{ 'opacity-50 hover:opacity-100': product.isActive === false }"
        @click="openEditProduct(product.id)"
      >
        <UIcon
          name="i-lucide-grip-vertical"
          class="drag-handle shrink-0 text-dimmed cursor-grab active:cursor-grabbing opacity-40 group-hover:opacity-100 transition-opacity"
          @click.stop
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="font-medium truncate">{{ product.title }}</span>
            <UBadge v-if="product.isActive === false" color="neutral" variant="subtle" size="xs">
              {{ t('sales.common.inactive') }}
            </UBadge>
            <UBadge v-if="product.hasOptions" color="primary" variant="subtle" size="sm" icon="i-lucide-list">
              {{ t('sales.form.options') }}
            </UBadge>
            <UBadge v-if="product.requiresRemark" color="warning" variant="subtle" size="sm" icon="i-lucide-message-square">
              {{ t('sales.form.remark') }}
            </UBadge>
          </div>
          <div class="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted mt-0.5">
            <span v-if="!selectedCategoryId && categoryName(product.categoryId)" class="truncate">
              {{ categoryName(product.categoryId) }}
            </span>
            <span v-if="locationName(product.locationId)" class="inline-flex items-center gap-1 min-w-0">
              <UIcon name="i-lucide-map-pin" class="size-3 shrink-0" />
              <span class="truncate">{{ locationName(product.locationId) }}</span>
            </span>
            <span v-if="printerLabel(product.locationId)" class="inline-flex items-center gap-1 min-w-0">
              <UIcon name="i-lucide-printer" class="size-3 shrink-0" />
              <span class="truncate">{{ printerLabel(product.locationId) }}</span>
            </span>
          </div>
        </div>
        <span class="shrink-0 font-medium tabular-nums">{{ formatPrice(product.price) }}</span>
        <UIcon
          name="i-lucide-chevron-right"
          class="shrink-0 text-dimmed opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </li>
    </ul>

    <div v-else class="p-12 text-center text-muted">
      <UIcon name="i-lucide-package" class="text-4xl mb-2" />
      <p>{{ t('sales.workspace.noProducts') }}{{ selectedCategoryId ? t('sales.workspace.inThisCategory') : '' }}</p>
      <UButton size="sm" variant="outline" class="mt-3" @click="openCreateProduct">
        {{ t('sales.workspace.addProduct') }}
      </UButton>
    </div>
  </div>
</template>
