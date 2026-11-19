import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, reactive, watch, nextTick } from 'vue'

// #4110 (5a.2): the booking cart counts per product (the same rule as the server) and every
// cart item carries a product and an amount. Runs the REAL useBookingCart + useBookingAvailability
// (+ useBookingMonthlyLimit, useBookingCartStorage); only the Nuxt globals, useScheduleRules and $fetch are stubbed.
vi.mock('@vueuse/core', () => ({ useLocalStorage: (_k: string, d: unknown) => ref(d) }))

const DAY = '2026-11-10'

function baseLocations() {
  return [
    // P stock 3, Q stock 1; slots am/pm with the full day offered next to them
    { id: 'court', title: 'Court', slots: [{ id: 'am', label: 'Morning' }, { id: 'pm', label: 'Afternoon' }], offerFullDay: true, products: [{ product: 'P', stock: 3 }, { product: 'Q', stock: 1 }] },
    { id: 'single', title: 'Single', slots: [{ id: 'am', label: 'Morning' }, { id: 'pm', label: 'Afternoon' }], products: [{ product: 'P', stock: 3 }] },
    // an empty slots list → no slots
    { id: 'kayak', title: 'Kayak', slots: [], products: [{ product: 'K', stock: 8 }] },
    // one named slot → it has slots
    { id: 'one-slot', title: 'One slot', slots: [{ id: 'am', label: 'Morning' }], products: [{ product: 'K', stock: 8 }] },
    // no named slots → no slots
    { id: 'plain', title: 'Plain', slots: [], products: [{ product: 'K', stock: 2 }] },
  ]
}

// one P booking in the morning at court on DAY
function availabilityFor(locationId: string) {
  const bookings = locationId === 'court' ? [{ product: 'P', quantity: 1, slotIds: ['am'] }] : []
  return { [DAY]: { bookedSlots: bookings.flatMap(b => b.slotIds), bookings } }
}

const states = new Map<string, any>()
let locations = ref<any[]>([])
let rules = {
  isDateUnavailable: (_d: unknown) => false,
  isSlotAvailableByRules: (_id: string, _d: unknown) => true,
  getBlockedReason: (_d: unknown) => null as string | null,
  getRuleBlockedSlotIds: (_d: unknown) => [] as string[],
}

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
  }
}

beforeEach(() => {
  states.clear()
  locations = ref(baseLocations())
  rules = {
    isDateUnavailable: () => false,
    isSlotAvailableByRules: () => true,
    getBlockedReason: () => null,
    getRuleBlockedSlotIds: () => [],
  }
  const g = globalThis as any
  g.computed = computed; g.reactive = reactive; g.watch = watch; g.ref = ref
  g.useTeam = () => ({ currentTeam: ref({ id: 't1' }) })
  g.useT = () => ({ t: (k: string) => k })
  g.useNotify = () => ({ success() {}, warning() {}, error() {}, info() {} })
  g.useNuxtApp = () => ({ $i18n: { locale: ref('en') } })
  g.useState = (k: string, init: () => any) => { if (!states.has(k)) states.set(k, ref(init())); return states.get(k) }
  g.useFetch = (url: any) => ({
    data: String(url?.() ?? '').includes('customer-locations') ? locations : ref(null),
    status: ref('success'),
    refresh: async () => {},
  })
  g.useScheduleRules = () => ({
    isDateUnavailable: (d: unknown) => rules.isDateUnavailable(d),
    isSlotAvailableByRules: (id: string, d: unknown) => rules.isSlotAvailableByRules(id, d),
    getBlockedReason: (d: unknown) => rules.getBlockedReason(d),
    getRuleBlockedSlotIds: (d: unknown) => rules.getRuleBlockedSlotIds(d),
  })
  g.$fetch = async (url: string, opts: any = {}) => {
    if (url.includes('/availability')) return availabilityFor(opts.query?.locationId)
    if (url.includes('monthly-booking-count')) return { count: 0 }
    return {}
  }
})

async function cartAt(locationId: string) {
  const { useBookingCart } = await import('../app/composables/useBookingCart')
  const c = useBookingCart()
  c.formState.date = new Date(2026, 10, 10)
  c.formState.locationId = locationId
  await settle()
  return c
}

describe('cart product (#4110 S3)', () => {
  // covers: T1
  it('auto-picks the only product, resets on a location change, drops an unlisted one', async () => {
    const c = await cartAt('single')
    expect(c.formState.productId).toBe('P')

    c.formState.locationId = 'court'
    await settle()
    expect(c.formState.productId).toBeNull()

    c.formState.productId = 'Q'
    c.formState.locationId = 'single'
    await settle()
    expect(c.formState.productId).toBe('P')

    c.formState.locationId = 'court'
    await settle()
    expect(c.formState.productId).toBeNull()

    c.formState.productId = 'Q'
    await settle()
    expect(c.formState.productId).toBe('Q')
    // Q is no longer listed at court (P and R are) → dropped, and two products means no auto-pick
    locations.value = baseLocations().map(l => l.id === 'court' ? { ...l, products: [{ product: 'P', stock: 3 }, { product: 'R', stock: 1 }] } : l)
    await settle()
    expect(c.formState.productId).toBeNull()
  })
})

