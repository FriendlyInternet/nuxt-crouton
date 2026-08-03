/**
 * @crouton-package crouton-sales
 * @description Pure request-shaping for the team-authed orders list endpoint
 * (`teams/[id]/events/[eventId]/orders.get.ts`) — kept DB-free so it's unit
 * tested (`test/order-filters.test.ts`), the same split as `my-orders-shape`.
 * The endpoint stays a thin fetch → build-where → delegate handler.
 */

export interface OrderFilters {
  owner?: string
  clientId?: string
  printerId?: string
  printStatus?: string
}

// Print-status buckets (crouton-printing job status is TEXT '0'|'1'|'2'|'9'):
// busy = pending or printing, done = completed, failed = errored. Mirrors the
// OrdersTab LED bucketing so the filter and the dot agree.
export const PRINT_STATUS_BUCKETS: Record<string, string[]> = {
  busy: ['0', '1'],
  done: ['2'],
  failed: ['9']
}

/** The job-status values a print-status filter matches, or null for "no filter". */
export function printStatusBucket(printStatus?: string | null): string[] | null {
  if (!printStatus) return null
  return PRINT_STATUS_BUCKETS[printStatus] ?? null
}

function trimmed(value: unknown): string | undefined {
  return value ? String(value) : undefined
}

/** Read the four supported order filters off a raw query object. */
export function parseOrderFilters(query: Record<string, unknown>): OrderFilters {
  return {
    owner: trimmed(query.owner),
    clientId: trimmed(query.clientId),
    printerId: trimmed(query.printerId),
    printStatus: trimmed(query.printStatus)
  }
}

/** Clamp page/pageSize to sane bounds and derive the offset. */
export function parsePageParams(query: Record<string, unknown>, defaultPageSize = 25) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || defaultPageSize))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/**
 * locationRemarks is a JSON column that can come back as a raw string — revive
 * it in place, defaulting a malformed value to null so a bad row can never 500
 * the register (the generated queries guard the same way). Mutates + returns.
 */
export function parseLocationRemarks<T extends { locationRemarks?: unknown }>(rows: T[]): T[] {
  for (const row of rows) {
    if (typeof row.locationRemarks !== 'string') continue
    try {
      row.locationRemarks = JSON.parse(row.locationRemarks)
    }
    catch {
      row.locationRemarks = null
    }
  }
  return rows
}
