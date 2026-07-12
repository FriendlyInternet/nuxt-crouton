/**
 * @crouton-package crouton-sales
 * @description Single source of truth for the sales print-job status domain: the
 * generic `print_jobs` status codes and the "worst status wins" combine rule.
 *
 * Lives in `shared/` so BOTH the server assembly (`my-orders-shape`,
 * `printing-reactions`, `plan-requeue`) and the client LEDs (`OrdersTab`,
 * `usePrintWatcher`, `printer-led`, `test-print-outcome`) import the same
 * definitions — previously each side hardcoded the `'0'/'1'/'2'/'9'` literals
 * and re-implemented the combine rule, which drifted independently (#1566).
 *
 * Codes are the generic `print_jobs` TEXT values, matching crouton-printing's
 * `PRINT_STATUS` and the on-site RUT956 spooler contract. A local copy (rather
 * than importing the server-only `PRINT_STATUS`) keeps this importable from
 * client code too.
 */
export const SALES_PRINT_STATUS = {
  PENDING: '0',
  PRINTING: '1',
  COMPLETED: '2',
  FAILED: '9'
} as const

export type SalesPrintStatusCode = typeof SALES_PRINT_STATUS[keyof typeof SALES_PRINT_STATUS]

export type PrintStatusBucket = 'none' | 'busy' | 'done' | 'failed'

/**
 * Combined worst status across an order's jobs: failed > busy (pending/printing)
 * > done; no jobs at all ⇒ 'none' (no LED). The one rule behind every print LED
 * — the server "my orders" bucket and the client order/printer LEDs.
 */
export function bucketPrintStatuses(statuses: string[]): PrintStatusBucket {
  if (!statuses.length) return 'none'
  if (statuses.includes(SALES_PRINT_STATUS.FAILED)) return 'failed'
  if (statuses.some(s => s === SALES_PRINT_STATUS.PENDING || s === SALES_PRINT_STATUS.PRINTING)) return 'busy'
  return 'done'
}
