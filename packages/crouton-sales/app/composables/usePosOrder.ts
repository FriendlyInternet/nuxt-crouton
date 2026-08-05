/**
 * @crouton-package crouton-sales
 * @description POS order management - cart, checkout, and price calculations
 * @requires Generated sales layer with products, orders, orderItems collections
 */

// Product option structure (stored in product.options JSON field)
export interface ProductOption {
  id: string
  label: string
  priceModifier: number
}

// Product with typed options array
export interface SalesProduct {
  id: string
  title: string
  price: number | string
  eventId: string
  categoryId?: string
  locationId?: string
  description?: string
  isActive?: boolean
  requiresRemark?: boolean
  remarkPrompt?: string
  hasOptions?: boolean
  multipleOptionsAllowed?: boolean
  options?: ProductOption[]
  // Sortable position column. Named `order` to match the generated backend
  // (schema column, /reorder query, order-data) and useTreeMutation's payload
  // key — the whole reorder chain is keyed on `order`, not `sortOrder`.
  order?: number
}

export interface CartItem {
  product: SalesProduct
  quantity: number
  remarks?: string
  selectedOptions?: string | string[]
}

interface OrderItem {
  productId: string
  quantity: number
  price: number
  productName?: string
  remarks?: string
  selectedOptions?: string | string[]
}

interface CreateOrderResponse {
  order: {
    id: string
    eventOrderNumber: string
    status: string
  }
  items: unknown[]
  eventOrderNumber: string
  /** Kitchen-ticket jobs queued by the order POST — empty when printing is
   * disabled or no printer matched. Feeds usePrintWatcher. */
  printQueueIds: string[]
}

function areOptionsEqual(a?: string | string[], b?: string | string[]): boolean {
  if (a === b) return true
  if (!a && !b) return true
  if (!a || !b) return false

  const arrA = Array.isArray(a) ? a : [a]
  const arrB = Array.isArray(b) ? b : [b]

  if (arrA.length !== arrB.length) return false
  const sortedA = [...arrA].sort()
  const sortedB = [...arrB].sort()
  return sortedA.every((val, i) => val === sortedB[i])
}

export interface UsePosOrderOptions {
  /** API base path for orders, defaults to '/api/sales/events' */
  apiBasePath?: string
}

/**
 * Calculate item price including option modifiers
 */
export function calculateItemPrice(item: CartItem): number {
  let price = Number(item.product.price)
  if (item.selectedOptions && item.product.options) {
    const optionIds = Array.isArray(item.selectedOptions)
      ? item.selectedOptions
      : [item.selectedOptions]
    for (const id of optionIds) {
      const option = item.product.options.find(o => o.id === id)
      if (option?.priceModifier) {
        price += option.priceModifier
      }
    }
  }
  return price
}

/**
 * POS Order composable for cart management and checkout
 *
 * @example
 * ```ts
 * const { cartItems, addToCart, checkout } = usePosOrder()
 *
 * // Add product to cart
 * addToCart(product, 'Extra sauce', ['option-1'])
 *
 * // Checkout
 * selectedEventId.value = 'event-123'
 * const order = await checkout()
 * ```
 */
