import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { createBookingsStore } from '../app/composables/useBookingsStore'

/**
 * #2561 step 1 — the bookings screen's shared state lives in ONE store.
 *
 * Today the Panel holds it all inside the component (filters, the selected day,
 * hovered booking, the "new booking" date, which period the calendar shows and
 * where the list scrolls), and the layout blocks keep a second copy of the filters.
 * Day selection follows the calendar cleanup (#2724): one day at a time. Extracted,
 * the Panel and (later) the layout blocks read the same store, and each page
 * gets its own — nothing is shared between two screens.
 *
 * The store holds no data of its own: it is handed the bookings and locations
 * the page already loads.
 */

const loc = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, ...extra })
const booking = (id: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ id, teamId: 't', location: 'a', date, slot: '[]', status: 'confirmed', createdAt: date, ...extra })

function setup(opts: { bookings?: any[], calendar?: any[], locations?: any[], readOnly?: boolean } = {}) {
  const bookings = ref(opts.bookings ?? [])
  const calendarBookings = ref(opts.calendar ?? opts.bookings ?? [])
  const locations = ref(opts.locations ?? [loc('a')])
  const readOnly = ref(opts.readOnly ?? false)
  return createBookingsStore({ bookings, calendarBookings, locations, readOnly })
}

const day = (s: string) => new Date(`${s}T12:00:00`)

describe('filters', () => {
  const list = [
    booking('1', '2026-11-02', { status: 'confirmed', location: 'a' }),
    booking('2', '2026-11-02', { status: 'pending', location: 'b' }),
    booking('3', '2026-11-03', { status: 'cancelled', location: 'a' }),
  ]

  it('hides cancelled bookings until "show cancelled" is on', () => {
    const s = setup({ bookings: list })
    expect(s.filteredBookings.value.map(b => b.id)).toEqual(['1', '2'])
    s.filters.value.showCancelled = true
    expect(s.filteredBookings.value.map(b => b.id)).toEqual(['1', '2', '3'])
  })

  it('narrows by status and by location', () => {
    const s = setup({ bookings: list })
    s.filters.value.statuses = ['pending']
    expect(s.filteredBookings.value.map(b => b.id)).toEqual(['2'])
    s.filters.value.statuses = []
    s.toggleLocation('a')
    expect(s.filteredBookings.value.map(b => b.id)).toEqual(['1'])
  })

  it('tapping a location on the map twice removes it again', () => {
    const s = setup()
    s.toggleLocation('a')
    s.toggleLocation('a')
    expect(s.filters.value.locations).toEqual([])
    expect(s.hasActiveFilters.value).toBe(false)
  })

  it('starts from the filters the page asks for', () => {
    const bookings = ref([])
    const s = createBookingsStore({ bookings, calendarBookings: bookings, locations: ref([]), readOnly: ref(false), initialFilters: { showCancelled: true } })
    expect(s.filters.value.showCancelled).toBe(true)
    expect(s.hasActiveFilters.value).toBe(true)
  })
})

describe('selecting a day and hovering', () => {
  it('tapping a day selects it and scrolls the list there; tapping another day replaces it', () => {
    const s = setup()
    s.selectDay(day('2026-11-02'))
    expect(s.selectedDate.value).toEqual(day('2026-11-02'))
    expect(s.scrollTarget.value).toEqual(day('2026-11-02'))
    s.selectDay(day('2026-11-05'))
    expect(s.selectedDate.value).toEqual(day('2026-11-05'))
  })

  it('remembers which booking is hovered, and forgets it', () => {
    const s = setup()
    s.hover('1')
    expect(s.hoveredBookingId.value).toBe('1')
    s.hover(null)
    expect(s.hoveredBookingId.value).toBeNull()
  })

  it('tapping a booking\'s date selects that day, shows its week and scrolls there — every time', () => {
    const s = setup()
    s.selectDate(day('2026-11-02'))
    expect(s.selectedDate.value).toEqual(day('2026-11-02'))
    expect(s.shownDate.value).toEqual(day('2026-11-02'))
    const first = s.scrollTarget.value
    s.selectDate(day('2026-11-02')) // the same day again is a new scroll request
    expect(s.scrollTarget.value).toEqual(first)
    expect(s.scrollTarget.value).not.toBe(first)
  })

  it('Today selects today and shows it', () => {
    const s = setup()
    s.showPeriod(day('2027-03-01'))
    s.goToToday()
    const today = new Date()
    expect(s.selectedDate.value?.toDateString()).toBe(today.toDateString())
    expect(s.shownDate.value.toDateString()).toBe(today.toDateString())
  })

  it('scrolling the list moves the calendar to that period without selecting', () => {
    const s = setup()
    s.showPeriod(day('2026-12-01'))
    expect(s.shownDate.value).toEqual(day('2026-12-01'))
    expect(s.selectedDate.value).toBeNull()
  })
})

