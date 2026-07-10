<template>
  <!-- @container: the POS responds to its own pane width, not the viewport —
       squeezed beside the orders pane it flips to mobile mode (cart drawer at
       the bottom) exactly like on a phone. [contain:layout] makes this root the
       containing block for the fixed cart drawer (container-type alone does
       not — verified in Chromium), keeping the drawer inside the POS module. -->
  <div class="h-full flex flex-col @container [contain:layout]">
    <SalesClientOfflineBanner />

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl" />
    </div>

    <template v-else>
      <!-- Main content area -->
      <div class="flex-1 flex overflow-hidden">
        <!-- Products column (the category tabs live here, not over the cart) -->
        <div class="flex-1 flex flex-col overflow-hidden">
          <!-- h-14 shared with the cart's client-selector row so both bottom
               borders sit on the same line regardless of content height. -->
          <div class="h-14 px-2 border-b border-default shrink-0 flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <!-- :key remounts the tabs when edit mode flips — the sortable
                   (tab drag-reorder) is armed once at setup, gated on editable. -->
              <SalesClientCategoryTabs
                :key="editing ? 'edit' : 'view'"
                v-model="selectedCategory"
                :categories="sortedCategories"
                :counts="cartCountsByCategory"
                :show-all="false"
                :editable="editing"
                :reorder-pending="reorderingCategories"
                @rename="handleCategoryRename"
                @create="handleCategoryCreate"
                @reorder="handleCategoryReorder"
              />
            </div>
            <!-- Admin: all catalog editing hides behind this one toggle -->
            <UButton
              v-if="editable && !hideEditToggle"
              size="sm"
              :color="editing ? 'primary' : 'neutral'"
              :variant="editing ? 'solid' : 'soft'"
              :icon="editing ? 'i-lucide-check' : 'i-lucide-pencil'"
              :aria-label="editing ? t('sales.workspace.doneEditing') : t('sales.workspace.editCatalog')"
              @click="editMode = !editMode"
            />
          </div>
          <!-- Admin toolbar: add product + show-inactive, pinned above the list -->
          <div
            v-if="editing"
            class="shrink-0 flex items-center justify-between gap-3 p-2 pb-0"
          >
            <UButton
              size="sm"
              color="neutral"
              variant="soft"
              icon="i-lucide-plus"
              :label="t('sales.workspace.addProduct')"
              @click="openCreateProduct"
            />
            <UButton
              size="sm"
              color="neutral"
              :variant="showInactive ? 'solid' : 'soft'"
              icon="i-lucide-eye"
              :label="t('sales.workspace.showInactive', 'Inactive products')"
              @click="showInactive = !showInactive"
            />
          </div>
          <div class="flex-1 overflow-y-auto p-2">
            <!-- :key remounts the list when edit mode flips — its sortable
                 (product drag-reorder) is armed once at setup, gated on editable. -->
            <SalesClientProductList
              :key="editing ? 'edit' : 'view'"
              :products="filteredProducts"
              :editable="editing"
              @select="handleProductSelect"
              @edit="openEditProduct"
              @reorder="handleReorder"
            />
          </div>
        </div>

        <!-- Cart sidebar (wide panes only) -->
        <div class="hidden @2xl:flex w-80 border-l border-default flex-col">
          <!-- h-14 matches the category-tabs row so both bottom borders align.
               Every order needs a client indication on the ticket: reusable
               clients when the event requires them, otherwise a plain
               mandatory name input. -->
          <div class="h-14 px-2 border-b border-default flex items-center">
            <SalesClientSelector
              v-if="props.requiresClient"
              class="flex-1 min-w-0"
              :clients="props.clients || []"
              :highlight="!hasClient && cartItems.length > 0"
              :client-id="selectedClientId"
              :event-id="props.eventId"
              @update:client-id="selectedClientId = $event"
              @update:client-name="selectedClientName = $event"
            />
            <UInput
              v-else
              :model-value="selectedClientName ?? ''"
              class="flex-1 min-w-0"
              icon="i-lucide-user"
              :placeholder="t('sales.cart.namePlaceholder')"
              :highlight="!hasClient && cartItems.length > 0"
              :color="!hasClient && cartItems.length > 0 ? 'warning' : undefined"
              @update:model-value="selectedClientName = String($event)"
            />
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto">
            <SalesClientCart
              :items="cartItems"
              :categories="categories || []"
              :locations="locations || []"
              :location-remarks="locationRemarks"
              :is-personnel="isPersonnel"
              :total="cartTotal"
              :disabled="!isOnline"
              client-required
              :client-warning="clientWarning"
              :has-client="hasClient"
              :submitting="isCheckingOut"
              :print-state="printButtonState"
              :print-warnings="printWarnings"
              @update-quantity="updateQuantity"
              @remove="removeFromCart"
              @checkout="handleCheckout"
              @clear="clearCart"
              @update-location-remark="setLocationRemark"
              @update:is-personnel="isPersonnel = $event"
              @dismiss-print-warning="dismissPrintWarning"
            />
          </div>
        </div>
      </div>

      <!-- Narrow-pane cart row (cart column is hidden, drawer from the bottom).
           :portal="false" keeps the drawer in the DOM under the [contain:layout]
           root, so the fixed drawer + overlay resolve against the module instead
           of the viewport. Heights are % of the module. -->
      <div class="@2xl:hidden border-t border-default p-2">
        <UDrawer
          v-model:open="mobileCartOpen"
          direction="bottom"
          :portal="false"
          :ui="{ content: 'h-[95%]' }"
        >
          <!-- The drawer auto-closes on checkout, so this collapsed bar must
               mirror the print feedback (spinner / ✓ / warning) or the
               volunteer never sees it. -->
          <UButton
            block
            size="lg"
            :label="mobileBar.label"
            :icon="mobileBar.icon"
            :color="mobileBar.color"
            :variant="mobileBar.variant"
            :loading="mobileBar.loading"
          />

          <template #content>
            <div class="h-full flex flex-col">
              <div class="p-3 border-b border-default shrink-0">
                <SalesClientSelector
                  v-if="props.requiresClient"
                  :clients="props.clients || []"
                  :highlight="!hasClient && cartItems.length > 0"
                  :client-id="selectedClientId"
                  :event-id="props.eventId"
                  @update:client-id="selectedClientId = $event"
                  @update:client-name="selectedClientName = $event"
                />
                <UInput
                  v-else
                  :model-value="selectedClientName ?? ''"
                  class="w-full"
                  icon="i-lucide-user"
                  :placeholder="t('sales.cart.namePlaceholder')"
                  :highlight="!hasClient && cartItems.length > 0"
                  :color="!hasClient && cartItems.length > 0 ? 'warning' : undefined"
                  @update:model-value="selectedClientName = String($event)"
                />
              </div>
              <div class="flex-1 min-h-0 overflow-y-auto">
                <SalesClientCart
                  :items="cartItems"
                  :categories="categories || []"
                  :locations="locations || []"
                  :location-remarks="locationRemarks"
                  :is-personnel="isPersonnel"
                  :total="cartTotal"
                  :disabled="!isOnline"
                  client-required
                  :client-warning="clientWarning"
                  :has-client="hasClient"
                  :submitting="isCheckingOut"
                  :print-state="printButtonState"
                  :print-warnings="printWarnings"
                  @update-quantity="updateQuantity"
                  @remove="removeFromCart"
                  @checkout="handleCheckout"
                  @clear="clearCart"
                  @update-location-remark="setLocationRemark"
                  @update:is-personnel="isPersonnel = $event"
                  @dismiss-print-warning="dismissPrintWarning"
                />
              </div>
            </div>
          </template>
        </UDrawer>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { SalesProduct, SalesCategory, SalesClient, SalesLocation } from '../../types'

