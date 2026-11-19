import { useLocalStorage } from '@vueuse/core'
import type { LocationData, SlotItem, BookingData, SettingsData, CartItem } from '../types/booking'
import { isBlockedByFullDay, FULL_DAY_ID } from '../utils/full-day'
import { parseLocationProducts, slotIdsOf, type CapacityLocation } from '../utils/capacity'
import { productLeft } from '../utils/product-left'
import { toDateKey, isSameDay } from '@fyit/crouton-core/shared/utils/date'
import { useBookingMonthlyLimit } from './useBookingMonthlyLimit'
import { useBookingCartStorage } from './useBookingCartStorage'
import { useBookingAvailability } from './useBookingAvailability'

/**
 * Composable for managing the booking cart and customer booking flow.
 * Every booking is for one product and an amount; what is free is counted per
 * product, cart-aware, with the server's rule (`utils/product-left.ts` over
 * `utils/capacity.ts`, #4110). A location without slots (no slots = the parsed
 * `slots` list is empty) books the full day.
 *
 * Delegates to focused sub-composables:
 *   - useBookingAvailability  — base API availability, schedule rules, slot parsing
 *   - useBookingCartStorage   — localStorage persistence, cart CRUD, submit/cancel/delete
 *   - useBookingMonthlyLimit  — monthly booking limit tracking per location
 */
