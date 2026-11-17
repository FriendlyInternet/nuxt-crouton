/**
 * A location's own product (#4044) — the one rule that gives a location saved
 * without `products` a product of its own. Same rule as step 2's one-time
 * migration (`*_products_per_location.sql`), so rows written later end up
 * exactly like the rows that migration converted:
 *
 * - catalog product id `'loc-' + location.id`, title = the location's title;
 * - translations = each language with a non-empty title, plus `en` = the
 *   location title when there is no non-empty English title;
 * - `products` = `[{ product: 'loc-<id>', stock }]`, stock = `quantity` in
 *   inventory mode, otherwise the highest slot capacity; at least 1.
 */
import { eq, and, isNull } from 'drizzle-orm'
import { bookingsLocations } from '../../collections/locations/server/database/schema'
import { catalogProducts } from '@fyit/crouton-catalog/collections/products/server/database/schema'
import { parseSlots } from './booking-capacity'

export interface LocationForProduct {
  id: string
  teamId: string
  owner: string
  title: string
  translations?: unknown
  inventoryMode?: boolean | number | null
  quantity?: number | null
  slots?: unknown
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

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) ? n : null
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value)
  return new Date()
}

/** The stock a location's own product gets: quantity, or the highest slot capacity; at least 1. */
export function defaultLocationStock(location: Pick<LocationForProduct, 'inventoryMode' | 'quantity' | 'slots'>): number {
  let raw: number | null
  if (location.inventoryMode) {
    raw = toInt(location.quantity)
  }
  else {
    const caps = parseSlots(location.slots).map(s => toInt(s?.capacity)).filter((c): c is number => c !== null)
    raw = caps.length ? Math.max(...caps) : null
  }
  return Math.max(1, raw ?? 1)
}

/** Pure: the catalog product + `products` list a location without products gets. */
export function defaultLocationProduct(location: LocationForProduct): DefaultLocationProduct {
  const id = `loc-${location.id}`
  const translations: Record<string, { title: string }> = {}
  for (const [lang, value] of Object.entries(toObject(location.translations))) {
    const title = value && typeof value === 'object' ? (value as any).title : undefined
    if (typeof title === 'string' && title !== '') translations[lang] = { title }
  }
  if (!translations.en) translations.en = { title: location.title }

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
    products: [{ product: id, stock: defaultLocationStock(location) }],
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

  const own = defaultLocationProduct(row)
  await db.insert(catalogProducts).values(own.catalogProduct).onConflictDoNothing()
  await db.update(bookingsLocations)
    .set({ products: own.products } as any)
    .where(and(where, isNull(bookingsLocations.products as any)))

  const [stored] = await db.select().from(bookingsLocations).where(where)
  return stored
}
