/**
 * A location's own product (#4044) — the one rule that gives a location saved
 * without `products` a product of its own. Same ids and titles as step 2's
 * one-time migration (`*_products_per_location.sql`); that migration keeps its
 * own SQL rule for the stock of rows that existed then:
 *
 * - catalog product id `'loc-' + location.id`, title = the location's title;
 * - translations = each language with a non-empty title, plus the app's
 *   default language = the location title when that language has no
 *   non-empty title;
 * - `products` = `[{ product: 'loc-<id>', stock: 1 }]` — stock 1 (#4172; the
 *   old location `quantity` / slot `capacity` are no longer read).
 */
import { eq, and, isNull } from 'drizzle-orm'
import { bookingsLocations } from '../../collections/locations/server/database/schema'
import { catalogProducts } from '@fyit/crouton-catalog/collections/products/server/database/schema'
import { requiredLocale } from '@fyit/crouton-catalog/required-locale'

export interface LocationForProduct {
  id: string
  teamId: string
  owner: string
  title: string
  translations?: unknown
  createdAt?: Date | number | null
  updatedAt?: Date | number | null
  createdBy: string
  updatedBy: string
}

export interface DefaultLocationProduct {
  catalogProduct: {
    id: string
    teamId: string
    owner: string
    order: number
    title: string
    active: boolean
    translations: Record<string, { title: string }>
    createdAt: Date
    updatedAt: Date
    createdBy: string
    updatedBy: string
  }
  products: { product: string, stock: number }[]
}

function toObject(value: unknown): Record<string, any> {
  let v = value
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { return {} }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value)
  return new Date()
}

/** Pure: the catalog product + `products` list a location without products gets. */
export function defaultLocationProduct(location: LocationForProduct, locale = 'en'): DefaultLocationProduct {
  const id = `loc-${location.id}`
  const translations: Record<string, { title: string }> = {}
  for (const [lang, value] of Object.entries(toObject(location.translations))) {
    const title = value && typeof value === 'object' ? (value as any).title : undefined
    if (typeof title === 'string' && title !== '') translations[lang] = { title }
  }
  if (!translations[locale]) translations[locale] = { title: location.title }

  return {
    catalogProduct: {
      id,
      teamId: location.teamId,
      owner: location.owner,
      order: 0,
      title: location.title,
      active: true,
      translations,
      createdAt: toDate(location.createdAt),
      updatedAt: toDate(location.updatedAt),
      createdBy: location.createdBy,
      updatedBy: location.updatedBy,
    },
    products: [{ product: id, stock: 1 }],
  }
}

/**
 * Give a stored location of `teamId` its own product when its `products` is NULL.
 * Does nothing when `products` is already set (an empty list included: an admin
 * who empties the list means it). Returns the stored row afterwards, or
 * `undefined` when the location does not exist in that team.
 */
export async function ensureLocationProducts(db: any, teamId: string, locationId: string): Promise<any> {
  const where = and(eq(bookingsLocations.id as any, locationId), eq(bookingsLocations.teamId as any, teamId))
  const [row] = await db.select().from(bookingsLocations).where(where)
  if (!row) return undefined
  if (row.products !== null && row.products !== undefined) return row

  // Same rule as the translation input: the app's default language when it is
  // configured, else the first configured language, else `en`.
  const cfg = (useRuntimeConfig() as any).croutonI18n ?? {}
  const own = defaultLocationProduct(row, requiredLocale(cfg.supportedLocales ?? [], cfg.defaultLocale))
  await db.insert(catalogProducts).values(own.catalogProduct).onConflictDoNothing()
  await db.update(bookingsLocations)
    .set({ products: own.products } as any)
    .where(and(where, isNull(bookingsLocations.products as any)))

  const [stored] = await db.select().from(bookingsLocations).where(where)
  return stored
}
