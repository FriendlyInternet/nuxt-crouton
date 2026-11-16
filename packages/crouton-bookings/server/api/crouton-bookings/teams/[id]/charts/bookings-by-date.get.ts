/**
 * Bookings over time chart endpoint
 *
 * Booking counts per MONTH (per-day points were unreadable spikes), labelled in the
 * visitor's language ("nov. 2026"). Used by the 'bookings:by-date' chart preset.
 */
import { eq } from 'drizzle-orm'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'

export default defineEventHandler(async (event) => {
  // Team-wide statistics: admins only until a chart block can grant its own audience (#3938)
  const { team } = await requireTeamAdmin(event)
  const db = useDB()
  const locale = String(getCookie(event, 'i18n_redirected') || 'fr')

  const rows = await db.select({ date: bookingsBookings.date })
    .from(bookingsBookings).where(eq(bookingsBookings.teamId as any, team.id))

  const counts = new Map<string, number>()
  for (const r of rows as any[]) {
    const d = r.date instanceof Date ? r.date : new Date(r.date)
    if (Number.isNaN(d.getTime())) continue
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' })
  return {
    items: [...counts.keys()].sort().map(key => ({
      date: fmt.format(new Date(`${key}-01T00:00:00Z`)),
      count: counts.get(key)!
    }))
  }
})