describe('starting a new booking on a date', () => {
  it('opens the new-booking form on that date and scrolls the list to it', () => {
    const s = setup()
    expect(s.startCreate(day('2026-11-02'))).toBe('started')
    expect(s.creatingAt.value).toEqual(day('2026-11-02'))
    expect(s.scrollTarget.value).toEqual(day('2026-11-02'))
  })

  it('does nothing in read-only (preview) mode or without locations', () => {
    expect(setup({ readOnly: true }).startCreate(day('2026-11-02'))).toBe('read-only')
    expect(setup({ locations: [] }).startCreate(day('2026-11-02'))).toBe('no-locations')
  })

  it('refuses a day every location is closed (Monday, open Tue–Sat)', () => {
    const s = setup({ locations: [loc('a', { openDays: [2, 3, 4, 5, 6] })] })
    expect(s.startCreate(day('2026-11-02'))).toBe('closed')
    expect(s.creatingAt.value).toBeNull()
  })

  it('refuses a day blocked for the whole day, but not one blocked for some slots', () => {
    const blocked = [{ startDate: '2026-11-02', endDate: '2026-11-03', reason: 'Holiday' }]
    const partly = [{ startDate: '2026-11-02', endDate: '2026-11-02', blockedSlots: ['am'] }]
    expect(setup({ locations: [loc('a', { blockedDates: blocked })] }).startCreate(day('2026-11-03'))).toBe('closed')
    expect(setup({ locations: [loc('a', { blockedDates: partly })] }).startCreate(day('2026-11-02'))).toBe('started')
  })

  it('says why a day is closed: weekly closing day vs a blocked date with its reason', () => {
    const s = setup({ locations: [loc('a', { openDays: [2, 3, 4, 5, 6], blockedDates: JSON.stringify([{ startDate: '2026-11-04', endDate: '2026-11-04', reason: 'Holiday' }]) })] })
    expect(s.closedReason(day('2026-11-02'))).toEqual({ kind: 'closed' })
    expect(s.closedReason(day('2026-11-04'))).toEqual({ kind: 'blocked', reason: 'Holiday' })
    expect(s.closedReason(day('2026-11-03'))).toBeNull()
  })

  it('refuses a day that is fully booked everywhere — counting the whole team, not just mine', () => {
    const slots = [{ id: 'am', capacity: 1 }, { id: 'pm', capacity: 1 }]
    const team = [booking('x', '2026-11-02', { slot: '["am"]' }), booking('y', '2026-11-02', { slot: '["pm"]' })]
    const s = setup({ bookings: [], calendar: team, locations: [loc('a', { slots })] })
    expect(s.startCreate(day('2026-11-02'))).toBe('full')
    expect(s.creatingAt.value).toBeNull()
  })

  it('a cancelled booking frees its slot again', () => {
    const team = [booking('x', '2026-11-02', { status: 'cancelled' })]
    expect(setup({ calendar: team }).startCreate(day('2026-11-02'))).toBe('started')
  })

  it('cancelling closes the form', () => {
    const s = setup()
    s.startCreate(day('2026-11-02'))
    s.cancelCreate()
    expect(s.creatingAt.value).toBeNull()
  })

  it('after saving, the form closes and — once the data is reloaded — the list scrolls to that date', async () => {
    const s = setup()
    s.startCreate(day('2026-11-02'))
    s.selectDay(day('2026-11-20')) // scroll somewhere else meanwhile
    const order: string[] = []
    const date = await s.finishCreate(async () => { order.push(`reload, scroll ${s.scrollTarget.value?.getDate()}`) })
    expect(date).toEqual(day('2026-11-02'))
    expect(s.creatingAt.value).toBeNull()
    expect(order).toEqual(['reload, scroll 20'])
    expect(s.scrollTarget.value).toEqual(day('2026-11-02'))
  })
})

describe('one store per screen', () => {
  it('two stores share nothing', () => {
    const a = setup()
    const b = setup()
    a.selectDay(day('2026-11-02'))
    a.toggleLocation('a')
    a.startCreate(day('2026-11-02'))
    expect(b.selectedDate.value).toBeNull()
    expect(b.filters.value.locations).toEqual([])
    expect(b.creatingAt.value).toBeNull()
  })
})
