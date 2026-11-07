import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, reactive, watch } from 'vue'

// #3379: the cart must send the calendar day the user picked (browser-local), not just the
// UTC `date` instant — in Europe/Brussels local midnight is the previous day in UTC.
// Runs the real addToCart; only Nuxt globals and the data sub-composables are stubbed.
vi.mock('@vueuse/core', () => ({ useLocalStorage: (_k: string, d: unknown) => ref(d) }))
vi.mock('../app/composables/useBookingMonthlyLimit', () => ({ useBookingMonthlyLimit: () => ({ monthlyBookingRemaining: ref(null) }) }))
vi.mock('../app/composables/useBookingCartStorage', () => ({
  useBookingCartStorage: () => ({ cartCount: ref(0), isSubmitting: ref(false), lastBookingCreatedAt: ref(0), lastCreatedBookingIds: ref([]), removeFromCart() {}, clearCart() {}, submitAll: async () => {}, cancelBooking() {}, deleteBooking() {} }),
}))
vi.mock('../app/composables/useBookingAvailability', () => ({
  useBookingAvailability: () => ({
    loading: ref(false), availabilityData: ref(null), isInventoryMode: ref(false), inventoryQuantity: ref(0),
    allSlots: ref([]), locationSlots: ref([{ id: 'am', label: 'Morning' }]), fetchAvailability() {},
    getBookedSlotsForDate: () => [], getBookedCountForDate: () => 0, isDateUnavailable: () => false,
    isSlotAvailableByRules: () => true, getBlockedReason: () => null, getRuleBlockedSlotIds: () => [],
  }),
}))

const states = new Map<string, any>()

beforeEach(() => {
  states.clear()
  const g = globalThis as any
  g.computed = computed; g.reactive = reactive; g.watch = watch; g.ref = ref
  g.useTeam = () => ({ currentTeam: ref({ id: 't1' }) })
  g.useT = () => ({ t: (k: string) => k })
  g.useState = (k: string, init: () => any) => { if (!states.has(k)) states.set(k, ref(init())); return states.get(k) }
  g.useFetch = (url: any) => ({ data: ref(String(url?.() ?? '').includes('customer-locations') ? [{ id: 'l1', title: 'Studio' }] : null), status: ref('success'), refresh: async () => {} })
})

describe('cart sends the picked calendar day (#3379)', () => {
  it('addToCart puts the browser-local day on the item, even when the UTC instant is the previous day', async () => {
    const { useBookingCart } = await import('../app/composables/useBookingCart')
    const c = useBookingCart()
    // Local midnight on 10 Nov in Europe/Brussels (TZ is set in vitest.config) = 9 Nov 23:00 UTC
    c.formState.locationId = 'l1'
    c.formState.date = new Date(2026, 10, 10)
    c.formState.slotIds = ['am']
    c.addToCart()
    const item = c.cart.value[0]!
    expect(item.date).toBe('2026-11-09T23:00:00.000Z')
    expect(item.day).toBe('2026-11-10')
  })
})