const props = defineProps<{
  eventId: string
  /**
   * Pre-fetched products. When provided, OrderInterface won't call useCollectionQuery.
   * Use this for customer/helper-auth flows where the caller fetches via a
   * helper-token-protected endpoint (e.g., /api/crouton-sales/events/[id]/order-data).
   * When omitted (admin/team-member flows), defaults to fetching via useCollectionQuery.
   */
  products?: SalesProduct[]
  /** Pre-fetched categories. Same semantics as `products`. */
  categories?: SalesCategory[]
  /** Pre-fetched clients for this event's team. */
  clients?: SalesClient[]
  /** Pre-fetched locations for this event, used to label per-location remark inputs. */
  locations?: SalesLocation[]
  /** Whether this event requires orders to be linked to a client. */
  requiresClient?: boolean
  /** Collection name for products query (defaults to 'salesProducts'). Ignored when `products` is provided. */
  productsCollection?: string
  /** Collection name for categories query (defaults to 'salesCategories'). Ignored when `categories` is provided. */
  categoriesCollection?: string
  /** Currency for this event ('EUR' | 'USD', default EUR). Provided to all price displays. */
  currency?: string
  /**
   * Show admin editing affordances (add category / add product, via the
   * crouton create forms). Only enable for team-member sessions — the forms
   * post to team-scoped CRUD endpoints that helper tokens can't reach.
   */
  editable?: boolean
  /**
   * Hide the inline edit-mode pencil (tabs row). Set by hosts that render the
   * toggle themselves — e.g. the workspace Shell's narrow-mode tab strip —
   * and drive edit mode via the `editMode` model instead.
   */
  hideEditToggle?: boolean
}>()

