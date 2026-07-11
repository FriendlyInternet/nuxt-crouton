<template>
  <div v-if="products.length === 0" class="text-center text-muted py-8">
    {{ t('sales.products.noProducts') }}
  </div>
  <div v-else ref="containerRef" class="flex flex-col gap-2">
    <UCard
      v-for="product in orderedProducts"
      :key="product.id"
      variant="soft"
      class="cursor-pointer group/card relative overflow-hidden"
      :class="product.isActive === false ? 'opacity-60' : ''"
      :ui="{ body: 'px-3 py-2 sm:px-3 sm:py-2' }"
      @click="handleProductClick(product)"
    >
      <!-- Admin affordances slide in from the card edges on hover (bookings-card
           pattern): reorder grip on the left, edit pencil on the right. -->
      <div
        v-if="editable"
        class="absolute left-0 top-0 bottom-0 z-10 flex items-center px-1.5
               transition-transform duration-200 ease-out -translate-x-full group-hover/card:translate-x-0
               pointer-coarse:translate-x-0"
      >
        <UIcon
          name="i-lucide-grip-vertical"
          class="drag-handle size-4 text-muted cursor-grab active:cursor-grabbing"
          @click.stop
        />
      </div>
      <!-- UButton, not a raw button, so themes reach it (#1410); the class
           list keeps the slide-out positioning + reveal behavior. -->
      <UButton
        v-if="editable"
        color="neutral"
        variant="ghost"
        icon="i-lucide-pencil"
        square
        class="absolute right-0 top-0 bottom-0 z-10 justify-center rounded-none px-2.5
               bg-elevated/95 hover:bg-elevated text-muted hover:text-highlighted
               transition-all duration-200 ease-out translate-x-full group-hover/card:translate-x-0
               pointer-coarse:translate-x-0"
        :aria-label="t('common.edit')"
        @click.stop="emit('edit', product.id)"
      />

      <!-- Hover pushes the content inward so the slide-out panels never cover
           the title or price. -->
      <div
        class="transition-[padding] duration-200 ease-out"
        :class="editable ? 'group-hover/card:ps-7 group-hover/card:pe-9 pointer-coarse:ps-7 pointer-coarse:pe-9' : ''"
      >
      <SalesClientOrderLineItem
        :title="product.title"
        :price="Number(product.price)"
      >
        <template #actions>
          <UBadge
            v-if="product.isActive === false"
            color="neutral"
            variant="subtle"
            size="sm"
            class="shrink-0"
          >
            {{ t('sales.common.inactive') }}
          </UBadge>
          <!-- md buttons: the whole card is tappable, but these are the visible
               affordances — keep them comfortably thumb-sized for the POS. -->
          <UButton
            v-if="isExpandable(product)"
            variant="ghost"
            color="neutral"
            size="md"
            square
            :icon="activeProductId === product.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            @click.stop="toggleProduct(product)"
          />
          <UButton
            v-else
            variant="ghost"
            color="primary"
            size="md"
            square
            class="active:scale-90 transition-transform"
            @click.stop="addProduct(product)"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-4 transition-transform"
              :class="poppedId === product.id ? 'animate-pop' : ''"
              @animationend="poppedId = null"
            />
          </UButton>
        </template>
      </SalesClientOrderLineItem>

      <!-- Expansion: options and/or a required per-item remark, inline in the card -->
      <Transition name="slide">
        <div
          v-if="activeProductId === product.id && isExpandable(product)"
          class="mt-2 pt-2.5 pb-1.5 border-t border-default space-y-2.5"
          @click.stop
        >
          <!-- Options -->
          <template v-if="hasOptions(product)">
            <!-- Multi-select: checkboxes -->
            <template v-if="isMultiSelect(product)">
              <UCheckbox
                v-for="option in getOptions(product)"
                :key="option.id"
                :model-value="isOptionSelected(product.id, option.id)"
                @update:model-value="toggleOption(product.id, option.id)"
              >
                <template #label>
                  <span class="flex items-center justify-between w-full">
                    <span>{{ option.label }}</span>
                    <span v-if="option.priceModifier > 0" class="text-xs text-muted ml-2">+{{ format(option.priceModifier) }}</span>
                  </span>
                </template>
              </UCheckbox>
            </template>

            <!-- Single-select with a required remark: pick one, then confirm
                 below. Card-variant radios — each option is a full tappable
                 card with a visible selected state. -->
            <URadioGroup
              v-else-if="product.requiresRemark"
              variant="card"
              :model-value="selectedSingleOption(product.id)"
              :items="getOptions(product).map(o => ({ label: o.label, value: o.id, priceModifier: o.priceModifier }))"
              :ui="{ fieldset: 'gap-y-2', item: 'w-full', label: 'w-full' }"
              @update:model-value="selectSingle(product.id, $event as string)"
            >
              <template #label="{ item }">
                <span class="flex items-center justify-between w-full">
                  <span>{{ item.label }}</span>
                  <span v-if="item.priceModifier > 0" class="text-xs text-muted ml-2">+{{ format(item.priceModifier) }}</span>
                </span>
              </template>
            </URadioGroup>

            <!-- Single-select, no remark: each option adds immediately -->
            <div v-else class="space-y-2">
              <UButton
                v-for="option in getOptions(product)"
                :key="option.id"
                :label="option.label"
                block
                size="md"
                color="neutral"
                variant="ghost"
                class="active:scale-[0.98] transition-transform"
                @click="selectOption(product, option.id)"
              >
                <template #trailing>
                  <span v-if="option.priceModifier > 0" class="text-xs text-muted ms-auto">+{{ format(option.priceModifier) }}</span>
                  <UIcon
                    name="i-lucide-plus"
                    class="size-4 text-primary transition-transform"
                    :class="[{ 'ms-auto': !option.priceModifier }, poppedId === option.id ? 'animate-pop' : '']"
                    @animationend="poppedId = null"
                  />
                </template>
              </UButton>
            </div>
          </template>

          <!-- Required per-item remark: inline textarea, beneath options or alone.
               Header matches the cart's remark section (icon + singular label);
               the prompt lives in the field description only — no placeholder or
               textarea icon, they doubled the same text inside the box. -->
          <UFormField
            v-if="product.requiresRemark"
            :description="product.remarkPrompt || undefined"
            :class="hasOptions(product) ? 'pt-2' : ''"
          >
            <template #label>
              <span class="flex items-center gap-2">
                <UIcon name="i-lucide-message-square-text" class="size-4" />
                {{ t('sales.cart.remark') }}
              </span>
            </template>
            <UTextarea
              :model-value="remarkFor(product.id)"
              :rows="2"
              autoresize
              class="w-full"
              @update:model-value="setRemark(product.id, String($event))"
            />
          </UFormField>

          <!-- One confirm button for multi-select and/or remark products. Remark
               and multi-select options are optional; single-select is required. -->
          <UButton
            v-if="needsConfirm(product)"
            block
            size="lg"
            color="primary"
            :disabled="confirmDisabled(product)"
            @click="confirmProduct(product)"
          >
            {{ t('sales.products.addToCart') }}
          </UButton>
        </div>
      </Transition>
      </div>
    </UCard>
  </div>
</template>

<script setup lang="ts">
import { useSortable } from '@vueuse/integrations/useSortable'
import type { SalesProduct, ProductOption } from '../../types'
const { t } = useT()
const { format } = useSalesCurrency()

const props = defineProps<{
  products: SalesProduct[]
  /** Admin POS: show a drag handle (reorder) and edit pencil on each card. */
  editable?: boolean
}>()

const emit = defineEmits<{
  select: [product: SalesProduct, selectedOption?: string | string[], remark?: string]
  edit: [productId: string]
  /** New visual order after a drop — only the rows whose index changed. */
  reorder: [updates: Array<{ id: string, order: number }>]
}>()

const containerRef = ref<HTMLElement | null>(null)

// Local mutable copy that useSortable reorders in place on drop (mirrors
// ProductsTab). Always the render source so editable/non-editable paths match.
const orderedProducts = ref<SalesProduct[]>([])
watch(() => props.products, (v) => { orderedProducts.value = [...(v || [])] }, { immediate: true })

const orderOf = (p: SalesProduct) => p.sortOrder ?? 0

function emitNewOrder() {
  const updates: Array<{ id: string, order: number }> = []
  orderedProducts.value.forEach((p, index) => {
    if (orderOf(p) !== index) updates.push({ id: p.id, order: index })
  })
  if (updates.length) emit('reorder', updates)
}

// Editable is fixed for the life of this component instance — OrderInterface
// remounts the list (:key) when its edit mode flips — so a one-time init is
// fine, no need for a reactive `disabled` option.
if (import.meta.client && props.editable) {
  useSortable(containerRef, orderedProducts, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'opacity-50',
    chosenClass: 'bg-elevated',
    onEnd: (evt: { oldIndex?: number, newIndex?: number }) => {
      if (evt.oldIndex !== evt.newIndex) emitNewOrder()
    }
  })
}
const activeProductId = ref<string | null>(null)
const selectedOptionIds = ref<Map<string, string[]>>(new Map())
// Per-product remark text, keyed by product id (only for requiresRemark products).
const remarks = ref<Map<string, string>>(new Map())
// Tracks the most recently tapped add affordance so its plus icon can
// briefly "pop" for tactile feedback. Cleared via @animationend (no timers).
const poppedId = ref<string | null>(null)

