<template>
  <!-- Footer stays compact (space-y-3, py-3) — in the mobile drawer every
       saved pixel goes to the scrollable line-item area above it. The total
       rides the order button; remark + staff share one row. -->
  <UCard class="flex flex-col h-full" :ui="{ root: 'rounded-none', body: 'flex-1 overflow-y-auto px-3 sm:px-3', footer: 'space-y-3 px-3 sm:px-3 py-3 sm:py-3' }">
    <!-- Cart items -->
    <div v-if="items.length === 0" class="h-full flex flex-col items-center justify-center gap-3 text-muted">
      <UIcon name="i-lucide-shopping-cart" class="size-10 opacity-40" />
      <p class="text-sm">{{ t('sales.cart.empty') }}</p>
    </div>

    <div v-else class="space-y-4">
      <div v-for="group in groupedItems" :key="group.key" class="space-y-2">
        <p
          v-if="group.title"
          class="text-xs font-medium text-muted uppercase tracking-wide px-1"
        >
          {{ group.title }}
        </p>
        <!-- Subtle divider between products — same treatment as the expanded
             order's item list in the workspace. -->
        <div class="divide-y divide-default/60">
          <SalesClientOrderLineItem
            v-for="entry in group.entries"
            :key="`${entry.item.product.id}-${entry.index}`"
            :title="entry.item.product.title"
            :price="calculateItemPrice(entry.item) * entry.item.quantity"
            :options="getSelectedOptionLabels(entry.item)"
            :remark="entry.item.remarks"
          >
            <template #actions>
              <!-- One grouped stepper (#1407): UFieldGroup joins −/qty/+ so
                   themes style it as a single control. md: +/− are the
                   most-tapped controls during an order — keep them thumb-sized
                   on touch devices. -->
              <UFieldGroup size="md">
                <UButton
                  icon="i-lucide-minus"
                  color="neutral"
                  variant="soft"
                  square
                  @click="$emit('updateQuantity', entry.index, entry.item.quantity - 1)"
                />
                <UBadge color="neutral" variant="soft" class="w-8 justify-center text-sm tabular-nums">
                  <span :key="entry.item.quantity" class="animate-pop">{{ entry.item.quantity }}</span>
                </UBadge>
                <UButton
                  icon="i-lucide-plus"
                  color="neutral"
                  variant="soft"
                  square
                  @click="$emit('updateQuantity', entry.index, entry.item.quantity + 1)"
                />
              </UFieldGroup>
            </template>
          </SalesClientOrderLineItem>
        </div>
      </div>
    </div>

    <template #footer>
      <!-- One compact controls row: remark toggle (left) + staff switch
           (right). The old stacked Totaal / remark block / staff rows ate
           half the phone drawer — the total lives on the order button now. -->
      <div v-if="items.length > 0">
        <div class="flex items-center justify-between gap-2">
          <!-- A location remark prints as REMARK: on that location's ticket
               only. Never counted in sales. -->
          <UButton
            v-if="remarkLocations.length > 0"
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-message-square-text"
            :trailing-icon="remarksOpen ? 'i-lucide-minus' : 'i-lucide-plus'"
            :label="remarkCount > 0 ? `${t('sales.cart.remark')} (${remarkCount})` : t('sales.cart.remark')"
            @click="remarksOpen = !remarksOpen"
          />
          <span v-else />
          <!-- Staff order: prints the staff banner on tickets (receipt settings) -->
          <label class="flex items-center gap-2 cursor-pointer">
            <span class="text-sm" :class="isPersonnel ? 'text-warning font-medium' : 'text-muted'">
              {{ t('sales.cart.staffOrder') }}
            </span>
            <USwitch
              :model-value="isPersonnel ?? false"
              color="warning"
              @update:model-value="$emit('update:isPersonnel', $event)"
            />
          </label>
        </div>

        <!-- Remarks accordion: one item per location with items in the cart,
             each body its own note. Controlled by the toggle above (the
             collapsible has no trigger of its own). -->
        <UCollapsible v-if="remarkLocations.length > 0" v-model:open="remarksOpen">
          <template #content>
            <div class="mt-2 px-2 pb-1 rounded-lg bg-elevated/60">
              <UAccordion type="multiple" :items="remarkAccordionItems" :ui="{ trigger: 'text-toned font-normal' }">
                <template #default="{ item }">
                  <span class="flex items-center gap-2 text-sm">
                    {{ item.label }}
                    <span
                      v-if="locationRemark(item.value).trim()"
                      class="size-1.5 rounded-full bg-primary"
                    />
                  </span>
                </template>
                <template #body="{ item }">
                  <UTextarea
                    :model-value="locationRemark(item.value)"
                    :placeholder="t('sales.cart.remarkPlaceholder')"
                    :rows="2"
                    autoresize
                    variant="soft"
                    class="w-full"
                    @update:model-value="emitLocationRemark(item.value, String($event))"
                  />
                </template>
              </UAccordion>
            </div>
          </template>
        </UCollapsible>
      </div>

      <!-- UAlert (not a raw warning div) so themes reach this chrome (#1392):
           variant-less usage follows the active theme's alert variant. -->
      <UAlert
        v-if="clientRequired && !hasClient && items.length > 0"
        color="warning"
        icon="i-lucide-alert-triangle"
        :title="clientWarning || t('sales.cart.selectClient')"
      />

      <!-- Print failures persist as rows (one per order) so a busy event keeps
           ordering while a previous order's printer problem stays visible. -->
      <UAlert
        v-for="warning in printWarnings || []"
        :key="warning.orderId"
        color="warning"
        icon="i-lucide-printer"
        :title="`#${warning.orderNumber} — ${warning.timedOut ? t('sales.cart.printTimeout') : t('sales.cart.printFailed')}`"
        close
        @update:open="$emit('dismissPrintWarning', warning.orderId)"
      >
        <template #description>
          <span v-for="failure in warning.failures" :key="failure.printerTitle" class="block text-xs">
            {{ failure.printerTitle }}<template v-if="failure.errorMessage">: {{ failure.errorMessage }}</template>
          </span>
        </template>
      </UAlert>

      <!-- Talk-to-order (#1429): segments the mic heard but couldn't match to
           a product. Never silently dropped — the helper reads what was
           misheard and taps it in manually. -->
      <UAlert
        v-if="(voiceUnmatched?.length ?? 0) > 0"
        color="warning"
        icon="i-lucide-mic-off"
        :title="t('sales.voice.notUnderstood')"
        close
        @update:open="$emit('dismissVoiceUnmatched')"
      >
        <template #description>
          <span v-for="(segment, i) in voiceUnmatched" :key="i" class="block text-xs">
            "{{ segment }}"
          </span>
        </template>
      </UAlert>

      <!-- Live transcript while the mic listens — the helper sees what the
           mic hears before it lands in the cart. -->
      <p
        v-if="voiceListening"
        class="flex items-center gap-1.5 text-xs text-muted truncate"
      >
        <UIcon name="i-lucide-mic" class="shrink-0 text-error animate-pulse" />
        {{ voiceTranscript?.trim() || t('sales.voice.listening') }}
      </p>

      <!-- The order button is the print feedback: it spins while the kitchen
           tickets print and confirms green when every ticket is done. A new
           order always wins — items in the cart yield the button back to
           "Bestel" while the watcher continues in the background. The mic sits
           beside it (not in the items-gated controls row above) so a spoken
           order can START an empty cart. -->
      <div class="flex items-stretch gap-2">
        <UButton
          :label="orderButton.label"
          size="lg"
          class="flex-1"
          :color="orderButton.color"
          :icon="orderButton.icon"
          :loading="orderButton.loading"
          :disabled="orderButton.disabled"
          @click="handleOrderClick"
        />
        <UButton
          v-if="voiceSupported"
          size="lg"
          square
          icon="i-lucide-mic"
          :color="voiceListening ? 'error' : 'neutral'"
          :variant="voiceListening ? 'solid' : 'soft'"
          :class="voiceListening ? 'animate-pulse' : undefined"
          :aria-label="voiceListening ? t('sales.voice.stop') : t('sales.voice.start')"
          @click="$emit('toggleVoice')"
        />
      </div>
    </template>
  </UCard>
</template>

<script setup lang="ts">
import type { CartItem, ProductOption, SalesCategory, SalesLocation } from '../../types'
import type { PrintButtonState, WatchedOrder } from '../../composables/usePrintWatcher'
import { calculateItemPrice } from '../../composables/usePosOrder'
const { t } = useT()
const { format } = useSalesCurrency()

const props = defineProps<{
  items: readonly CartItem[]
  total: number
  disabled: boolean
  clientRequired?: boolean
  hasClient?: boolean
  /** Warning shown when the client indication is missing — the parent picks
   * the wording (select a client vs enter a name). */
  clientWarning?: string
  /** Categories used to group + order cart items. Optional — without it items render ungrouped. */
  categories?: SalesCategory[]
  /** Event locations, used to label per-location remark inputs. */
  locations?: SalesLocation[]
  /** Current per-location remark text, keyed by locationId. */
  locationRemarks?: Record<string, string>
  /** Staff order flag — prints the staff banner (receipt settings) on tickets. */
  isPersonnel?: boolean
  /** The order POST is in flight (usePosOrder's isCheckingOut). */
  submitting?: boolean
  /** Latest order's print feedback (usePrintWatcher's buttonState). */
  printState?: PrintButtonState
  /** Orders with failed/stuck tickets — rendered as dismissible warning rows. */
  printWarnings?: WatchedOrder[]
  /** Talk-to-order (#1429): browser has speech recognition — shows the mic. */
  voiceSupported?: boolean
  /** The mic is live (pulses the button, shows the transcript line). */
  voiceListening?: boolean
  /** Interim transcript while listening. */
  voiceTranscript?: string
  /** Utterance segments that matched no product — dismissible warning rows. */
  voiceUnmatched?: string[]
}>()

// Locations represented by at least one cart item — a remark only prints if its
// location already has an item on this order (items-required).
const remarkLocations = computed<SalesLocation[]>(() => {
  const idsInCart = new Set(
    props.items
      .map(item => item.product.locationId)
      .filter((id): id is string => Boolean(id))
  )
  const byId = new Map((props.locations || []).map(loc => [loc.id, loc]))
  return [...idsInCart]
    .map(id => byId.get(id))
    .filter((loc): loc is SalesLocation => Boolean(loc))
})

interface CartEntry {
  item: CartItem
  /** Original index in props.items — must be used for quantity emits. */
  index: number
}

interface CartGroup {
  key: string
  title: string
  entries: CartEntry[]
}

// Order map for categories so groups follow the admin-defined display order.
const categoryOrder = computed(() => {
  const map = new Map<string, { title: string, order: number }>()
  ;(props.categories || []).forEach((category, idx) => {
    map.set(category.id, {
      title: category.title,
      order: category.displayOrder ?? idx,
    })
  })
  return map
})

// Group cart items by category, then cluster identical products within each group.
// Original indices are preserved on each entry so quantity controls stay correct.
const groupedItems = computed<CartGroup[]>(() => {
  const groups = new Map<string, CartGroup & { order: number }>()

  props.items.forEach((item, index) => {
    const categoryId = item.product.categoryId
    const meta = categoryId ? categoryOrder.value.get(categoryId) : undefined
    const key = categoryId || '__uncategorized__'

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: meta?.title ?? '',
        // Known categories sort by their order; unknown/uncategorized go last.
        order: meta ? meta.order : Number.MAX_SAFE_INTEGER,
        entries: [],
      })
    }
    groups.get(key)!.entries.push({ item, index })
  })

  const result = Array.from(groups.values())
  result.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))

  // Cluster identical products (same title) next to each other within a group,
  // preserving relative insertion order for ties.
  for (const group of result) {
    group.entries.sort((a, b) =>
      a.item.product.title.localeCompare(b.item.product.title) || a.index - b.index
    )
  }

  return result
})

