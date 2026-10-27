import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { nanoid } from 'nanoid'

/**
 * Pi-side sync outbox (#176, epic #175 — D1 live mirror).
 *
 * Records each order / order-item / print-status mutation as it happens on the
 * venue Pi, so the push loop (#177) can drain it to the cloud ingest endpoint
 * (#178) and the cloud stays an eventually-consistent, queryable mirror of the
 * till (#179). The Pi remains the authoritative writer; this table is the only
 * thing that crosses the 5G uplink for data.
 *
 * Local-only and additive — the till never reads it, so capturing has no effect
 * on ordering or printing. One row per entity change, keyed by the entity's
 * existing nanoid (`entityId`) so the downstream upsert into D1 is idempotent
 * (re-sending after an uncertain push is safe). `syncedAt` stays NULL until the
 * pusher confirms the cloud applied the row; `seq` is the monotonic cursor it
 * drains oldest-first and advances past acked rows.
 *
 * `payload` is the row snapshot to mirror. For a `printstatus` row the bulky
 * base64 `printData` is deliberately omitted — the cloud shows status, it never
 * prints, so the events stay kilobytes as the epic requires.
 */
export const salesSyncOutbox = sqliteTable('sales_sync_outbox', {
  // Monotonic cursor: drain oldest-first, advance past acked rows.
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  // Stable event id (distinct from the entity it describes) for tracing/acking.
  id: text('id').notNull().$default(() => nanoid()),
  // Which mirrored table this change targets: 'order' | 'orderitem' | 'printstatus'.
  entityType: text('entity_type').notNull(),
  // The target row's existing nanoid — the idempotency key for the D1 upsert.
  entityId: text('entity_id').notNull(),
  // Generic op; create and update both map to an idempotent upsert downstream.
  operation: text('operation').notNull().$default(() => 'upsert'),
  // Correlation: the order this change belongs to (null for tab-level receipts).
  orderId: text('order_id'),
  teamId: text('team_id'),
  eventId: text('event_id'),
  // Full row snapshot to upsert into the cloud mirror (printData omitted).
  payload: text('payload', { mode: 'json' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  // NULL = pending; set to the push time once the cloud confirms it applied.
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
}, table => [
  // Drain query: pending rows, oldest first.
  index('idx_sales_sync_outbox_pending').on(table.syncedAt, table.seq),
  index('idx_sales_sync_outbox_entity').on(table.entityType, table.entityId),
])

/**
 * Cloud-side sync heartbeat (#179, epic #175 — D1 live mirror).
 *
 * The mirror is a copy of the venue till, so a row looks identical whether it
 * arrived two seconds or two hours ago. The online dashboard (#179) needs to
 * tell "the Pi is connected and syncing now" from "the Pi went offline, this is
 * a stale snapshot". This single-row table is that signal: the cloud ingest
 * endpoint (#178) stamps `lastContactAt` on *every* call — real batches and the
 * pusher's periodic idle ping alike — so the dashboard can show "last synced
 * Xs ago" and flag staleness once the clock stops advancing.
 *
 * Single global row (`id = 'live'`): one venue Pi pushes to one cloud
 * deployment, so a per-team key would only complicate the idle ping (which
 * carries no team). A multi-tenant mirror would key this by team — noted as a
 * follow-up, out of scope for one venue's live view.
 *
 * Cloud-only: written exclusively by the ingest, never by the till. The Pi's
 * own DB simply never has a row here.
 */
export const salesSyncStatus = sqliteTable('sales_sync_status', {
  // One heartbeat row per paired till (the device id, #2725). Legacy
  // shared-key setups keep writing the single 'live' row.
  id: text('id').primaryKey().$default(() => 'live'),
  // The device's team (null for the legacy 'live' row).
  teamId: text('team_id'),
  // Last time the cloud heard from the Pi at all (data batch OR idle ping) —
  // the liveness clock the dashboard reads to detect an offline Pi.
  lastContactAt: integer('last_contact_at', { mode: 'timestamp' }),
  // Last time the cloud applied actual mirrored data (applied > 0) — distinct
  // from a bare ping, so the UI can say "last change synced Xs ago" too.
  lastEventAt: integer('last_event_at', { mode: 'timestamp' }),
  // Rows applied in the most recent non-empty batch (informational hint).
  lastBatchApplied: integer('last_batch_applied').notNull().$default(() => 0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$default(() => new Date()),
})