export function useBookingCart() {
  const { currentTeam } = useTeam()
  const { t } = useT()

  // Team ID from auth context (consistent with useBookingsList)
  const teamId = computed(() => currentTeam.value?.id)

  // Read customer bookings from shared cache (useBookingsList owns the fetch).
  // The key carries the team id, so a team change (e.g. the team arriving after mount)
  // re-fetches once per key — no separate watch, so no cancellation cascade (#3751).
  // dedupe: 'defer' on every fetch here: each owner of a shared key re-runs it when the key
  // changes, and Nuxt's default 'cancel' would abort the other owners' request (#3789).
  // The manual refreshers returned below pass 'cancel' so a save still gets fresh data.
  const { data: myBookings, status: myBookingsStatus, refresh: rawRefreshMyBookings } = useFetch<BookingData[]>(
    () => teamId.value
      ? `/api/crouton-bookings/teams/${teamId.value}/customer-bookings`
      : null as any,
    {
      key: () => `crouton-booking-sidebar-customer-bookings-${teamId.value ?? 'none'}`,
      dedupe: 'defer',
      server: false,
    },
  )

  const refreshMyBookings = () => rawRefreshMyBookings({ dedupe: 'cancel' })

  // Count of upcoming bookings (future dates only)
  const upcomingBookingsCount = computed(() => {
    if (!myBookings.value) return 0
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return (myBookings.value as BookingData[]).filter((b: any) => {
      const bookingDate = new Date(b.date)
      return bookingDate >= now
    }).length
  })

  // Sidebar open state (for mobile)
  const isOpen = useState('croutonBookingSidebar', () => false)

  // Active tab: 'book' or 'my-bookings'
  const activeTab = useState('croutonBookingSidebarTab', () => 'book')

  // Cart drawer open state (bottom drawer)
  const isCartOpen = useState('croutonBookingCartDrawer', () => false)

  // Expanded state (XL mode with map)
  const isExpanded = useState('croutonBookingSidebarExpanded', () => false)

  // Cart pulse animation trigger (increments when item added)
  const cartPulse = useState('croutonBookingCartPulse', () => 0)

  // Fetch booking settings (for enableGroups and groups options)
  const { data: settingsData } = useFetch<SettingsData[]>(
    () => teamId.value
      ? `/api/teams/${teamId.value}/bookings-settings`
      : null as any,
    {
      key: () => `crouton-booking-cart-settings-${teamId.value ?? 'none'}`,
      dedupe: 'defer',
      server: false,
    },
  )

  // Settings computed values
  const groupOptions = computed(() => (settingsData.value as any)?.[0]?.groups ?? [])
  // Enable groups if there are any group options defined
  const enableGroups = computed(() => groupOptions.value.length > 0)

  // Form state - use useState for shared state across components
  const formStateRef = useState<{
    locationId: string | null
    date: Date | null
    slotIds: string[]
    groupId: string | null
    productId: string | null
    quantity: number
    editingBookingId: string | null
  }>('croutonBookingFormState', () => ({
    locationId: null,
    date: null,
    slotIds: [],
    groupId: null,
    productId: null,
    quantity: 1,
    editingBookingId: null,
  }))

  // Create a reactive wrapper to maintain the existing API
  const formState = reactive({
    get locationId() { return formStateRef.value.locationId },
    set locationId(v: string | null) { formStateRef.value.locationId = v },
    get date() { return formStateRef.value.date },
    set date(v: Date | null) { formStateRef.value.date = v },
    get slotIds() { return formStateRef.value.slotIds },
    set slotIds(v: string[]) { formStateRef.value.slotIds = v },
    get groupId() { return formStateRef.value.groupId },
    set groupId(v: string | null) { formStateRef.value.groupId = v },
    get productId() { return formStateRef.value.productId ?? null },
    set productId(v: string | null) { formStateRef.value.productId = v },
    get quantity() { return formStateRef.value.quantity },
    set quantity(v: number) { formStateRef.value.quantity = v },
    get editingBookingId() { return formStateRef.value.editingBookingId },
    set editingBookingId(v: string | null) { formStateRef.value.editingBookingId = v },
  })

  // Fetch allowed locations
  const { data: locations, status: locationsStatus, refresh: rawRefreshLocations } = useFetch<LocationData[]>(
    () => teamId.value
      ? `/api/crouton-bookings/teams/${teamId.value}/customer-locations`
      : null as any,
    {
      key: () => `crouton-booking-cart-locations-${teamId.value ?? 'none'}`,
      dedupe: 'defer',
      server: false,
      default: () => [],
    },
  )

  const refreshLocations = () => rawRefreshLocations({ dedupe: 'cancel' })

  // Selected location object
  const selectedLocation = computed(() => {
    if (!formState.locationId || !locations.value) return null
    return (locations.value as LocationData[]).find((l: any) => l.id === formState.locationId) || null
  })

  // --- Availability sub-composable (replaces inline availability logic) ---
  const locationIdRef = computed(() => formState.locationId)
  const selectedLocationRef = computed(() => selectedLocation.value ?? null)

  const {
    loading: availabilityLoading,
    availabilityData,
    hasSlots,
    allSlots,
    locationSlots: rawSlots,
    fetchAvailability: baseFetchAvailability,
    getBookedSlotsForDate: getApiBookedSlotsForDate,
    isDateUnavailable,
    isSlotAvailableByRules,
    getBlockedReason,
    getRuleBlockedSlotIds,
  } = useBookingAvailability(locationIdRef, selectedLocationRef)

  // Monthly booking limit
  const monthlyBookingLimit = computed(() => selectedLocation.value?.maxBookingsPerMonth ?? null)

  // Cart persisted in localStorage — single ref passed to useBookingCartStorage
  const cart = useLocalStorage<CartItem[]>('crouton-booking-cart', [])

  // --- Monthly limit sub-composable ---
  const selectedDateRef = computed(() => formState.date)
  const editingBookingIdRef = computed(() => formState.editingBookingId)

  const {
    monthlyBookingRemaining,
  } = useBookingMonthlyLimit(
    teamId,
    locationIdRef,
    selectedDateRef,
    monthlyBookingLimit,
    cart,
    editingBookingIdRef,
  )

  // --- Cart storage sub-composable ---
  const refreshMyBookingsWrapper = async () => { await refreshMyBookings() }

  const {
    cartCount,
    isSubmitting,
    lastBookingCreatedAt,
    lastCreatedBookingIds,
    removeFromCart,
    clearCart,
    submitAll: submitAllRaw,
    cancelBooking,
    deleteBooking,
  } = useBookingCartStorage(
    teamId,
    refreshMyBookingsWrapper,
    isCartOpen,
    activeTab,
    cartPulse,
    cart,
  )

  // Fetch availability with excludeBookingId support for editing
  function fetchAvailability(startDate: Date, endDate: Date) {
    baseFetchAvailability(startDate, endDate, formState.editingBookingId ?? undefined)
  }

  // Wrap submitAll to re-fetch availability after successful submission
  // so the next BookingCreateCard shows correct slot availability
  async function submitAll() {
    const result = await submitAllRaw()
    if (result && formState.locationId) {
      const now = new Date()
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      const endDate = new Date(now.getFullYear(), now.getMonth() + 3, 0)
      fetchAvailability(startDate, endDate)
    }
    return result
  }

  // === Cart-aware availability (overlays cart data on top of API data) ===

  // Get booked slots from cart for a specific date and location
  function getCartBookedSlotsForDate(date: Date): string[] {
    if (!formState.locationId) return []

    return cart.value
      .filter(item =>
        item.locationId === formState.locationId
        && isSameDay(new Date(item.date), date),
      )
      .flatMap(item => item.slotIds)
  }

  // === Product + amount (#4110) ===

  // The products the selected location lists, with their stock
  const locationProducts = computed(() => parseLocationProducts(selectedLocation.value?.products))

  // Keep the picked product valid: drop it when it is no longer listed, and
  // pick it automatically when the location lists exactly one.
  function syncProduct() {
    const listed = locationProducts.value
    if (formState.productId && !listed.some(p => p.product === formState.productId)) {
      formState.productId = null
    }
    if (!formState.productId && listed.length === 1) {
      formState.productId = listed[0]!.product
    }
  }

  // A location change resets the product. Sync, so a caller that sets the
  // location and then the product in the same tick keeps its product.
  watch(() => formState.locationId, () => {
    formState.productId = null
    syncProduct()
  }, { flush: 'sync' })

  // The location's product list changed (fetched, edited) — re-check the pick
  watch(() => locationProducts.value.map(p => p.product).join(','), () => {
    syncProduct()
  }, { immediate: true })

  // The slots this booking takes: the ticked ones, or the full day at a
  // location without slots (derived, so it can't race the card's slot reset)
  const selectedSlotIds = computed<string[]>(() => hasSlots.value ? formState.slotIds : [FULL_DAY_ID])

  // The location as the counting rule sees it (no slots when it has none)
  const capLocation = computed<CapacityLocation>(() => ({
    slots: hasSlots.value ? rawSlots.value : [],
    products: selectedLocation.value?.products,
  }))

  // Free stock of `product` in `slotId` on `date`: the server's bookings plus the cart
  function productLeftFor(slotId: string, product: string, date: Date | null = formState.date): number {
    if (!date || !formState.locationId) return 0
    const day = toDateKey(date)
    return productLeft({
      location: capLocation.value,
      locationId: formState.locationId,
      day,
      product,
      bookings: availabilityData.value[day]?.bookings ?? [],
      cart: cart.value,
      slotId,
    })
  }

  // How many of the chosen product are still free in a slot on the selected
  // date. With no product picked: the highest over the listed products, so a
  // slot shows full only when every product is full there.
  function getSlotRemaining(slotId: string): number {
    if (formState.productId) return Math.max(0, productLeftFor(slotId, formState.productId))
    return Math.max(0, ...locationProducts.value.map(p => productLeftFor(slotId, p.product)))
  }

  // The largest amount that fits: the lowest free stock over the chosen slots.
  // With no slot ticked yet: the most free in any slot still open, so the
  // amount can be set before or after picking a slot (#4112).
  const maxQuantity = computed(() => {
    const ids = selectedSlotIds.value
    if (ids.length > 0) return Math.min(...ids.map(id => getSlotRemaining(id)))
    const open = allSlots.value.filter(slot => !isSlotDisabled(slot.id, []))
    return Math.max(0, ...open.map(slot => getSlotRemaining(slot.id)))
  })

  // Check if a group+slot combination is already booked (API data)
  function isGroupSlotBookedInApi(slotId: string, groupId: string, date: Date): boolean {
    const dateKey = toDateKey(date)
    const groupSlots = availabilityData.value[dateKey]?.bookedGroupSlots
    return groupSlots?.[slotId]?.includes(groupId) ?? false
  }

  // Check if a group+slot combination is already in the cart
  function isGroupSlotInCart(slotId: string, groupId: string, date: Date): boolean {
    if (!formState.locationId) return false
    return cart.value.some(item =>
      item.locationId === formState.locationId
      && item.slotIds.includes(slotId)
      && item.groupId === groupId
      && isSameDay(new Date(item.date), date),
    )
  }

  // Has the selected group already booked this slot (server or cart)?
  function isGroupBlocked(slotId: string): boolean {
    if (!enableGroups.value || !formState.groupId || !formState.date) return false
    return isGroupSlotBookedInApi(slotId, formState.groupId, formState.date)
      || isGroupSlotInCart(slotId, formState.groupId, formState.date)
  }

  // Closed by the schedule on the selected date? Closing any slot also closes
  // the full day (getRuleBlockedSlotIds adds `all-day` then).
  function isRuleClosed(slotId: string): boolean {
    if (!formState.date) return true
    return !isSlotAvailableByRules(slotId, formState.date)
      || getRuleBlockedSlotIds(formState.date).includes(slotId)
  }

  // Check if a slot button is disabled (locations with slots only)
  // `selected` = slots ticked in the booking being made; pass [] to ask "is it
  // taken?" regardless of the current ticks
  function isSlotDisabled(slotId: string, selected: string[] = formState.slotIds): boolean {
    if (!formState.date || !hasSlots.value) return true

    if (isRuleClosed(slotId)) return true

    // Full when the chosen product has no stock left there (#4110)
    if (getSlotRemaining(slotId) <= 0) return true

    // When groups are enabled and a group is selected, check if this group already booked this slot
    if (isGroupBlocked(slotId)) return true

    // The full day can't share one booking with another slot (#2261). Across
    // bookings it is stock that counts, not exclusivity (#4110).
    return isBlockedByFullDay(slotId, [], selected)
  }

  // Compute available slots (locations with slots only; allSlots is empty otherwise)
  const availableSlots = computed<SlotItem[]>(() => {
    if (!formState.date || !selectedLocation.value) return []
    return allSlots.value.filter(slot => !isSlotDisabled(slot.id))
  })

  // === Calendar availability helpers (API + cart combined) ===

  // Get all booked slots for a date (API + cart combined) - slot mode
  function getBookedSlotsForDate(date: Date): string[] {
    const apiBooked = getApiBookedSlotsForDate(date)
    const cartBooked = getCartBookedSlotsForDate(date)
    return [...apiBooked, ...cartBooked]
  }

  // Check if a date has any bookings (server or cart) at the selected location
  function hasBookingsOnDate(date: Date): boolean {
    const apiBookings = availabilityData.value[toDateKey(date)]?.bookings ?? []
    if (apiBookings.length > 0) return true
    if (!formState.locationId) return false
    return cart.value.some(item =>
      item.locationId === formState.locationId
      && isSameDay(new Date(item.date), date),
    )
  }

  // Fully booked = every listed product has no stock left in every slot
  // (same rule as isLocationFull); never full when no product is listed
  function isDateFullyBooked(date: Date): boolean {
    const products = locationProducts.value
    if (products.length === 0) return false
    const ids = slotIdsOf(capLocation.value)
    return products.every(p => ids.every(id => productLeftFor(id, p.product, date) <= 0))
  }

  // Get booked slot labels for tooltip display (slot mode)
  function getBookedSlotLabelsForDate(date: Date): string[] {
    const bookedIds = getBookedSlotsForDate(date)
    return bookedIds.map(id => getSlotLabel(id))
  }

  // Fetch availability when location or editing state changes
  watch([() => formState.locationId, () => formState.editingBookingId], () => {
    availabilityData.value = {}
    if (formState.locationId) {
      // Fetch 3 months of availability
      const now = new Date()
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      const endDate = new Date(now.getFullYear(), now.getMonth() + 3, 0)
      fetchAvailability(startDate, endDate)
    }
  }, { immediate: true })

  // === Cart operations ===

  // Can add to cart — a product, slots that all fit, and an amount within the free stock
  const canAddToCart = computed(() => {
    // Must have location and date
    if (!formState.locationId || !formState.date) return false

    // Check schedule rules - date must be available
    if (isDateUnavailable(formState.date)) return false

    // Every booking is for one product
    if (!formState.productId) return false

    const selected = selectedSlotIds.value
    if (selected.length === 0) return false

    // Every chosen slot must be open, free for the group, and not the full day
    // combined with another slot in this one booking
    if (hasSlots.value && !selected.every(id =>
      !isRuleClosed(id)
      && !isGroupBlocked(id)
      && !isBlockedByFullDay(id, [], selected),
    )) return false

    // The amount must fit in every chosen slot
    const quantity = formState.quantity
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity.value) return false

    // If groups are enabled, require a group selection
    if (enableGroups.value && !formState.groupId) return false

    // Check monthly booking limit
    if (monthlyBookingRemaining.value !== null && monthlyBookingRemaining.value <= 0) return false

    return true
  })

  // Generate unique ID
  function generateId() {
    return Math.random().toString(36).substring(2, 9)
  }

  // Get slot label by ID
  function getSlotLabel(slotId: string): string {
    if (slotId === 'all-day') return t('bookings.allDay')
    const slot = rawSlots.value.find(s => s.id === slotId)
    return slot?.label || slot?.value || slotId
  }

  // Get group label by ID
  function getGroupLabel(groupId: string | null): string | null {
    if (!groupId) return null
    const group = groupOptions.value.find((g: any) => g.id === groupId)
    return group?.label || groupId
  }

  // Get slot position info by ID
  function getSlotPositionInfo(slotId: string): { color?: string, totalSlots: number, position: number } | null {
    if (slotId === 'all-day') return null
    const slots = rawSlots.value
    if (!slots.length) return null
    const position = slots.findIndex(s => s.id === slotId)
    if (position === -1) return null
    return {
      // Color is now at location level, not slot level
      color: selectedLocation.value?.color || undefined,
      totalSlots: slots.length,
      position,
    }
  }

  // Toggle a slot in/out of the selected slotIds array
  function toggleSlot(slotId: string) {
    const idx = formState.slotIds.indexOf(slotId)
    if (idx >= 0) {
      formState.slotIds = formState.slotIds.filter(id => id !== slotId)
    }
    else {
      formState.slotIds = [...formState.slotIds, slotId]
    }
  }

  // Add current selection to cart
  function addToCart() {
    if (!canAddToCart.value || !selectedLocation.value || !formState.date) {
      return
    }

    // The full day at a location without slots (never the old `inventory` id)
    const slotIds = [...selectedSlotIds.value]
    const slotLabels = slotIds.map(id => getSlotLabel(id))

    const item: CartItem = {
      id: generateId(),
      locationId: formState.locationId!,
      locationTitle: selectedLocation.value.title,
      date: formState.date.toISOString(),
      day: toDateKey(formState.date),
      slotIds,
      slotLabels,
      groupId: formState.groupId,
      groupLabel: getGroupLabel(formState.groupId),
      productId: formState.productId,
      quantity: formState.quantity,
    }

    // Add slot position info at a location with slots (use first selected slot)
    if (hasSlots.value && slotIds.length > 0) {
      const positionInfo = getSlotPositionInfo(slotIds[0]!)
      if (positionInfo) {
        item.slotColor = positionInfo.color
        item.totalSlots = positionInfo.totalSlots
        item.slotPosition = positionInfo.position
      }
    }

    cart.value.push(item)

    // Reset form for next booking (the product stays picked)
    formState.slotIds = []
    formState.groupId = null
    formState.quantity = 1

    // Trigger pulse animation on cart button
    cartPulse.value++
  }

  // Reset form state
  function resetForm() {
    formState.locationId = null
    formState.date = null
    formState.slotIds = []
    formState.groupId = null
    formState.productId = null
    formState.quantity = 1
  }

  return {
    // State
    cart,
    isOpen,
    isCartOpen,
    isExpanded,
    activeTab,
    formState,
    isSubmitting,
    availabilityLoading,
    cartPulse,

    // Slots + product + amount (#4110)
    hasSlots,
    selectedSlotIds,
    maxQuantity,
    locationProducts,

    // Monthly booking limit
    monthlyBookingLimit,
    monthlyBookingRemaining,

    // Settings (groups)
    enableGroups,
    groupOptions,

    // Locations
    locations,
    locationsStatus,
    refreshLocations,
    selectedLocation,
    allSlots,
    availableSlots,
    rawSlots,
    isSlotDisabled,
    getSlotRemaining,

    // Calendar availability helpers
    hasBookingsOnDate,
    isDateFullyBooked,
    getBookedSlotLabelsForDate,
    getBookedSlotsForDate,

    // Schedule rules
    isDateUnavailable,
    getBlockedReason,
    getRuleBlockedSlotIds,

    // My Bookings
    myBookings,
    myBookingsStatus,
    refreshMyBookings,

    // Computed
    canAddToCart,
    cartCount,
    upcomingBookingsCount,
    teamId,

    // Actions
    addToCart,
    toggleSlot,
    removeFromCart,
    clearCart,
    submitAll,
    resetForm,
    cancelBooking,
    deleteBooking,
    fetchAvailability,

    // Signals
    lastBookingCreatedAt,
    lastCreatedBookingIds,
  }
}