const emit = defineEmits<{
  updateQuantity: [index: number, quantity: number]
  checkout: []
  updateLocationRemark: [locationId: string, value: string]
  'update:isPersonnel': [value: boolean]
  dismissPrintWarning: [orderId: string]
  toggleVoice: []
  dismissVoiceUnmatched: []
}>()

// Button state machine. Items in the cart always win (the volunteer is
// building the next order — the watcher keeps running in the background and
// failures surface as warning rows instead of hijacking the button). The
// print states only show while the cart sits empty after a checkout. The
// status modes stay undimmed (not disabled) — clicks are simply no-ops there.
const orderButton = computed(() => {
  if (props.submitting) {
    return { label: t('sales.cart.submitOrder'), color: 'primary', icon: undefined, loading: true, disabled: true } as const
  }
  if (props.items.length === 0) {
    switch (props.printState) {
      case 'printing':
        return { label: t('sales.cart.printing'), color: 'primary', icon: undefined, loading: true, disabled: false } as const
      case 'confirmed':
        return { label: t('sales.cart.printed'), color: 'success', icon: 'i-lucide-check', loading: false, disabled: false } as const
      case 'warning':
        return { label: t('sales.cart.printFailed'), color: 'warning', icon: 'i-lucide-alert-triangle', loading: false, disabled: false } as const
    }
  }
  return {
    // The total rides the button — there is no separate Totaal row.
    label: props.items.length > 0
      ? `${t('sales.cart.submitOrder')} · ${format(props.total)}`
      : t('sales.cart.submitOrder'),
    color: 'primary',
    icon: undefined,
    loading: false,
    disabled: props.disabled || props.items.length === 0 || (props.clientRequired === true && !props.hasClient)
  } as const
})