const isOnline = useOnline()
const notify = useNotify()
const { t } = useT()

// Share the event currency with every descendant price display (cart, line
// items, option modifiers).
provideSalesCurrency(() => props.currency)
const { format: formatPrice } = useSalesCurrency(() => props.currency)

const {
  cartItems,
  cartTotal,
  selectedEventId,
  selectedClientId,
  selectedClientName,
  locationRemarks,
  isPersonnel,
  isCheckingOut,
  addToCart,
  removeFromCart,
  updateQuantity,
  syncCartProducts,
  clearCart,
  checkout,
} = usePosOrder()

// The order button is the print feedback: after checkout we watch the order's
// kitchen tickets via the helper-authed print-status endpoint and feed the
// derived state into the Cart (and the collapsed mobile bar).
const {
  buttonState: printButtonState,
  warnings: printWarnings,
  watchOrder,
  dismiss: dismissPrintWarning
} = usePrintWatcher()

// Set the event ID
selectedEventId.value = props.eventId

// When pre-fetched data is provided (helper-auth flow), skip the auto-fetch.
const usePropsData = props.products !== undefined && props.categories !== undefined

let categories: Ref<SalesCategory[]> | ComputedRef<SalesCategory[]>
let products: Ref<SalesProduct[]> | ComputedRef<SalesProduct[]>
let locations: Ref<SalesLocation[]> | ComputedRef<SalesLocation[]>
let categoriesLoading: Ref<boolean>
let productsLoading: Ref<boolean>

if (usePropsData) {
  categories = computed(() => props.categories ?? [])
  products = computed(() => props.products ?? [])
  locations = computed(() => props.locations ?? [])
  categoriesLoading = ref(false)
  productsLoading = ref(false)
}
else {
  const catsQuery = await useCollectionQuery(
    props.categoriesCollection || 'salesCategories',
    { query: computed(() => ({ eventId: props.eventId })) }
  )
  const prodsQuery = await useCollectionQuery(
    props.productsCollection || 'salesProducts',
    { query: computed(() => ({ eventId: props.eventId })) }
  )
  const locsQuery = await useCollectionQuery(
    'salesLocations',
    { query: computed(() => ({ eventId: props.eventId })) }
  )
  categories = catsQuery.items as Ref<SalesCategory[]>
  products = prodsQuery.items as Ref<SalesProduct[]>
  locations = locsQuery.items as Ref<SalesLocation[]>
  categoriesLoading = catsQuery.pending
  productsLoading = prodsQuery.pending
}

const loading = computed(() => categoriesLoading.value || productsLoading.value)

// Cart items snapshot the product at add-time, so an admin edit (location,
// price, title) would otherwise keep stale data in the cart until the item is
// re-added — e.g. the remark accordion missing a just-assigned location.
watch(products, fresh => syncCartProducts(fresh ?? []))

