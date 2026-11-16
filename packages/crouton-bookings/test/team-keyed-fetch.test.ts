import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, reactive, watch, toValue } from 'vue'

// #3751: the bookings blocks fetched once at mount with a FIXED useFetch key. A fixed key turns off
// Nuxt's re-fetch on URL change, so a block that mounted before the team was known (phone width:
// the admin sidebar is a drawer, blocks mount earlier) stayed on "No locations yet" forever.
// The key must carry the team id so the team arriving re-runs the fetch — while blocks that share
// a cache on purpose still compute the same key for the same team.
vi.mock('@vueuse/core', () => ({ useLocalStorage: (_k: string, d: unknown) => ref(d) }))
vi.mock('../app/composables/useBookingMonthlyLimit', () => ({ useBookingMonthlyLimit: () => ({ monthlyBookingRemaining: ref(null) }) }))
vi.mock('../app/composables/useBookingCartStorage', () => ({
  useBookingCartStorage: () => ({ cartCount: ref(0), isSubmitting: ref(false), lastBookingCreatedAt: ref(0), lastCreatedBookingIds: ref([]), removeFromCart() {}, clearCart() {}, submitAll: async () => {}, cancelBooking() {}, deleteBooking() {} }),
}))
vi.mock('../app/composables/useBookingAvailability', () => ({
  useBookingAvailability: () => ({
    loading: ref(false), availabilityData: ref(null), isInventoryMode: ref(false), inventoryQuantity: ref(0),
    allSlots: ref([]), locationSlots: ref([]), fetchAvailability() {},
    getBookedSlotsForDate: () => [], getBookedCountForDate: () => 0, isDateUnavailable: () => false,
    isSlotAvailableByRules: () => true, getBlockedReason: () => null, getRuleBlockedSlotIds: () => [],
  }),
}))

interface FetchCall { url: () => string | null, opts: { key?: unknown, dedupe?: string }, refreshArgs: unknown[] }

const states = new Map<string, any>()
let calls: FetchCall[] = []
const currentTeam = ref<{ id: string } | null>(null)

beforeEach(() => {
  states.clear()
  calls = []
  currentTeam.value = null
  const g = globalThis as any
  g.computed = computed; g.reactive = reactive; g.watch = watch; g.ref = ref
  g.useTeam = () => ({ currentTeam })
  g.useT = () => ({ t: (k: string) => k })
  g.useI18n = () => ({ locale: ref('en') })
  g.useState = (k: string, init: () => any) => { if (!states.has(k)) states.set(k, ref(init())); return states.get(k) }
  g.useFetch = (url: any, opts: any = {}) => {
    const call: FetchCall = { url, opts, refreshArgs: [] }
    calls.push(call)
    return { data: ref(opts.default ? opts.default() : null), pending: ref(false), error: ref(null), status: ref('idle'), refresh: async (arg?: unknown) => { call.refreshArgs.push(arg) } }
  }
})

const keyOf = (c: FetchCall) => String(toValue(c.opts.key as any))
const urlOf = (c: FetchCall) => String(c.url() ?? '')

async function loadAll() {
  const { useBookingsList } = await import('../app/composables/useBookingsList')
  const { useBookingCart } = await import('../app/composables/useBookingCart')
  const { useBookingOptions } = await import('../app/composables/useBookingOptions')
  return { useBookingsList, useBookingCart, useBookingOptions }
}

function expectKeysFollowTeam(expectedCount: number) {
  expect(calls).toHaveLength(expectedCount)
  const before = calls.map(keyOf)
  currentTeam.value = { id: 't1' }
  const after = calls.map(keyOf)
  calls.forEach((_c, i) => {
    expect(after[i]).not.toBe(before[i])
    expect(after[i]).toContain('t1')
  })
}

