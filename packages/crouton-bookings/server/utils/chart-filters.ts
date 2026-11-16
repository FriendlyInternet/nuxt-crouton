/**
 * Filters for the booking chart endpoints (#3928) — one place for all of them.
 *
 * Query params (all optional, malformed values ignored):
 *   from / to  YYYY-MM-DD, inclusive, as calendar days in the booking timezone
 *   location   location id
 *   status     status value
 */
import { and, eq, gte, lt } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { bookingsBookings } from '../../collections/bookings/server/database/schema'
import { dayRange } from './booking-capacity'

export interface BookingChartFilters {
  /** first instant included (start of `from` day) */
  fromDate?: Date
  /** first instant excluded (start of the day after `to`) */
  toDate?: Date
  location?: string
  status?: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[\w-]{1,64}$/

/** Pure: query object + timezone → validated filters. */
export function parseBookingChartFilters(query: Record<string, unknown>, tz: string): BookingChartFilters {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : Array.isArray(v) && typeof v[0] === 'string' ? v[0].trim() : '')
  const f: BookingChartFilters = {}
  const from = str(query.from)
  const to = str(query.to)
  if (DATE.test(from)) {
    const r = dayRange(from, tz)
    if (r) f.fromDate = new Date(r.dayStartTs * 1000)
  }
  if (DATE.test(to)) {
    const r = dayRange(to, tz)
    if (r) f.toDate = new Date(r.dayEndTs * 1000)
  }
  const location = str(query.location)
  if (ID.test(location)) f.location = location
  const status = str(query.status)
  if (ID.test(status)) f.status = status
  return f
}

/** Drizzle WHERE for one team's bookings under these filters. */
export function bookingChartWhere(teamId: string, f: BookingChartFilters) {
  const b = bookingsBookings as any
  const conditions = [eq(b.teamId, teamId)]
  if (f.fromDate) conditions.push(gte(b.date, f.fromDate))
  if (f.toDate) conditions.push(lt(b.date, f.toDate))
  if (f.location) conditions.push(eq(b.location, f.location))
  if (f.status) conditions.push(eq(b.status, f.status))
  return and(...conditions)
}

/** Read + validate the filters from a chart request. */
export function bookingChartFiltersFromEvent(event: H3Event): BookingChartFilters {
  const tz = (useRuntimeConfig(event) as any).croutonBookings?.timezone || 'Europe/Brussels'
  return parseBookingChartFilters(getQuery(event) as Record<string, unknown>, tz)
}
