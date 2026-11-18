/**
 * Product picker visibility (#4109) — pure, no Vue. The booking form shows a
 * product picker only when the location offers 2 or more products that are
 * active in the team (`active !== false`, the same rule as `location-products-edit.ts`).
 */
import { parseLocationProducts, type CapacityLocation } from './capacity'

export function showProductPicker(
  location: Pick<CapacityLocation, 'products'>,
  teamProducts: { id: string, active?: boolean | null }[] | null | undefined,
): boolean {
  const active = new Set((teamProducts ?? []).filter(p => p.active !== false).map(p => p.id))
  return parseLocationProducts(location.products).filter(p => active.has(p.product)).length >= 2
}