function hasOptions(product: SalesProduct): boolean {
  return !!product.hasOptions && Array.isArray(product.options) && product.options.length > 0
}

function isMultiSelect(product: SalesProduct): boolean {
  return !!product.multipleOptionsAllowed
}

// A product expands inline when it has options or needs a remark.
function isExpandable(product: SalesProduct): boolean {
  return hasOptions(product) || !!product.requiresRemark
}

// Products that gather input before adding use a single confirm button:
// multi-select options, or any product requiring a remark.
function needsConfirm(product: SalesProduct): boolean {
  return isMultiSelect(product) || !!product.requiresRemark
}

function getOptions(product: SalesProduct): ProductOption[] {
  return (product.options || []) as ProductOption[]
}

function isOptionSelected(productId: string, optionId: string): boolean {
  const selected = selectedOptionIds.value.get(productId)
  return selected?.includes(optionId) ?? false
}

function toggleOption(productId: string, optionId: string) {
  const current = selectedOptionIds.value.get(productId) || []
  if (current.includes(optionId)) {
    selectedOptionIds.value.set(productId, current.filter(id => id !== optionId))
  }
  else {
    selectedOptionIds.value.set(productId, [...current, optionId])
  }
}

// Single-select (when a remark is required): pick exactly one option.
function selectSingle(productId: string, optionId: string) {
  selectedOptionIds.value.set(productId, [optionId])
}

