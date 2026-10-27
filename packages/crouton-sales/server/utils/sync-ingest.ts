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
import { and, eq, getTableColumns } from 'drizzle-orm'
import { resolveConflict, type ConfigVersion, type ConflictReason } from './config-conflict'
import { isConfigEntityType, type ConfigEntityType } from './config-capture'
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

/** A config write that lost the conflict rule; kept for the review log (#816). */
export interface IngestConflict {
  id: string
  entityType: ConfigEntityType
  entityId: string
  reason: ConflictReason
  /** What the cloud kept, and what the till sent. */
  local: ConfigVersion
  incoming: ConfigVersion
  payload: Record<string, unknown>
  operation: string
}

export interface IngestOptions {
  /** The authenticated device's id; the deterministic tie-break for equal timestamps. */
  deviceId?: string
  /** Injectable for tests: the delete-marker table. */
  tombstones?: any
}

export interface IngestResult {
  /** Event ids that were upserted — the pusher advances its cursor past these. */
  applied: string[]
  /** Events not applied. `permanent` ⇒ malformed (drop it); else retryable. */
  skipped: Array<{ id: string, reason: string, permanent: boolean }>
  /** Config writes the conflict rule kept the cloud's version over (acked, not applied). */
  conflicts?: IngestConflict[]
}

const VALID_TYPES: OutboxEntityType[] = ['order', 'orderitem', 'printstatus', 'event', 'eventsetting', 'category', 'product', 'location', 'printer']

export async function loadTables(): Promise<Record<OutboxEntityType, any>> {
  const { salesOrders } = await import('../../collections/orders/server/database/schema')
  const { salesOrderitems } = await import('../../collections/orderitems/server/database/schema')
  // printstatus mirrors the generic crouton-printing `print_jobs` table (the
  // cloud deploy also extends crouton-printing). The outbox printstatus payload
  // is a print_jobs row, so the mirror target must be print_jobs — not the old
  // salesPrintqueues (#325/#329 migration).
  const { printJobs } = await import('@fyit/crouton-printing/server/database/schema')
  const { salesEvents } = await import('../../collections/events/server/database/schema')
  const { salesEventsettings } = await import('../../collections/eventsettings/server/database/schema')
  const { salesCategories } = await import('../../collections/categories/server/database/schema')
  const { salesProducts } = await import('../../collections/products/server/database/schema')
  const { salesLocations } = await import('../../collections/locations/server/database/schema')
  const { salesPrinters } = await import('../../collections/printers/server/database/schema')
  return {
    order: salesOrders,
    orderitem: salesOrderitems,
    printstatus: printJobs,
    event: salesEvents,
    eventsetting: salesEventsettings,
    category: salesCategories,
    product: salesProducts,
    location: salesLocations,
    printer: salesPrinters
  }
}

/**
 * Coerce a JSON payload to the shape drizzle expects for `table`:
 * - drop keys that aren't real columns (forward-compat / injection-safe)
 * - revive timestamp-mode columns (dataType 'date') from the ISO string / epoch
 *   number JSON produced, leaving text columns (e.g. completedAt) as-is.
 */