function handleOrderClick() {
  // Only an actual order submit fires checkout — the print-status modes are
  // display-only (the cart is empty there, checkout would just throw).
  if (!props.submitting && props.items.length > 0) emit('checkout')
}

// Remarks panel: an accordion item per location that already has an item in
// the cart (items-required, same rule the print pipeline applies). Each item
// carries its own textarea; a filled one shows a dot next to its label.
const remarksOpen = ref(false)

const remarkAccordionItems = computed(() =>
  remarkLocations.value.map(loc => ({ label: loc.title, value: loc.id }))
)

function locationRemark(locationId?: string): string {
  return locationId ? (props.locationRemarks?.[locationId] ?? '') : ''
}

function emitLocationRemark(locationId: string | undefined, value: string) {
  if (locationId) emit('updateLocationRemark', locationId, value)
}

// Locations that currently carry text — shown as a count on the collapsed button.
const remarkCount = computed(() =>
  remarkLocations.value.filter(loc => props.locationRemarks?.[loc.id]?.trim()).length
)

// Get selected option labels as array
function getSelectedOptionLabels(item: CartItem): string[] {
  if (!item.selectedOptions || !item.product.options) return []
  const optionIds = Array.isArray(item.selectedOptions)
    ? item.selectedOptions
    : [item.selectedOptions]
  return optionIds
    .map(id => item.product.options?.find((o: ProductOption) => o.id === id)?.label)
    .filter((label): label is string => Boolean(label))
}


</script>

<style scoped>
.animate-pop {
  animation: pop 0.15s ease-out;
}

@keyframes pop {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
  }
}
</style>
