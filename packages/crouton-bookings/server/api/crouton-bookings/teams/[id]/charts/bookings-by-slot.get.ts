/**
 * Bookings by Time Slot chart endpoint
 *
 * Booking counts per slot, labelled by the slot's NAME (not its id) and merged across
 * locations by name — "Matin" at two fleets is one bar. The built-in full day gets its
 * localized name. Used by the 'bookings:by-slot' chart preset.
 */
import { eq } from 'drizzle-orm'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { bookingChartFiltersFromEvent, bookingChartWhere } from '../../../../../utils/chart-filters'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'
import { bookingsLocations } from '../../../../../../collections/locations/server/database/schema'

const FULL_DAY: Record<string, string> = { en: 'All day', nl: 'Hele dag', fr: 'Toute la journée' }

function parseList(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

export default defineEventHandler(async (event) => {
  // Team-wide statistics: admins only until a chart block can grant its own audience (#3938)
  const { team } = await requireTeamAdmin(event)
  const where = bookingChartWhere(team.id, bookingChartFiltersFromEvent(event))
  const db = useDB()
  const locale = String(getCookie(event, 'i18n_redirected') || 'fr')

  const locations = await db.select({ id: bookingsLocations.id, slots: bookingsLocations.slots })
    .from(bookingsLocations).where(eq(bookingsLocations.teamId as any, team.id))
  const labelOf = new Map<string, string>()
  for (const loc of locations as any[]) {
    for (const s of parseList(loc.slots)) if (s?.id) labelOf.set(String(s.id), String(s.label || s.id))
  }

  const bookings = await db.select({ slot: bookingsBookings.slot })
    .from(bookingsBookings).where(where)
  const counts = new Map<string, number>()
  for (const b of bookings as any[]) {
    for (const id of parseList(b.slot)) {
      const label = id === 'all-day' ? (FULL_DAY[locale] ?? FULL_DAY.en!) : (labelOf.get(String(id)) ?? String(id))
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }

  return { items: [...counts].map(([slot, count]) => ({ slot, count })).sort((a, b) => b.count - a.count) }
})
