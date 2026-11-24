/**
 * The price of one unit of a product with its selected options (#4481).
 *
 * Shared by the till (cart totals, `calculateItemPrice` in `usePosOrder.ts`)
 * and the server (`priceOrderItems`), so the price the till shows is the price
 * the server stores — the server never trusts a price sent in the body.
 *
 * `selectedOptions` is one option id or a list of ids. Anything else (an
 * object, a number) counts as no options; only string ids in a list match.
 */
export interface PricedProduct {
  price: number | string
  options?: { id: string, priceModifier?: number }[] | null
}

/** The option ids to price: one id, or the string ids in a list; anything else is none. */
function selectedIds(selectedOptions: unknown): string[] {
  const list = Array.isArray(selectedOptions) ? selectedOptions : [selectedOptions]
  return list.filter((id): id is string => typeof id === 'string')
}

function modifierOf(options: PricedProduct['options'], id: string): number {
  const option = (options ?? []).find(o => o?.id === id)
  return Number(option?.priceModifier) || 0
}

export function itemUnitPrice(
  product: PricedProduct,
  selectedOptions?: unknown
): number {
  return selectedIds(selectedOptions)
    .reduce((price, id) => price + modifierOf(product.options, id), Number(product.price))
}
