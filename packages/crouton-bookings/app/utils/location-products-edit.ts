/**
 * Editing a location's `products` list in the location form (#4087). Pure — no Vue.
 *
 * The list is `[{ product, stock }]`: a team product id, stock a whole number ≥ 1, each
 * product once. `null` means "never had a product" (the server gives it an own product on
 * save); `[]` means "emptied by the admin" (not bookable until a product is added).
 */
import { parseLocationProducts } from './capacity'

export interface ListedProduct { product: string, stock: number }
export interface TeamProduct { id: string, active?: boolean | null, [k: string]: any }
export interface ProductRow extends ListedProduct {
  teamProduct: TeamProduct | undefined
  inactive: boolean
  removed: boolean
}

/** A stock value: a whole number, at least 1 (anything else becomes 1). */
export function clampStock(n: unknown): number {
  const v = Math.floor(Number(n))
  if (n === null || n === '' || !Number.isFinite(v) || v < 1) return 1
  return v
}

/** Normalise a stored value (array or JSON string). `null`/`undefined` stays `null`. */
export function normaliseProducts(value: unknown): ListedProduct[] | null {
  if (value == null) return null
  return parseLocationProducts(value).map(p => ({ product: p.product, stock: clampStock(p.stock) }))
}

/** Add `product` once; an already-listed product leaves the list unchanged. */
export function addProduct(list: ListedProduct[] | null | undefined, product: string, stock: unknown): ListedProduct[] {
  const current = (list ?? []).map(row => ({ ...row }))
  if (current.some(row => row.product === product)) return current
  return [...current, { product, stock: clampStock(stock) }]
}

/** Set one row's stock (clamped to a whole number ≥ 1). */
export function setStock(list: ListedProduct[] | null | undefined, product: string, stock: unknown): ListedProduct[] {
  return (list ?? []).map(row => row.product === product ? { ...row, stock: clampStock(stock) } : { ...row })
}

/** Remove one product. Never returns `null`: removing the last row gives `[]`. */
export function removeProduct(list: ListedProduct[] | null | undefined, product: string): ListedProduct[] {
  return (list ?? []).filter(row => row.product !== product).map(row => ({ ...row }))
}

/** Team products the picker offers: active and not yet listed, in the team list's order. */
export function pickable(teamProducts: TeamProduct[] | null | undefined, listed: ListedProduct[] | null | undefined): TeamProduct[] {
  const taken = new Set((listed ?? []).map(row => row.product))
  return (teamProducts ?? []).filter(p => p.active !== false && !taken.has(p.id))
}

/** The listed rows with their team product, flagged inactive or removed. */
export function rowsFor(listed: ListedProduct[] | null | undefined, teamProducts: TeamProduct[] | null | undefined): ProductRow[] {
  const byId = new Map((teamProducts ?? []).map(p => [p.id, p]))
  return (listed ?? []).map((row) => {
    const teamProduct = byId.get(row.product)
    return { ...row, teamProduct, inactive: teamProduct?.active === false, removed: !teamProduct }
  })
}
