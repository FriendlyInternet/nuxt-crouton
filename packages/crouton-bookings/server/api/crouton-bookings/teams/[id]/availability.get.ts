/**
 * Get booking availability for a date range
 *
 * Supports both slot-based (which slots are booked) and inventory-based (count of bookings)
 *
 * Query params:
 * - locationId: string (required)
 * - startDate: ISO date string (required)
 * - endDate: ISO date string (required)
 * - excludeBookingId: string (optional) - exclude this booking from availability check (for editing)
 *
 * Response format:
 * {
 *   "2024-01-15": {
 *     bookedSlots: ["slot-1", "slot-2"], bookedCount: 2,
 *     bookings: [{ product: "p1", quantity: 1, slotIds: ["slot-1"] }, { product: "p1", quantity: 1, slotIds: ["slot-2"] }]
 *   },
 *   "2024-01-16": { bookedSlots: ["all-day"], bookedCount: 1, bookings: [{ product: null, quantity: 1, slotIds: ["all-day"] }] }
 * }
 *
 * `bookings` (#4109): one row per non-cancelled booking — `product` (null = old
 * row, counts against every product), `quantity` (min 1) and `slotIds` (a full
 * day is `["all-day"]`). Feed it to `leftFor` / `productLeft` / `slotStatuses`.
 */
import { eq, and, gte, lte, ne } from 'drizzle-orm'
import { organization } from '@fyit/crouton-auth/server/database/schema/auth'
import { bookingsBookings } from '../../../../../collections/bookings/server/database/schema'
import { toDateKey } from '@fyit/crouton-core/shared/utils/date'
import { FULL_DAY_ID } from '../../../../../app/utils/full-day'
import type { AvailabilityBooking } from '../../../../../app/types/booking'

export default defineEventHandler(async (event) => {
  // Public endpoint — availability data is not sensitive and must be visible
  // to non-logged-in visitors on the booking calendar page
  const teamParam = getRouterParam(event, 'id')
  if (!teamParam) {
    throw createError({ status: 400, statusText: 'Team ID is required' })
  }

  const db = useDB()
  const team = await db.select({ id: organization.id })
    .from(organization as any)
    .where(eq(organization.id as any, teamParam))
    .get()

  if (!team) {
    throw createError({ status: 404, statusText: 'Team not found' })
  }

  const query = getQuery(event)
  const locationId = query.locationId as string
  const startDateStr = query.startDate as string
  const endDateStr = query.endDate as string
  const excludeBookingId = query.excludeBookingId as string | undefined

  if (!locationId) {
    throw createError({
      status: 400,
      statusText: 'locationId is required'
    })
  }

  if (!startDateStr || !endDateStr) {
    throw createError({
      status: 400,
      statusText: 'startDate and endDate are required'
    })
  }

  const startDate = new Date(startDateStr)
  const endDate = new Date(endDateStr)

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw createError({
      status: 400,
      statusText: 'Invalid date format'
    })
  }

  // Build where conditions
  const conditions = [
    eq(bookingsBookings.teamId as any, team.id),
    eq(bookingsBookings.location as any, locationId),
    ne(bookingsBookings.status as any, 'cancelled'),
    gte(bookingsBookings.date as any, startDate),
    lte(bookingsBookings.date as any, endDate),
  ]

  // Exclude a specific booking (for editing mode)
  if (excludeBookingId) {
    conditions.push(ne(bookingsBookings.id as any, excludeBookingId))
  }

  // Get all bookings for the location in the date range
  const bookings = await db
    .select({
      date: bookingsBookings.date,
      slot: bookingsBookings.slot,
      quantity: bookingsBookings.quantity,
      product: bookingsBookings.product,
      group: bookingsBookings.group,
    })
    .from(bookingsBookings)
    .where(and(...conditions))

  // Aggregate by date
  const availabilityData: Record<string, {
    bookedSlots: string[]
    bookedCount: number
    bookedGroupSlots?: Record<string, string[]>
    bookings: AvailabilityBooking[]
  }> = {}

  for (const booking of bookings) {
    const bookingDate = booking.date instanceof Date
      ? booking.date
      : new Date(booking.date as string)
    const dateKey = toDateKey(bookingDate)

    if (!availabilityData[dateKey]) {
      availabilityData[dateKey] = { bookedSlots: [], bookedCount: 0, bookings: [] }
    }

    // Parse slot (can be JSON string or array)
    let slotIds: string[] = []
    if (booking.slot) {
      if (typeof booking.slot === 'string') {
        try {
          slotIds = JSON.parse(booking.slot)
        } catch {
          slotIds = [booking.slot]
        }
      } else if (Array.isArray(booking.slot)) {
        slotIds = booking.slot
      }
    }

    availabilityData[dateKey].bookedSlots.push(...slotIds)
    // Per-booking rows for the per-product rule; bookedSlots above keeps its old shape
    availabilityData[dateKey].bookings.push({
      product: (booking.product as string | null | undefined) ?? null,
      quantity: Math.max(1, booking.quantity ?? 1),
      slotIds: !Array.isArray(slotIds) || slotIds.length === 0 || slotIds.includes(FULL_DAY_ID)
        ? [FULL_DAY_ID]
        : slotIds.map(String),
    })
    availabilityData[dateKey].bookedCount += (booking.quantity ?? 1)

    // Track which groups booked which slots (for group uniqueness checks)
    if (booking.group) {
      if (!availabilityData[dateKey].bookedGroupSlots) {
        availabilityData[dateKey].bookedGroupSlots = {}
      }
      for (const slotId of slotIds) {
        if (!availabilityData[dateKey].bookedGroupSlots![slotId]) {
          availabilityData[dateKey].bookedGroupSlots![slotId] = []
        }
        availabilityData[dateKey].bookedGroupSlots![slotId].push(booking.group)
      }
    }
  }

  return availabilityData
})
