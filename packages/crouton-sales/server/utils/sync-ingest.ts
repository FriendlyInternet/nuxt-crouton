/**
 * @crouton-package crouton-sales
 * @description Cloud-side apply for the D1 live mirror (#178, epic #175).
 *
 * Takes the batched outbox events the Pi pusher (#177) sends and applies each as
 * an **idempotent upsert keyed by the entity's nanoid** into the mirrored tables
 * (`salesOrders` / `salesOrderitems` / `salesPrintqueues`). This is the ONLY
 * writer of mirrored venue data on the cloud; D1 stays otherwise read-mostly.
 *
 * Idempotency: UPDATE-by-id, and INSERT only when the row is absent. Replaying
 * the same batch therefore converges to identical state (no duplicate rows). A
 * partial *transition* payload (e.g. printstatus → done) updates only the fields
 * it carries; a full *create* payload inserts the row. If a transition arrives
 * before its create (row missing → INSERT fails NOT NULL), the event is reported
 * as a non-permanent skip so the pusher retries it after the create lands.
 *
 * Per-event isolation: one bad event never aborts the batch — partial batches
 * are explicitly allowed, and the caller acks precisely what was applied.
 *
 * The collection tables (`collections/*`) are imported lazily, same pattern as
 * generate-print-queues.ts.
 */
import { eq, getTableColumns } from 'drizzle-orm'
import type { OutboxEntityType } from './sync-outbox'

export interface IngestEvent {
  /** Stable event id from the outbox (used for the ack); falls back to entityId. */
  id?: string
  entityType: OutboxEntityType
  /** The mirrored row's nanoid — the upsert key. */
  entityId: string
  /** Row snapshot: a full row on create, the changed fields on update. */
  payload: Record<string, unknown>
  operation?: string
}

export interface IngestResult {
  /** Event ids that were upserted — the pusher advances its cursor past these. */
  applied: string[]
  /** Events not applied. `permanent` ⇒ malformed (drop it); else retryable. */
  skipped: Array<{ id: string, reason: string, permanent: boolean }>
}

const VALID_TYPES: OutboxEntityType[] = ['order', 'orderitem', 'printstatus']

async function loadTables(): Promise<Record<OutboxEntityType, any>> {
  const { salesOrders } = await import('../../collections/orders/server/database/schema')
  const { salesOrderitems } = await import('../../collections/orderitems/server/database/schema')
  // printstatus mirrors the generic crouton-printing `print_jobs` table (the
  // cloud deploy also extends crouton-printing). The outbox printstatus payload
  // is a print_jobs row, so the mirror target must be print_jobs — not the old
  // salesPrintqueues (#325/#329 migration).
  const { printJobs } = await import('@fyit/crouton-printing/server/database/schema')
  return { order: salesOrders, orderitem: salesOrderitems, printstatus: printJobs }
}

/**
 * Coerce a JSON payload to the shape drizzle expects for `table`:
 * - drop keys that aren't real columns (forward-compat / injection-safe)
 * - revive timestamp-mode columns (dataType 'date') from the ISO string / epoch
 *   number JSON produced, leaving text columns (e.g. completedAt) as-is.
 */
function coerceToColumns(table: any, payload: Record<string, unknown>): Record<string, unknown> {
  const cols = getTableColumns(table) as Record<string, { dataType: string }>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    const col = cols[key]
    if (!col) continue // unknown column → drop
    if (col.dataType === 'date' && value != null && !(value instanceof Date)) {
      out[key] = new Date(typeof value === 'number' ? value : String(value))
    }
    else {
      out[key] = value
    }
  }
  return out
}

export async function applyOutboxEvents(
  db: any,
  events: IngestEvent[],
  // Injectable for tests; defaults to the lazily-imported app-layer schema.
  tablesOverride?: Record<OutboxEntityType, any>
): Promise<IngestResult> {
  const result: IngestResult = { applied: [], skipped: [] }
  if (!Array.isArray(events) || events.length === 0) return result

  const tables = tablesOverride ?? await loadTables()

  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const ackId = e?.id || e?.entityId || `#${i}`

    // Validate shape — malformed events are permanent skips (drop, don't retry).
    if (!e || !VALID_TYPES.includes(e.entityType)) {
      result.skipped.push({ id: ackId, reason: `unknown entityType: ${e?.entityType}`, permanent: true })
      continue
    }
    if (!e.entityId || typeof e.entityId !== 'string') {
      result.skipped.push({ id: ackId, reason: 'missing entityId', permanent: true })
      continue
    }
    if (!e.payload || typeof e.payload !== 'object') {
      result.skipped.push({ id: ackId, reason: 'missing payload', permanent: true })
      continue
    }

    const table = tables[e.entityType]
    try {
      // The upsert key always wins over whatever the payload carried.
      const values = coerceToColumns(table, { ...e.payload, id: e.entityId })
      const setObj = { ...values }
      delete setObj.id

      // UPDATE existing row (idempotent: a replay re-sets the same values).
      let exists = false
      if (Object.keys(setObj).length > 0) {
        const updated = await db.update(table).set(setObj).where(eq(table.id, e.entityId)).returning({ id: table.id })
        exists = updated.length > 0
      }
      else {
        const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, e.entityId)).limit(1)
        exists = !!row
      }

      // INSERT only when absent. A partial transition payload on a missing row
      // fails NOT NULL here → caught below as a retryable skip.
      if (!exists) {
        await db.insert(table).values(values)
      }

      result.applied.push(ackId)
    }
    catch (err: any) {
      // DB-level failure (e.g. transition before its create) — retryable.
      result.skipped.push({ id: ackId, reason: err?.message || 'apply failed', permanent: false })
    }
  }

  return result
}