// The radio group's model: the single selected option id (or undefined).
function selectedSingleOption(productId: string): string | undefined {
  return selectedOptionIds.value.get(productId)?.[0]
}

function remarkFor(productId: string): string {
  return remarks.value.get(productId) ?? ''
}

function setRemark(productId: string, value: string) {
  remarks.value.set(productId, value)
}

// Confirm is blocked only when a single-select product has no option chosen.
// Single-select (radio) is mandatory; multi-select options and the remark are
// both optional.
function confirmDisabled(product: SalesProduct): boolean {
  if (hasOptions(product) && !isMultiSelect(product)) {
    return (selectedOptionIds.value.get(product.id) || []).length === 0
  }
  return false
}

// Gather inline options + remark and add to cart. The remark is optional.
function confirmProduct(product: SalesProduct) {
  const selected = selectedOptionIds.value.get(product.id) || []
  let options: string | string[] | undefined
  if (hasOptions(product)) {
    options = isMultiSelect(product)
      ? (selected.length > 0 ? selected : undefined)
      : selected[0]
  }
  const remark = product.requiresRemark ? remarkFor(product.id).trim() : undefined

  poppedId.value = product.id
  emit('select', product, options, remark)

  selectedOptionIds.value.delete(product.id)
  remarks.value.delete(product.id)
  activeProductId.value = null
}

function handleProductClick(product: SalesProduct) {
  // Inactive products are only visible in the editable POS — clicking one
  // opens its edit form (to reactivate it) instead of the cart flow.
  if (product.isActive === false) {
    if (props.editable) emit('edit', product.id)
    return
  }
  if (isExpandable(product)) {
    toggleProduct(product)
  }
  else {
    addProduct(product)
  }
}

function clearProductState(productId: string) {
  selectedOptionIds.value.delete(productId)
  remarks.value.delete(productId)
}

function toggleProduct(product: SalesProduct) {
  // Clear previous selection if switching products
  if (activeProductId.value && activeProductId.value !== product.id) {
    clearProductState(activeProductId.value)
  }
  // Toggle expansion/active state
  activeProductId.value = activeProductId.value === product.id ? null : product.id
}

function addProduct(product: SalesProduct) {
  poppedId.value = product.id
  emit('select', product)
}

function selectOption(product: SalesProduct, optionId: string) {
  poppedId.value = optionId
  emit('select', product, optionId)
}

// Close on click outside
onClickOutside(containerRef, () => {
  if (activeProductId.value) {
    clearProductState(activeProductId.value)
  }
  activeProductId.value = null
})
</script>

<style scoped>
.slide-enter-active {
  transition: opacity 150ms ease-out, transform 150ms ease-out;
}

.slide-leave-active {
  transition: opacity 100ms ease-in, transform 100ms ease-in;
}

.slide-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

.slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.animate-pop {
  animation: pop 0.2s ease-out;
}

@keyframes pop {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.4);
  }
  100% {
    transform: scale(1);
  }
}
</style>