// Client indication is always mandatory — a ticket without any name can't be
// matched to a customer at pickup. requiresClient only decides the input kind
// (reusable client selector vs plain name field).
const hasClient = computed(() =>
  !!selectedClientId.value || !!(selectedClientName.value?.trim())
)

const clientWarning = computed(() =>
  props.requiresClient
    ? t('sales.cart.selectClient')
    : t('sales.cart.enterName', 'Enter a name to continue')
)

// Mobile cart drawer open state (closed automatically after checkout)
const mobileCartOpen = ref(false)

// Collapsed cart bar (narrow panes). Mirrors the print feedback while the
// cart is empty; with items it stays the cart summary — a pending warning
// then only swaps the icon (the rows wait inside the drawer).
const mobileBar = computed(() => {
  if (cartItems.value.length > 0) {
    return {
      label: `${t('sales.cart.title')} (${cartItems.value.length}) - ${formatPrice(cartTotal.value)}`,
      icon: printWarnings.value.length > 0 ? 'i-lucide-alert-triangle' : 'i-lucide-shopping-cart',
      color: 'primary',
      variant: 'solid',
      loading: isCheckingOut.value
    } as const
  }
  switch (printButtonState.value) {
    case 'printing':
      return { label: t('sales.cart.printing'), icon: undefined, color: 'primary', variant: 'soft', loading: true } as const
    case 'confirmed':
      return { label: t('sales.cart.printed'), icon: 'i-lucide-check', color: 'success', variant: 'soft', loading: false } as const
    case 'warning':
      return { label: t('sales.cart.printFailed'), icon: 'i-lucide-alert-triangle', color: 'warning', variant: 'soft', loading: false } as const
    default:
      return { label: t('sales.cart.empty'), icon: 'i-lucide-shopping-cart', color: 'neutral', variant: 'soft', loading: false } as const
  }
})

// Add a product to the cart. Options and any required per-item remark are
// captured inline in the product card (SalesClientProductList) and arrive here
// ready to add — no modal.
function handleProductSelect(
  product: SalesProduct,
  selectedOption?: string | string[],
  remark?: string
) {
  addToCart(product, remark, selectedOption)
}

// Categories in the admin-arranged order: displayOrder, then title. Drives
// the tab order in the POS (and the Settings tab list mirrors it).
const sortedCategories = computed(() =>
  ([...(categories.value || [])] as SalesCategory[])
    .sort((a, b) => ((a as any).displayOrder ?? 0) - ((b as any).displayOrder ?? 0) || a.title.localeCompare(b.title))
)

// Category selection. The "All" tab is hidden in the POS, so default the
// selection to the first category once they load — otherwise the tabs would
// visually highlight the first category while `selectedCategory` stays null and
// the grid shows every product.
const selectedCategory = ref<string | null>(null)

watch(sortedCategories, (cats) => {
  // Also covers the selected category being deleted from the editable POS —
  // fall back to the first remaining tab instead of pointing at a ghost id.
  const selectionGone = selectedCategory.value !== null && !cats.some(c => c.id === selectedCategory.value)
  if ((selectedCategory.value === null || selectionGone) && cats.length) {
    selectedCategory.value = cats[0]!.id
  }
}, { immediate: true })

// Admin edit mode: the editable prop only grants the CAPABILITY — the actual
// editing affordances (add/rename/reorder/inactive toggle) stay hidden until
// the admin arms them via the pencil toggle, so the kassa reads clean by
// default. A model so a host can lift the toggle out (Shell's mobile strip);
// unbound it behaves as local state.
const editMode = defineModel<boolean>('editMode', { default: false })
const editing = computed(() => !!props.editable && editMode.value)

// Admin-only: include inactive products (dimmed in the list; clicking one
// opens its edit form instead of the cart).
const showInactive = ref(false)

// Leaving edit mode also drops the inactive products back out of the list.
watch(editing, (on) => {
  if (!on) showInactive.value = false
})