describe('cart counts per product (#4110 S4)', () => {
  // covers: T2
  it('one P am booking at stock 3 leaves 2 in the morning; the amount is capped by the lowest slot', async () => {
    const c = await cartAt('court')
    c.formState.productId = 'P'
    c.formState.slotIds = ['am', 'pm']
    await settle()

    expect(c.getSlotRemaining('am')).toBe(2)
    expect(c.isSlotDisabled('am')).toBe(false)
    expect(c.maxQuantity.value).toBe(2)

    c.formState.quantity = 3
    expect(c.canAddToCart.value).toBe(false)
    c.formState.quantity = 2
    expect(c.canAddToCart.value).toBe(true)

    // the P booking does not count against Q
    c.formState.productId = 'Q'
    expect(c.getSlotRemaining('am')).toBe(1)
  })

  // covers: #4112 how-to-test steps 4–5
  it('with no slot ticked the amount allows the most free in any open slot, then caps to the ticked slot', async () => {
    const c = await cartAt('court')
    c.formState.productId = 'P'
    await settle()
    // am has 2 free (one booked), pm and the full day 3 — the box reads 1/3 before a slot is picked
    expect(c.formState.slotIds).toEqual([])
    expect(c.maxQuantity.value).toBe(3)
    expect(c.canAddToCart.value).toBe(false)

    // press + once, then pick a slot → fits
    c.formState.quantity = 2
    c.formState.slotIds = ['pm']
    expect(c.maxQuantity.value).toBe(3)
    expect(c.canAddToCart.value).toBe(true)

    // a closed slot doesn't count: only am (2 free) left open
    rules.isSlotAvailableByRules = (id: string) => id === 'am'
    rules.getRuleBlockedSlotIds = () => ['pm', 'all-day']
    c.formState.slotIds = []
    expect(c.maxQuantity.value).toBe(2)
  })
})

describe('cart items carry a product and an amount (#4110 S5)', () => {
  // covers: T3
  it('addToCart stores productId and quantity, never isInventoryMode', async () => {
    const c = await cartAt('single')
    c.formState.slotIds = ['am']
    c.formState.quantity = 2
    c.addToCart()
    const item = c.cart.value[0]! as any
    expect(item.productId).toBe('P')
    expect(item.quantity).toBe(2)
    expect('isInventoryMode' in item).toBe(false)
  })

  // covers: T3
  it('a location without slots (an empty slots list) books the full day by itself', async () => {
    for (const [id, product] of [['kayak', 'K'], ['plain', 'K']] as const) {
      states.clear()
      const c = await cartAt(id)
      expect(c.hasSlots.value).toBe(false)
      expect(c.allSlots.value).toEqual([])
      expect(c.formState.slotIds).toEqual([])
      expect(c.canAddToCart.value).toBe(true)
      c.addToCart()
      const item = c.cart.value[0]!
      expect(item.slotIds).toEqual(['all-day'])
      expect(item.productId).toBe(product)
      expect(item.quantity).toBe(1)
    }
  })

  // covers: T3 (#4172)
  it('a location with one slot asks for the slot', async () => {
    const c = await cartAt('one-slot')
    expect(c.hasSlots.value).toBe(true)
    expect(c.canAddToCart.value).toBe(false)
    c.formState.slotIds = ['am']
    expect(c.canAddToCart.value).toBe(true)
    c.addToCart()
    expect(c.cart.value[0]!.slotIds).toEqual(['am'])
  })
})

describe('full day in the cart (#4110 S9, cart half)', () => {
  // covers: T4
  it('full day plus am in one request is refused', async () => {
    const c = await cartAt('court')
    c.formState.productId = 'P'
    c.formState.slotIds = ['all-day', 'am']
    expect(c.canAddToCart.value).toBe(false)
    expect(c.isSlotDisabled('all-day', ['am'])).toBe(true)
  })

  // covers: T4
  it('the full day is no longer blocked by a morning booking — it counts stock', async () => {
    const c = await cartAt('court')
    c.formState.productId = 'P'
    c.formState.slotIds = ['all-day']
    expect(c.getSlotRemaining('all-day')).toBe(2)
    expect(c.canAddToCart.value).toBe(true)
  })
})

describe('a closed slot only closes itself and the full day (#4110)', () => {
  // covers: T7
  it('pm closed by the schedule: am stays open, pm and the full day are refused', async () => {
    rules.isSlotAvailableByRules = (id: string) => id !== 'pm'
    rules.getRuleBlockedSlotIds = () => ['pm', 'all-day']
    const c = await cartAt('court')
    c.formState.productId = 'P'
    expect(c.isSlotDisabled('am')).toBe(false)
    expect(c.isSlotDisabled('pm')).toBe(true)
    expect(c.isSlotDisabled('all-day')).toBe(true)
    c.formState.slotIds = ['am']
    expect(c.canAddToCart.value).toBe(true)
  })
})