export function coerceToColumns(table: any, payload: Record<string, unknown>): Record<string, unknown> {
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

const toMs = (v: unknown): number | null => {
  if (v == null) return null
  const ms = v instanceof Date ? v.getTime() : new Date(typeof v === 'number' ? v : String(v)).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** The event whose status decides who wins while the row is live. */
export async function liveEventStatus(
  db: any,
  tables: Record<OutboxEntityType, any>,
  e: IngestEvent,
  row: any,
  values: Record<string, unknown>
): Promise<unknown> {
  if (e.entityType === 'event') return row?.status ?? values.status
  const eventId = row?.eventId ?? values.eventId
  if (!eventId) return undefined
  const eventsTable = tables.event
  const [ev] = await db.select({ status: eventsTable.status }).from(eventsTable).where(eq(eventsTable.id, eventId)).limit(1)
  return ev?.status
}

/** The till's version of a config write, or null when it carries no usable timestamp. */
function incomingVersion(e: IngestEvent, opts: IngestOptions): ConfigVersion | null {
  const payload = e.payload as { updatedAt?: unknown, deletedAt?: unknown }
  if (e.operation === 'delete') {
    const deletedAt = toMs(payload.deletedAt)
    if (deletedAt == null) return null
    return { updatedAt: deletedAt, deletedAt, deviceId: opts.deviceId ?? null }
  }
  const updatedAt = toMs(payload.updatedAt)
  if (updatedAt == null) return null
  return { updatedAt, deletedAt: null, deviceId: opts.deviceId ?? null }
}

function localVersion(row: any, mark: any): ConfigVersion | null {
  if (row) return { updatedAt: toMs(row.updatedAt) ?? 0, deviceId: null }
  if (mark) return { updatedAt: 0, deletedAt: toMs(mark.deletedAt) ?? 0, deviceId: null }
  return null
}

async function deleteWithTombstone(
  db: any,
  table: any,
  tombstones: any,
  e: IngestEvent,
  teamId: string,
  deletedAtMs: number
) {
  await db.delete(table).where(and(eq(table.id, e.entityId), eq(table.teamId, teamId)))
  const deletedAt = new Date(deletedAtMs)
  await db.insert(tombstones)
    .values({ entityType: e.entityType, entityId: e.entityId, teamId, deletedAt })
    .onConflictDoUpdate({ target: [tombstones.entityType, tombstones.entityId], set: { deletedAt } })
}

export async function upsertRow(db: any, table: any, id: string, values: Record<string, unknown>) {
  const setObj = { ...values }
  delete setObj.id
  const updated = Object.keys(setObj).length > 0
    ? await db.update(table).set(setObj).where(eq(table.id, id)).returning({ id: table.id })
    : []
  if (updated.length === 0) await db.insert(table).values(values)
}

/**
 * Apply one till config write on the cloud with the conflict rule (#814):
 * compare it with the cloud's current row (or its delete marker), then apply or
 * keep. A kept write is still acked (the till is done with it) and reported in
 * `result.conflicts`. Replaying the same event converges to the same state.
 */
async function applyConfigEvent(
  db: any,
  tables: Record<OutboxEntityType, any>,
  e: IngestEvent & { entityType: ConfigEntityType },
  values: Record<string, unknown>,
  ackId: string,
  result: IngestResult,
  opts: IngestOptions
) {
  const table = tables[e.entityType]
  const teamId = values.teamId as string | undefined
  const tombstones = opts.tombstones ?? (await import('../database/schema')).salesSyncTombstones
  const incoming = incomingVersion(e, opts)
  if (!incoming) {
    result.skipped.push({ id: ackId, reason: 'missing timestamp', permanent: true })
    return
  }
  if (e.operation === 'delete' && !teamId) {
    result.skipped.push({ id: ackId, reason: 'missing team', permanent: true })
    return
  }

  const [row] = await db.select().from(table).where(eq(table.id, e.entityId)).limit(1)
  const [mark] = await db.select().from(tombstones)
    .where(and(eq(tombstones.entityType, e.entityType), eq(tombstones.entityId, e.entityId))).limit(1)

  // A marker left by another team is never read, revived or removed from here.
  if (teamId && mark && mark.teamId !== teamId) {
    console.warn(`[crouton-sales] sync ingest rejected ${e.entityType} ${e.entityId}: delete marker belongs to another team`)
    teamMismatch(result, ackId)
    return
  }

  const local = localVersion(row, mark)
  if (local) {
    const status = await liveEventStatus(db, tables, e, row, values)
    const verdict = resolveConflict(local, incoming, { eventLive: status === 'active', side: 'cloud' })
    if (verdict.decision === 'keep') {
      result.conflicts?.push({
        id: ackId, entityType: e.entityType, entityId: e.entityId, reason: verdict.reason,
        local, incoming, payload: e.payload, operation: e.operation ?? 'upsert'
      })
      result.applied.push(ackId)
      return
    }
  }

  if (e.operation === 'delete') {
    await deleteWithTombstone(db, table, tombstones, e, teamId!, incoming.deletedAt as number)
  }
  else {
    await upsertRow(db, table, e.entityId, values)
    // A newer edit brings a deleted row back; the marker no longer applies.
    if (mark) await db.delete(tombstones).where(and(eq(tombstones.entityType, e.entityType), eq(tombstones.entityId, e.entityId)))
  }
  result.applied.push(ackId)
}

/** Shape check — malformed events are permanent skips (drop, don't retry). */
function shapeError(e: IngestEvent | undefined): string | null {
  if (!e || !VALID_TYPES.includes(e.entityType)) return `unknown entityType: ${e?.entityType}`
  if (!e.entityId || typeof e.entityId !== 'string') return 'missing entityId'
  if (!e.payload || typeof e.payload !== 'object') return 'missing payload'
  return null
}

const teamMismatch = (result: IngestResult, ackId: string) =>
  result.skipped.push({ id: ackId, reason: 'team mismatch', permanent: true })

/** Apply one well-formed event; records the outcome on `result`. Throws on DB failure. */
async function applyEvent(
  db: any,
  tables: Record<OutboxEntityType, any>,
  e: IngestEvent,
  ackId: string,
  result: IngestResult,
  scopeTeamId: string | undefined,
  opts: IngestOptions
) {
  // Team scoping (#2725): a paired till may only write its own team's rows.
  // A foreign teamId is a permanent skip (logged); a missing one is forced.
  const rowTeamId = (e.payload as { teamId?: unknown }).teamId
  if (scopeTeamId && rowTeamId != null && rowTeamId !== scopeTeamId) {
    console.warn(`[crouton-sales] sync ingest rejected ${e.entityType} ${e.entityId}: row team ${String(rowTeamId)} ≠ device team ${scopeTeamId}`)
    teamMismatch(result, ackId)
    return
  }

  const table = tables[e.entityType]
  // The upsert key always wins over whatever the payload carried.
  const values = coerceToColumns(table, {
    ...e.payload,
    ...(scopeTeamId ? { teamId: scopeTeamId } : {}),
    id: e.entityId
  })
  const setObj = { ...values }
  delete setObj.id

  // An existing row under another team is never touched or re-inserted.
  if (scopeTeamId) {
    const [owner] = await db.select({ teamId: table.teamId }).from(table).where(eq(table.id, e.entityId)).limit(1)
    if (owner && owner.teamId !== scopeTeamId) {
      console.warn(`[crouton-sales] sync ingest rejected ${e.entityType} ${e.entityId}: existing row belongs to another team`)
      teamMismatch(result, ackId)
      return
    }
  }
  if (isConfigEntityType(e.entityType)) {
    await applyConfigEvent(db, tables, e as IngestEvent & { entityType: ConfigEntityType }, values, ackId, result, opts)
    return
  }

  const rowWhere = scopeTeamId ? and(eq(table.id, e.entityId), eq(table.teamId, scopeTeamId)) : eq(table.id, e.entityId)

  // UPDATE existing row (idempotent: a replay re-sets the same values).
  let exists = false
  if (Object.keys(setObj).length > 0) {
    const updated = await db.update(table).set(setObj).where(rowWhere).returning({ id: table.id })
    exists = updated.length > 0
  }
  else {
    const [row] = await db.select({ id: table.id }).from(table).where(rowWhere).limit(1)
    exists = !!row
  }

  // INSERT only when absent. A partial transition payload on a missing row
  // fails NOT NULL here → caught by the caller as a retryable skip.
  if (!exists) {
    await db.insert(table).values(values)
  }

  result.applied.push(ackId)
}

export async function applyOutboxEvents(
  db: any,
  events: IngestEvent[],
  // Injectable for tests; defaults to the lazily-imported app-layer schema.
  tablesOverride?: Record<OutboxEntityType, any>,
  /** The authenticated device's team (#2725). Rows for any other team are rejected. */
  scopeTeamId?: string,
  opts: IngestOptions = {}
): Promise<IngestResult> {
  const result: IngestResult = { applied: [], skipped: [], conflicts: [] }
  if (!Array.isArray(events) || events.length === 0) return result

  const tables = tablesOverride ?? await loadTables()

  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const ackId = e?.id || e?.entityId || `#${i}`

    const shapeProblem = shapeError(e)
    if (shapeProblem) {
      result.skipped.push({ id: ackId, reason: shapeProblem, permanent: true })
      continue
    }

    try {
      await applyEvent(db, tables, e!, ackId, result, scopeTeamId, opts)
    }
    catch (err: any) {
      // DB-level failure (e.g. transition before its create) — retryable.
      result.skipped.push({ id: ackId, reason: err?.message || 'apply failed', permanent: false })
    }
  }

  return result
}