export function usePosOrder(options: UsePosOrderOptions = {}) {
  const {
    apiBasePath = '/api/crouton-sales/events'
  } = options

  // Always send the helper token explicitly (see useHelperHeaders for why).
  const { helperHeaders } = useHelperHeaders()

  // Captured at setup: checkout emits crouton:mutation after awaits, where
  // useNuxtApp() would lose the Nuxt context.
  const nuxtApp = useNuxtApp()

  const cartItems = ref<CartItem[]>([])
  const selectedEventId = ref<string | null>(null)
  const selectedClientId = ref<string | null>(null)
  const selectedClientName = ref<string | null>(null)
  const overallRemarks = ref<string | null>(null)
  // Free-text remark per location, keyed by locationId. Printed on that
  // location's kitchen ticket; never becomes an order item, so it is invisible
  // to all sales aggregations.
  const locationRemarks = ref<Record<string, string>>({})
  const isPersonnel = ref(false)
  const isCheckingOut = ref(false)

  const cartTotal = computed(() =>
    cartItems.value.reduce((sum, item) => sum + (calculateItemPrice(item) * item.quantity), 0)
  )

  const cartItemCount = computed(() =>
    cartItems.value.reduce((sum, item) => sum + item.quantity, 0)
  )

  const isEmpty = computed(() => cartItems.value.length === 0)

  /**
   * Add a product to the cart
   * Merges with existing item if product, remarks, and options match
   */
  function addToCart(
    product: SalesProduct,
    remarks?: string,
    selectedOptions?: string | string[]
  ) {
    // Normalize: empty array is treated as no options
    const normalizedOptions = Array.isArray(selectedOptions) && selectedOptions.length === 0
      ? undefined
      : selectedOptions

    // Find existing item with same product, remarks, and options
    const existing = cartItems.value.find(i =>
      i.product.id === product.id &&
      i.remarks === remarks &&
      areOptionsEqual(i.selectedOptions, normalizedOptions)
    )

    if (existing) {
      existing.quantity++
    }
    else {
      cartItems.value.push({ product, quantity: 1, remarks, selectedOptions: normalizedOptions })
    }
  }

  /**
   * Remove an item from the cart by index
   */
  function removeFromCart(index: number) {
    if (index >= 0 && index < cartItems.value.length) {
      cartItems.value.splice(index, 1)
    }
  }

  /**
   * Update the quantity of a cart item
   * If quantity is 0 or less, the item is removed
   */
  function updateQuantity(index: number, quantity: number) {
    if (index >= 0 && index < cartItems.value.length) {
      if (quantity <= 0) {
        removeFromCart(index)
      }
      else {
        const item = cartItems.value[index]
        if (item) {
          item.quantity = quantity
        }
      }
    }
  }

  /**
   * Re-point cart items at fresh product rows (matched by id) after a catalog
   * refresh — cart items snapshot the product at add-time, so an admin edit
   * (location, price, title) made while the item sits in the cart would
   * otherwise stay stale until re-added.
   */
  function syncCartProducts(products: SalesProduct[]) {
    if (!products.length) return
    const byId = new Map(products.map(product => [product.id, product]))
    for (const item of cartItems.value) {
      const updated = byId.get(item.product.id)
      if (updated) item.product = updated
    }
  }

  /**
   * Clear the entire cart
   */
  function clearCart() {
    cartItems.value = []
    overallRemarks.value = null
    locationRemarks.value = {}
    isPersonnel.value = false
  }

  /**
   * Get the price for a specific cart item (including option modifiers)
   */
  function getItemPrice(item: CartItem): number {
    return calculateItemPrice(item)
  }

  /**
   * Get the line total for a cart item (price * quantity)
   */
  function getItemTotal(item: CartItem): number {
    return calculateItemPrice(item) * item.quantity
  }

  /**
   * Checkout and create an order
   * @throws Error if no event selected or cart is empty
   */
  async function checkout(): Promise<CreateOrderResponse> {
    if (!selectedEventId.value) {
      throw new Error('No event selected')
    }

    if (cartItems.value.length === 0) {
      throw new Error('Cart is empty')
    }

    isCheckingOut.value = true

    try {
      // Build order items with adjusted prices for options
      const items: OrderItem[] = cartItems.value.map(item => ({
        productId: item.product.id,
        quantity: item.quantity,
        price: calculateItemPrice(item),
        productName: item.product.title,
        remarks: item.remarks,
        selectedOptions: item.selectedOptions
      }))

      // Only send remarks for locations that actually have an item in this
      // order (remarks ride along on an existing kitchen ticket) and drop
      // blank entries.
      const locationIdsInCart = new Set(
        cartItems.value
          .map(item => item.product.locationId)
          .filter((id): id is string => Boolean(id))
      )
      const cleanedLocationRemarks: Record<string, string> = {}
      for (const [locationId, remark] of Object.entries(locationRemarks.value)) {
        const trimmed = remark?.trim()
        if (trimmed && locationIdsInCart.has(locationId)) {
          cleanedLocationRemarks[locationId] = trimmed
        }
      }

      // Create order via API
      const response = await $fetch<CreateOrderResponse>(
        `${apiBasePath}/${selectedEventId.value}/orders`,
        {
          method: 'POST',
          headers: helperHeaders(),
          body: {
            items,
            total: cartTotal.value,
            clientId: selectedClientId.value,
            clientName: selectedClientName.value,
            overallRemarks: overallRemarks.value,
            locationRemarks: Object.keys(cleanedLocationRemarks).length > 0
              ? cleanedLocationRemarks
              : undefined,
            isPersonnel: isPersonnel.value
          }
        }
      )

      // The order POST bypasses useCollectionMutation, so emit the mutation
      // hook ourselves — open views (clients panel, anything watching
      // salesOrders) refresh live instead of only on remount.
      await nuxtApp.hooks.callHook('crouton:mutation', {
        operation: 'create',
        collection: 'salesOrders',
        itemId: response.order.id,
        data: { eventId: selectedEventId.value, clientId: selectedClientId.value },
        result: response.order,
        correlationId: `pos-checkout-${response.order.id}`,
        timestamp: Date.now()
      })

      // Clear cart after successful checkout
      clearCart()
      selectedClientId.value = null
      selectedClientName.value = null

      return response
    }
    finally {
      isCheckingOut.value = false
    }
  }

  return {
    // State — cartItems is mutated only via this composable's own methods
    // (addToCart/updateQuantity/etc); consumers treat it as read-only via the
    // `readonly CartItem[]` prop on the cart components.
    cartItems,
    selectedEventId,
    selectedClientId,
    selectedClientName,
    overallRemarks,
    locationRemarks,
    isPersonnel,
    isCheckingOut: readonly(isCheckingOut),

    // Computed
    cartTotal,
    cartItemCount,
    isEmpty,

    // Methods
    addToCart,
    removeFromCart,
    updateQuantity,
    syncCartProducts,
    clearCart,
    getItemPrice,
    getItemTotal,
    checkout
  }
}

export default usePosOrder
