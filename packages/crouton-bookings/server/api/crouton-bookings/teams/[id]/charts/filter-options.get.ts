/**
 * Options for the booking chart filters (#3928): GET ?key=location|status
 * → { items: [{ value, label }] }, labels in the request's language (i18n cookie).
 * Referenced by the presets' `optionsApi`. Admin-only like the chart data.
 */
import { eq } from 'drizzle-orm'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'
import { bookingsLocations } from '../../../../../../collections/locations/server/database/schema'
import { bookingsSettings } from '../../../../../../collections/settings/server/database/schema'

type Option = { value: string, label: string }

// Built-in status names (settings rows often store just the value as `label`)
const STATUS_NAMES: Record<string, Record<string, string>> = {
  confirmed: { en: 'Confirmed', nl: 'Bevestigd', fr: 'Confirmée' },
  pending: { en: 'Pending', nl: 'In afwachting', fr: 'En attente' },
  cancelled: { en: 'Cancelled', nl: 'Geannuleerd', fr: 'Annulée' }
}
const statusName = (value: string, locale: string, fallback?: string) =>
  STATUS_NAMES[value]?.[locale] || fallback || value

function parseJson(raw: unknown): any {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  try { return JSON.parse(raw) } catch { return null }
}

export default defineEventHandler(async (event) => {
  const { team } = await requireTeamAdmin(event)
  const db = useDB()
  const key = String(getQuery(event).key || '')
  const locale = String(getCookie(event, 'i18n_redirected') || 'fr')

  if (key === 'location') {
    const rows = await db.select({ id: bookingsLocations.id, title: bookingsLocations.title, translations: bookingsLocations.translations })
      .from(bookingsLocations).where(eq(bookingsLocations.teamId as any, team.id))
    const items: Option[] = (rows as any[]).map(r => ({
      value: r.id,
      label: parseJson(r.translations)?.[locale]?.title || r.title || r.id
    }))
    return { items: items.sort((a, b) => a.label.localeCompare(b.label, locale)) }
  }

  if (key === 'status') {
    const [settings] = await db.select({ statuses: bookingsSettings.statuses })
      .from(bookingsSettings).where(eq(bookingsSettings.teamId as any, team.id)).limit(1)
    const configured = parseJson((settings as any)?.statuses)
    if (Array.isArray(configured) && configured.length) {
      return {
        items: configured
          .map((s: any) => ({ value: String(s?.value ?? s?.label ?? ''), item: s }))
          .filter(({ value }) => value)
          .map(({ value, item }) => ({ value, label: String(item.translations?.[locale] || statusName(value, locale, item.label)) }))
      }
    }
    // No configured statuses: the distinct values actually used
    const rows = await db.selectDistinct({ status: bookingsBookings.status })
      .from(bookingsBookings).where(eq(bookingsBookings.teamId as any, team.id))
    return { items: (rows as any[]).filter(r => r.status).map(r => ({ value: r.status, label: statusName(r.status, locale) })) }
  }

  throw createError({ status: 400, statusText: 'Unknown filter key' })
})