// Cart quantities per category — drives the count badge on each category tab so
// it's clear how many items were added from that tab (hidden when zero).
const cartCountsByCategory = computed(() => {
  const counts: Record<string, number> = {}
  for (const item of cartItems.value) {
    const catId = item.product.categoryId
    if (catId) counts[catId] = (counts[catId] || 0) + item.quantity
  }
  return counts
})

// Filtered products based on selected category, in the same order the admin
// arranged them (sortOrder, then title). Inactive products are hidden unless
// the admin toggles them visible.
const filteredProducts = computed(() => {
  const allProducts = ([...(products.value || [])] as SalesProduct[])
    .filter(p => p.isActive !== false || (editing.value && showInactive.value))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title))
  if (selectedCategory.value === null) return allProducts
  return allProducts.filter(p => p.categoryId === selectedCategory.value)
})

// Set/update the free-text remark for a given location (writes into the
// usePosOrder locationRemarks map, included in the checkout body).
function setLocationRemark(locationId: string, value: string) {
  locationRemarks.value[locationId] = value
}

// Admin editing affordances (editable mode). Products open the crouton create
// form; categories are created inline in the tab row (draft tab via "+").
// The caller refreshes pre-fetched data on crouton:mutation (SalesPosPanel).
const { open: openCrouton } = useCrouton()

// Draft tab committed with a title → create at the end of the tab order and
// select it once the id comes back.
async function handleCategoryCreate({ title }: { title: string }) {
  const created = await createCategory({
    eventId: props.eventId,
    title,
    displayOrder: sortedCategories.value.length
  })
  if (created?.id) selectedCategory.value = created.id
}

function openCreateProduct() {
  openCrouton('create', 'salesProducts', [], 'slideover', {
    eventId: props.eventId,
    ...(selectedCategory.value ? { categoryId: selectedCategory.value } : {})
  })
}

// Pencil on the active category tab → inline rename in the tab itself; we
// just persist. (Full form incl. delete stays reachable via the settings
// panel's category list.)
async function handleCategoryRename({ id, title }: { id: string, title: string }) {
  await updateCategory(id, { title })
}

// Pencil on a product card → update form (same two-step delete).
function openEditProduct(productId: string) {
  openCrouton('update', 'salesProducts', [productId])
}

// Drag-reorder persistence: same generated /reorder path as the workspace
// ProductsTab (order = visual index within the visible set). The resulting
// 'reorder' mutation makes SalesPosPanel re-fetch order-data.
const { reorderSiblings, reordering } = useTreeMutation('salesProducts')

async function handleReorder(updates: Array<{ id: string, order: number }>) {
  if (!updates.length || reordering.value) return
  await reorderSiblings(updates)
}

// Tab drag-reorder → persist into the categories' displayOrder. Sequential
// updates (not parallel) so the panel's mutation-driven refresh lands once
// with the final order.
const { update: updateCategory, create: createCategory } = useCollectionMutation('salesCategories')
const reorderingCategories = ref(false)

async function handleCategoryReorder(updates: Array<{ id: string, order: number }>) {
  if (!updates.length || reorderingCategories.value) return
  reorderingCategories.value = true
  try {
    for (const u of updates) {
      await updateCategory(u.id, { displayOrder: u.order })
    }
  }
  finally {
    reorderingCategories.value = false
  }
}

async function handleCheckout() {
  try {
    const response = await checkout()
    // Close the mobile cart drawer once the order is placed (desktop sidebar
    // just empties as checkout() clears the cart).
    mobileCartOpen.value = false
    // No success toast — the order button itself is the feedback now. Empty
    // printQueueIds (printing disabled / no printers) means nothing to watch.
    watchOrder({
      orderId: response.order.id,
      eventId: props.eventId,
      orderNumber: response.eventOrderNumber,
      printQueueIds: response.printQueueIds ?? []
    })
  }
  catch (error) {
    // A failed order POST is an order problem, not a print problem — the
    // error toast stays.
    notify.error(t('sales.orders.error'), { description: error instanceof Error ? error.message : t('sales.orders.failedToCreate') })
  }
}
</script>
