<template>
  <div v-if="products.length === 0" class="text-center text-muted py-8">
    {{ t('sales.products.noProducts') }}
  </div>
  <div v-else ref="containerRef" class="flex flex-col gap-2">
    <UCard
      v-for="product in orderedProducts"
      :key="product.id"
      variant="soft"
      class="cursor-pointer group/card relative overflow-hidden transition-colors duration-150 hover:bg-elevated"
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
      <!-- Hover pushes the content inward so the reorder grip never covers the
           title. In edit mode the trailing action itself becomes a persistent
           pencil (below), so there's no right-edge slide-out to make room for. -->
      <div
        class="transition-[padding] duration-200 ease-out"
        :class="editable ? 'group-hover/card:ps-7 pointer-coarse:ps-7' : ''"
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
          <!-- Edit mode: the trailing action is EDIT, never add-to-cart — a
               pencil makes clear that tapping edits the product, and the cart
               path is disabled while editing. -->
          <UButton
            v-if="editable"
            variant="ghost"
            color="neutral"
            size="md"
            square
            icon="i-lucide-pencil"
            class="group-hover/card:bg-accented/50 hover:bg-accented"
            :aria-label="t('common.edit')"
            @click.stop="emit('edit', product.id)"
          />
          <!-- Configurable product (options/remark): expand chevron, with a
               count badge once any variant of it sits in the cart. Removing a
               specific variant stays in the cart — the row can't tell the
               variants apart, so it only reports the total. -->
          <template v-else-if="isExpandable(product)">
            <UBadge
              v-if="quantityOf(product) > 0"
              color="primary"
              variant="soft"
              size="sm"
              class="tabular-nums"
            >
              <span :key="quantityOf(product)" class="animate-pop">{{ quantityOf(product) }}</span>
            </UBadge>
            <UButton
              variant="ghost"
              color="neutral"
              size="md"
              square
              :icon="activeProductId === product.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="group-hover/card:bg-accented/50 hover:bg-accented"
              @click.stop="toggleProduct(product)"
            />
          </template>
          <!-- Plain product already in the cart: the full cart stepper inline,
               so it can be decremented/removed without opening the cart. A
               plain product maps to exactly one cart line (no options/remark),
               so −/qty/+ is unambiguous. -->
          <UFieldGroup v-else-if="quantityOf(product) > 0" size="md">
            <UButton
              icon="i-lucide-minus"
              color="neutral"
              variant="soft"
              square
              :aria-label="t('sales.cart.remove', 'Remove one')"
              @click.stop="emit('decrement', product)"
            />
            <UBadge color="neutral" variant="soft" class="w-8 justify-center text-sm tabular-nums">
              <span :key="quantityOf(product)" class="animate-pop">{{ quantityOf(product) }}</span>
            </UBadge>
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="soft"
              square
              :aria-label="t('sales.cart.add', 'Add one')"
              @click.stop="addProduct(product)"
            />
          </UFieldGroup>
          <!-- Plain product not yet in the cart: single add button. -->
          <UButton
            v-else
            variant="ghost"
            color="primary"
            size="md"
            square
            class="active:scale-90 transition-[transform,background-color] group-hover/card:bg-primary/10 hover:bg-primary/20"
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
            <!-- Multi-select: card-variant checkbox group (big tap targets,
                 matches the single-select radio cards below). -->
            <UCheckboxGroup
              v-if="isMultiSelect(product)"
              variant="card"
              :model-value="selectedOptionIds.get(product.id) || []"
              :items="getOptions(product).map(o => ({ label: o.label, value: o.id, priceModifier: o.priceModifier }))"
              :ui="{ fieldset: 'gap-y-2', item: 'w-full', label: 'w-full' }"
              @update:model-value="setMultiOptions(product.id, ($event as string[]))"
            >
              <template #label="{ item }">
                <span class="flex items-center justify-between w-full">
                  <span>{{ item.label }}</span>
                  <span v-if="item.priceModifier > 0" class="text-xs text-muted ml-2">+{{ format(item.priceModifier) }}</span>
                </span>
              </template>
            </UCheckboxGroup>

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

          <!-- Ordered variants of this product already in the cart: each line
               (its options/remark) with its own −/qty/+ stepper, so what's been
               ordered is visible and adjustable without opening the cart. -->
          <div
            v-if="linesFor(product).length"
            class="pt-2.5 border-t border-default space-y-1.5"
          >
            <p class="text-xs font-medium text-muted">{{ t('sales.products.inCart') }}</p>
            <div
              v-for="line in linesFor(product)"
              :key="line.index"
              class="flex items-center gap-2"
            >
              <span class="flex-1 min-w-0 truncate text-sm">{{ variantLabel(product, line) }}</span>
              <UFieldGroup size="sm">
                <UButton
                  icon="i-lucide-minus"
                  color="neutral"
                  variant="soft"
                  square
                  :aria-label="t('sales.cart.remove')"
                  @click="emit('variantQuantity', line.index, line.quantity - 1)"
                />
                <UBadge color="neutral" variant="soft" class="w-8 justify-center text-sm tabular-nums">
                  <span :key="line.quantity" class="animate-pop">{{ line.quantity }}</span>
                </UBadge>
                <UButton
                  icon="i-lucide-plus"
                  color="neutral"
                  variant="soft"
                  square
                  :aria-label="t('sales.cart.add')"
                  @click="emit('variantQuantity', line.index, line.quantity + 1)"
                />
              </UFieldGroup>
            </div>
          </div>
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
  /**
   * Total quantity currently in the cart per product id. Drives the inline
   * stepper (plain products) and the count badge (products with options/remark).
   */
  quantities?: Record<string, number>
  /**
   * Cart lines for configurable products (options/remark), keyed by product id
   * and carrying each line's cart index. Drives the "ordered variants" list
   * inside the expandable — one −/qty/+ stepper per variant, targeting its
   * exact line by index.
   */
  cartLines?: Record<string, Array<{ index: number, selectedOptions?: string | string[], remarks?: string, quantity: number }>>
}>()

