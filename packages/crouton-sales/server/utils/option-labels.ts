/**
 * @crouton-package crouton-sales
 * @description Resolve an order item's selected option IDs to their product
 * labels for the PRINT / RECEIPT path (kitchen tickets, customer receipts,
 * client-tab aggregation). The POS stores selected options as an id array (or a
 * single id string); this maps each id to its label via the joined product's
 * `options`.
 *
 * Deliberately STRICTER than `my-orders-shape.ts`'s `resolveOptionLabels`:
 * unknown ids are DROPPED, never rendered — a raw nano-id must never reach
 * physical paper (cf. the #1524 raw-option-id class of bug). The on-screen order
 * history uses the lenient variant instead (it falls back to the id so the
 * volunteer always sees *something*). Extracted from the byte-identical copies
 * that lived in `client-tab.ts` and `generate-print-queues.ts` (#1566).
 */
export function resolvePrintOptionLabels(selectedOptions: unknown, productOptions: unknown): string[] {
  if (!selectedOptions) return []
  const options = (Array.isArray(productOptions) ? productOptions : []) as Array<{ id?: string, label?: string }>
  if (options.length === 0) return []
  const ids = Array.isArray(selectedOptions)
    ? selectedOptions
    : typeof selectedOptions === 'string'
      ? [selectedOptions]
      : []
  return ids
    .map((id: string) => options.find(o => o?.id === id)?.label)
    .filter((label: string | undefined): label is string => Boolean(label))
}
