import { computed, inject, provide, ref, type InjectionKey, type Ref } from 'vue'
import type { Booking, LocationData } from '../types/booking'
import { isDayFullyBooked } from '../utils/day-availability'

/**
 * The bookings screen's shared state, in one place (#2561).
 *
 * Filters, the selected day, the hovered booking, the date of the "new booking"
 * form, which week/month the calendar shows and where the list scrolls. The Panel owns one; a page composed
 * from bookings blocks owns one — never shared between screens. The store holds no
 * data: it is handed the bookings and locations the page already loads.
 */

export interface BookingsFilterState {
  statuses: string[]
  locations: string[]
  showCancelled: boolean
}

export type StartCreateResult = 'started' | 'read-only' | 'no-locations' | 'closed' | 'full'
export type ClosedReason = { kind: 'closed' } | { kind: 'blocked', reason?: string }

export interface BookingsStoreSources {
  /** What the list shows (e.g. my bookings). */
  bookings: Ref<Booking[]>
  /** Everything taking a slot (the whole team) — decides whether a day is full. */
  calendarBookings: Ref<Booking[]>
  locations: Ref<LocationData[]>
  /** Preview mode: nothing can be created. */
  readOnly: Ref<boolean>
  initialFilters?: Partial<BookingsFilterState>
}

interface BlockedRange { startDate: string, endDate: string, blockedSlots?: string[], reason?: string }

/** A JSON column that may arrive as a string or already parsed. */
function parseList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The whole-day block covering `key`, if any (a block naming only some slots doesn't count). */
function fullDayBlock(blocked: BlockedRange[], key: string): BlockedRange | undefined {
  return blocked.find(b => b.startDate && b.endDate && key >= b.startDate && key <= b.endDate && !b.blockedSlots?.length)
}

export function createBookingsStore(src: BookingsStoreSources) {
  const filters = ref<BookingsFilterState>({
    statuses: src.initialFilters?.statuses ?? [],
    locations: src.initialFilters?.locations ?? [],
    showCancelled: src.initialFilters?.showCancelled ?? false,
  })
  /** The one selected day — highlights its bookings and shows its New booking row. */
  const selectedDate = ref<Date | null>(null)
  /** The period the calendar shows (the week or month containing this date). */
  const shownDate = ref(new Date())
  /** Where the list scrolls. A fresh Date each time, so the same day can be targeted again. */
  const scrollTarget = ref<Date | null>(null)
  const hoveredBookingId = ref<string | null>(null)
  const creatingAt = ref<Date | null>(null)

  // ── Filters ────────────────────────────────────────────────────────────────
  const hasActiveFilters = computed(() =>
    filters.value.statuses.length > 0 || filters.value.locations.length > 0 || filters.value.showCancelled,
  )

  const filteredBookings = computed(() => {
    const f = filters.value
    return src.bookings.value.filter(b =>
      (f.showCancelled || b.status !== 'cancelled')
      && (f.statuses.length === 0 || f.statuses.includes(b.status))
      && (f.locations.length === 0 || f.locations.includes(b.location)),
    )
  })

  function toggleLocation(locationId: string) {
    const current = filters.value.locations
    filters.value.locations = current.includes(locationId) ? current.filter(id => id !== locationId) : [...current, locationId]
  }

  // ── Days, hover, navigation ────────────────────────────────────────────────
  function scrollTo(date: Date) {
    scrollTarget.value = new Date(date)
  }

  /** A day was tapped in the calendar (its period is already on screen). */
  function selectDay(date: Date) {
    selectedDate.value = date
    scrollTo(date)
  }

  /** A booking's date (or Today) was tapped: select it, show its period, scroll there. */
  function selectDate(date: Date) {
    selectDay(date)
    shownDate.value = date
  }

  function goToToday() {
    selectDate(new Date())
  }

  /** The list scrolled: the calendar follows with the period of the top visible day. */
  function showPeriod(date: Date) {
    shownDate.value = date
  }

  function hover(id: string | null) {
    hoveredBookingId.value = id
  }

  // ── Opening hours ──────────────────────────────────────────────────────────
  const schedules = computed(() => src.locations.value.map((location) => {
    const openDays = parseList<number>(location.openDays)
    return { openDays: openDays.length ? openDays : null, blocked: parseList<BlockedRange>(location.blockedDates) }
  }))

  /** Why no location takes bookings on this day — or null when at least one is open. */
  function closedReason(date: Date): ClosedReason | null {
    const rules = schedules.value
    if (rules.length === 0) return null
    const weekday = date.getDay()
    const key = localDateKey(date)
    const shut = rules.every(r => (r.openDays && !r.openDays.includes(weekday)) || fullDayBlock(r.blocked, key))
    if (!shut) return null
    if (rules.every(r => r.openDays && !r.openDays.includes(weekday))) return { kind: 'closed' }
    for (const r of rules) {
      const block = fullDayBlock(r.blocked, key)
      if (block) return { kind: 'blocked', reason: block.reason || undefined }
    }
    return { kind: 'closed' }
  }

  /** Every location's every slot is taken on this day (by anyone on the team). */
  function isFullyBooked(date: Date): boolean {
    return isDayFullyBooked(date, src.locations.value, src.calendarBookings.value)
  }

  // ── New booking ────────────────────────────────────────────────────────────
  function startCreate(date: Date): StartCreateResult {
    if (src.readOnly.value) return 'read-only'
    if (src.locations.value.length === 0) return 'no-locations'
    if (closedReason(date)) return 'closed'
    if (isFullyBooked(date)) return 'full'
    creatingAt.value = date
    scrollTo(date)
    return 'started'
  }

  function cancelCreate() {
    creatingAt.value = null
  }

  /**
   * The new booking was saved: close the form, let the page reload its data,
   * then scroll the list to the new booking's day.
   */
  async function finishCreate(reload?: () => Promise<unknown>): Promise<Date | null> {
    const date = creatingAt.value
    creatingAt.value = null
    await reload?.()
    if (date) scrollTo(date)
    return date
  }

  return {
    filters, hasActiveFilters, filteredBookings, toggleLocation,
    selectedDate, selectDay, selectDate, goToToday, shownDate, showPeriod, scrollTarget,
    hoveredBookingId, hover,
    closedReason, isFullyBooked,
    creatingAt, startCreate, cancelCreate, finishCreate,
  }
}

export type BookingsStore = ReturnType<typeof createBookingsStore>

const BOOKINGS_STORE_KEY: InjectionKey<BookingsStore> = Symbol('croutonBookingsStore')

/** Create this screen's store and share it with the bookings components under it. */
export function provideBookingsStore(src: BookingsStoreSources): BookingsStore {
  const store = createBookingsStore(src)
  provide(BOOKINGS_STORE_KEY, store)
  return store
}

/** The store of the screen this component is on, or null outside one. */
export function useBookingsStore(): BookingsStore | null {
  return inject(BOOKINGS_STORE_KEY, null)
}