const emit = defineEmits<{
  select: [product: SalesProduct, selectedOption?: string | string[], remark?: string]
  edit: [productId: string]
  /** Decrement the plain (no options/remark) cart line for this product. */
  decrement: [product: SalesProduct]
  /** Set the quantity of one configurable-product cart line (by cart index);
   *  0 removes it. Fired by the ordered-variants steppers in the expandable. */
  variantQuantity: [index: number, quantity: number]
  /** New visual order after a drop — only the rows whose index changed. */
  reorder: [updates: Array<{ id: string, order: number }>]
}>()

// Total quantity of this product across all its cart lines (all option/remark
// variants). For a plain product that's its single line's quantity.
function quantityOf(product: SalesProduct): number {
  return props.quantities?.[product.id] ?? 0
}

// The cart lines (variants) of a configurable product, for the ordered list
// inside its expandable.
function linesFor(product: SalesProduct) {
  return props.cartLines?.[product.id] ?? []
}

// Human label for one ordered variant: its selected option labels (ids resolved
// against the product's options) and any per-item remark, joined. Falls back to
// the product title if a line somehow carries neither.
function variantLabel(
  product: SalesProduct,
  line: { selectedOptions?: string | string[], remarks?: string }
): string {
  const parts: string[] = []
  if (line.selectedOptions) {
    const ids = Array.isArray(line.selectedOptions) ? line.selectedOptions : [line.selectedOptions]
    const opts = getOptions(product)
    parts.push(...ids.map(id => opts.find(o => o.id === id)?.label || id))
  }
  if (line.remarks) parts.push(line.remarks)
  return parts.join(' · ') || product.title
}

const containerRef = ref<HTMLElement | null>(null)

// Local mutable copy that useSortable reorders in place on drop (mirrors
// ProductsTab). Always the render source so editable/non-editable paths match.
const orderedProducts = ref<SalesProduct[]>([])
watch(() => props.products, (v) => { orderedProducts.value = [...(v || [])] }, { immediate: true })

const orderOf = (p: SalesProduct) => p.order ?? 0

// Emit the changed rows (index-as-order) of an already-reordered list.
function emitNewOrder(list: SalesProduct[]) {
  const updates: Array<{ id: string, order: number }> = []
  list.forEach((p, index) => {
    if (orderOf(p) !== index) updates.push({ id: p.id, order: index })
  })
  if (updates.length) emit('reorder', updates)
}

// Apply SortableJS's move (oldIndex → newIndex) to a copy of the list.
function withMove(list: SalesProduct[], from: number, to: number): SalesProduct[] {
  const next = [...list]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return next
  next.splice(to, 0, moved)
  return next
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
    // Derive the new order from the drag event itself — SortableJS's
    // oldIndex/newIndex are the source of truth. (Don't read the bound array
    // here: useSortable syncs it on nextTick, so at this point it's still the
    // pre-drag order — which is exactly why we apply the move to it, #1550.)
    onEnd: (evt: { oldIndex?: number, newIndex?: number }) => {
      const { oldIndex, newIndex } = evt
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return
      emitNewOrder(withMove(orderedProducts.value, oldIndex, newIndex))
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

// Multi-select (checkbox group): the group emits the full selected-id array.
function setMultiOptions(productId: string, ids: string[]) {
  selectedOptionIds.value.set(productId, ids)
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

  // Clear the inputs but keep the panel open — the just-added variant appears
  // in the "ordered" list below, and the user can compose another combo.
  selectedOptionIds.value.delete(product.id)
  remarks.value.delete(product.id)
}

function handleProductClick(product: SalesProduct) {
  // In edit mode the list is an editing surface, not the cart — clicking any
  // product (active or inactive) opens its edit form. Adding to cart is
  // deliberately impossible while editing.
  if (props.editable) {
    emit('edit', product.id)
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