describe('bookings fetch keys carry the team id (#3751)', () => {
  it('refetches when the team arrives after mount — useBookingsList team scope', async () => {
    const { useBookingsList } = await loadAll()
    useBookingsList({ scope: 'team' })
    expectKeysFollowTeam(3)
  })

  it('refetches when the team arrives after mount — useBookingsList personal scope (incl. calendar-bookings)', async () => {
    const { useBookingsList } = await loadAll()
    useBookingsList({ scope: 'personal' })
    expectKeysFollowTeam(4)
    expect(calls.some(c => urlOf(c).includes('calendar-bookings'))).toBe(true)
  })

  it('refetches when the team arrives after mount — useBookingCart and useBookingOptions', async () => {
    const { useBookingCart, useBookingOptions } = await loadAll()
    useBookingCart()
    expectKeysFollowTeam(3)
    calls = []
    currentTeam.value = null
    useBookingOptions()
    expectKeysFollowTeam(1)
  })

  it('shared cache is still shared — personal customer-bookings key equals the cart my-bookings key', async () => {
    const { useBookingsList, useBookingCart } = await loadAll()
    currentTeam.value = { id: 't1' }
    useBookingsList({ scope: 'personal' })
    const listKey = keyOf(calls.find(c => urlOf(c).endsWith('/customer-bookings'))!)
    calls = []
    useBookingCart()
    const cartKey = keyOf(calls.find(c => urlOf(c).endsWith('/customer-bookings'))!)
    expect(listKey).toBe(cartKey)
  })

  it('teams do not share a cache — same fetch, different team, different key', async () => {
    const { useBookingsList } = await loadAll()
    useBookingsList({ scope: 'team' })
    currentTeam.value = { id: 't1' }
    const t1 = calls.map(keyOf)
    currentTeam.value = { id: 't2' }
    const t2 = calls.map(keyOf)
    t1.forEach((k, i) => expect(t2[i]).not.toBe(k))
  })
})

// #3789: several blocks own the same key and EACH re-runs it when the team arrives. With Nuxt's
// default dedupe 'cancel' every owner aborted the one before it (~a dozen cancelled requests per
// load of the blocks page). The fetches join a running request ('defer'); explicit refreshes still
// force fresh data ('cancel') so a save is never answered from a stale in-flight request.
describe('shared bookings fetches join, not cancel (#3789)', () => {
  const CANCEL = { dedupe: 'cancel' }

  it('every useFetch in useBookingsList (team + personal), useBookingCart and useBookingOptions sets dedupe: defer', async () => {
    const { useBookingsList, useBookingCart, useBookingOptions } = await loadAll()
    const counts: number[] = []
    for (const run of [
      () => useBookingsList({ scope: 'team' }),
      () => useBookingsList({ scope: 'personal' }),
      () => useBookingCart(),
      () => useBookingOptions(),
    ]) {
      const start = calls.length
      run()
      counts.push(calls.length - start)
    }
    expect(counts).toEqual([3, 4, 3, 1])
    expect(calls.every(c => c.opts.dedupe === 'defer')).toBe(true)
  })

  it('useBookingsList().refresh() forces fresh data', async () => {
    const { useBookingsList } = await loadAll()
    const { refresh } = useBookingsList({ scope: 'personal' })
    await refresh()
    expect(calls).toHaveLength(4)
    calls.forEach(c => expect(c.refreshArgs).toEqual([CANCEL]))
  })

  it('useBookingCart refreshMyBookings / refreshLocations force fresh data', async () => {
    const { useBookingCart } = await loadAll()
    const cart = useBookingCart()
    await cart.refreshMyBookings()
    await cart.refreshLocations()
    const mine = calls.find(c => urlOf(c).endsWith('/customer-bookings') || keyOf(c).includes('customer-bookings'))!
    const locs = calls.find(c => keyOf(c).includes('cart-locations'))!
    expect(mine.refreshArgs).toEqual([CANCEL])
    expect(locs.refreshArgs).toEqual([CANCEL])
  })

  it('useBookingOptions refresh forces fresh data', async () => {
    const { useBookingOptions } = await loadAll()
    const { refresh } = useBookingOptions()
    await refresh()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.refreshArgs).toEqual([CANCEL])
  })
})
