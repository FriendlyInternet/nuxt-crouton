import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, reactive, watch, toValue } from 'vue'

// #4314: the booking form awaited the team's product list in its setup, so it drew nothing until
// that request answered and the booking card vanished for a moment on edit. The cart now loads
// the list without waiting: `teamProducts` is [] at once and fills in when the request answers.
// Runs the REAL useBookingCart; its sub-composables and the Nuxt globals are stubbed.
vi.mock('@vueuse/core', () => ({ useLocalStorage: (_k: string, d: unknown) => ref(d) }))
vi.mock('../app/composables/useBookingMonthlyLimit', () => ({ useBookingMonthlyLimit: () => ({ monthlyBookingRemaining: ref(null) }) }))
vi.mock('../app/composables/useBookingCartStorage', () => ({
  useBookingCartStorage: () => ({ cartCount: ref(0), isSubmitting: ref(false), lastBookingCreatedAt: ref(0), lastCreatedBookingIds: ref([]), removeFromCart() {}, clearCart() {}, submitAll: async () => {}, cancelBooking() {}, deleteBooking() {} }),
}))
vi.mock('../app/composables/useBookingAvailability', () => ({
  useBookingAvailability: () => ({
    loading: ref(false), availabilityData: ref({}), hasSlots: ref(true),
    allSlots: ref([]), locationSlots: ref([]), fetchAvailability() {},
    getBookedSlotsForDate: () => [], isDateUnavailable: () => false,
    isSlotAvailableByRules: () => true, getBlockedReason: () => null, getRuleBlockedSlotIds: () => [],
  }),
}))

interface FetchCall { url: () => string | null, opts: any, data: any, refreshArgs: unknown[] }

const states = new Map<string, any>()
let calls: FetchCall[] = []
let remote: { collection: string, refresh: () => unknown }[] = []

beforeEach(() => {
  states.clear()
  calls = []
  remote = []
  const g = globalThis as any
  g.computed = computed; g.reactive = reactive; g.watch = watch; g.ref = ref
  g.useTeam = () => ({ currentTeam: ref({ id: 't1' }) })
  g.useT = () => ({ t: (k: string) => k })
  g.useI18n = () => ({ locale: ref('en') })
  g.useState = (k: string, init: () => any) => { if (!states.has(k)) states.set(k, ref(init())); return states.get(k) }
  g.useRemoteCollectionRefresh = (collection: string, refresh: () => unknown) => { remote.push({ collection, refresh }) }
  // honours opts.default, like Nuxt: data is the default until the request answers
  g.useFetch = (url: any, opts: any = {}) => {
    const data = ref(opts.default ? opts.default() : null)
    const call: FetchCall = { url, opts, data, refreshArgs: [] }
    calls.push(call)
    return { data, pending: ref(false), error: ref(null), status: ref('idle'), refresh: async (arg?: unknown) => { call.refreshArgs.push(arg) } }
  }
})

const productsCall = () => calls.find(c => String(c.url() ?? '').endsWith('/catalog-products'))

describe('useBookingCart().teamProducts (#4314)', () => {
  // covers: T3
  it('is an empty list before the request answers and the fetched products after', async () => {
    const { useBookingCart } = await import('../app/composables/useBookingCart')
    const cart = useBookingCart()
    expect(cart.teamProducts.value).toEqual([])
    const products = [{ id: 'P', title: 'Kayak', active: true }]
    productsCall()!.data.value = products
    expect(cart.teamProducts.value).toEqual(products)
  })

  // covers: T3
  it('fetches the team route without waiting: server false, dedupe defer, a team-keyed collection key', async () => {
    const { useBookingCart } = await import('../app/composables/useBookingCart')
    useBookingCart()
    const call = productsCall()!
    expect(call.url()).toBe('/api/teams/t1/catalog-products')
    expect(call.opts.server).toBe(false)
    expect(call.opts.dedupe).toBe('defer')
    expect(toValue(call.opts.key)).toBe('collection:catalogProducts:team-t1')
  })

  // covers: T3
  it('re-fetches when another user changes a product', async () => {
    const { useBookingCart } = await import('../app/composables/useBookingCart')
    useBookingCart()
    const hook = remote.find(r => r.collection === 'catalogProducts')
    expect(hook).toBeDefined()
    await hook!.refresh()
    expect(productsCall()!.refreshArgs).toEqual([{ dedupe: 'cancel' }])
  })
})
