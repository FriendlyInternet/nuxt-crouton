import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, reactive, watch, nextTick } from 'vue'

// #4110 S6: checkout sends each cart item's product and amount to the batch route.
// Runs the REAL useBookingCart + useBookingCartStorage + useBookingAvailability; only the Nuxt
// globals, useScheduleRules and $fetch (which records the calls) are stubbed.
vi.mock('@vueuse/core', () => ({ useLocalStorage: (_k: string, d: unknown) => ref(d) }))

const states = new Map<string, any>()
let fetches: { url: string, opts: any }[] = []

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
  }
}

beforeEach(() => {
  states.clear()
  fetches = []
  const g = globalThis as any
  g.computed = computed; g.reactive = reactive; g.watch = watch; g.ref = ref
  g.useTeam = () => ({ currentTeam: ref({ id: 't1' }) })
  g.useT = () => ({ t: (k: string) => k })
  g.useNotify = () => ({ success() {}, warning() {}, error() {}, info() {} })
  g.useNuxtApp = () => ({ $i18n: { locale: ref('en') } })
  g.useState = (k: string, init: () => any) => { if (!states.has(k)) states.set(k, ref(init())); return states.get(k) }
  g.useFetch = (url: any) => ({
    data: ref(String(url?.() ?? '').includes('customer-locations')
      ? [{ id: 'kayak', title: 'Kayak', slots: [], products: [{ product: 'K', stock: 8 }] }]
      : null),
    status: ref('success'),
    refresh: async () => {},
  })
  g.useScheduleRules = () => ({
    isDateUnavailable: () => false,
    isSlotAvailableByRules: () => true,
    getBlockedReason: () => null,
    getRuleBlockedSlotIds: () => [],
  })
  g.$fetch = async (url: string, opts: any = {}) => {
    fetches.push({ url, opts })
    if (url.includes('/availability')) return { '2026-11-10': { bookedSlots: [], bookings: [] } }
    if (url.includes('customer-bookings-batch')) return { count: 1, bookings: [{ id: 'b1' }], success: true }
    return {}
  }
})

describe('checkout sends product and amount (#4110 S6)', () => {
  // covers: T5
  it('kayak, amount 3 → the batch POST carries productId K, quantity 3 and the full day', async () => {
    const { useBookingCart } = await import('../app/composables/useBookingCart')
    const c = useBookingCart()
    c.formState.date = new Date(2026, 10, 10)
    c.formState.locationId = 'kayak'
    await settle()
    c.formState.quantity = 3
    c.addToCart()
    expect(c.cart.value).toHaveLength(1)

    await c.submitAll()
    const post = fetches.find(f => f.url.endsWith('/customer-bookings-batch'))!
    expect(post).toBeTruthy()
    expect(post.opts.method).toBe('POST')
    expect(post.opts.body.bookings[0]).toMatchObject({ productId: 'K', quantity: 3, slotIds: ['all-day'] })
  })
})
