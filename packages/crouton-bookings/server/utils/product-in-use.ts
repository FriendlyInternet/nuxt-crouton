/**
 * Why a catalog product may not be deleted (#4278): the team's locations that
 * still list it in `products` ([{ product, stock }]). Bookings that carry the
 * product never block it. Used by `server/plugins/catalog-delete-guard.ts`.
 *
 * Returns `[]` when nothing blocks, else ONE plain-language sentence naming up
 * to 5 locations (in the app's default language) and the real count.
 */
import { sql } from 'drizzle-orm'
import { resolveTranslatedField } from './booking-emails'
import { requiredLocale } from '@fyit/crouton-catalog/required-locale'

const MAX_TITLES = 5

/** Raw SQL returns the translations column as text; anything unreadable → null. */
function parseTranslations(value: unknown): Record<string, Record<string, string>> | null {
  if (value && typeof value === 'object') return value as Record<string, Record<string, string>>
  if (typeof value !== 'string' || value === '') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export async function productBlockers(db: any, teamId: string, productId: string): Promise<string[]> {
  const rows = await db.all(sql`SELECT l.id, l.title, l.translations FROM bookings_locations l WHERE l.teamId = ${teamId} AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(l.products) AND json_type(l.products) = 'array' THEN l.products ELSE '[]' END) p WHERE p.type = 'object' AND json_extract(p.value, '$.product') = ${productId}) ORDER BY l."order", l.title`) as { id: string, title: string | null, translations: unknown }[]
  if (!rows.length) return []

  const cfg = (useRuntimeConfig() as any).croutonI18n ?? {}
  const locale = requiredLocale(cfg.supportedLocales ?? [], cfg.defaultLocale)
  const titles = rows
    .slice(0, MAX_TITLES)
    .map(row => resolveTranslatedField(row.title, parseTranslations(row.translations), 'title', locale, locale))
  const n = rows.length
  const list = titles.join(', ') + (n > MAX_TITLES ? ', …' : '')
  return [`Still offered by ${n} location${n === 1 ? '' : 's'}: ${list}. Remove it there first.`]
}
