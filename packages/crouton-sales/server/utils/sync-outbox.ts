/**
 * @crouton-package crouton-sales
 * @description Pi-side capture for the D1 live-mirror sync (#176, epic #175).
 *
 * Records order / order-item / print-status mutations into `sales_sync_outbox`
 * as they happen, so the push loop (#177) can drain them to the cloud ingest
 * endpoint (#178) and keep the cloud an eventually-consistent mirror (#179).
 *
 * Gated by `CROUTON_SALES_CLOUD_SYNC` — OFF by default and on every Cloudflare
 * deploy, so existing deploys write no extra rows (the cloud *is* the mirror
 * there; only the venue Pi captures). Mirrors the escpos-drainer's env-gate.
 *
 * Capture is best-effort: a failure here is logged and swallowed so it can never
 * block the till — the order/print path must succeed regardless of sync state.
 *
 * The outbox schema is package-owned (`../database/schema`) and imported
 * lazily, so loading this module stays cheap and import-safe everywhere.
 */
import { nanoid } from 'nanoid'

export type OutboxEntityType
  = | 'order' | 'orderitem' | 'printstatus'
  // Config rows (#814): edited on the till, applied on the cloud with the conflict rule.
    | 'event' | 'eventsetting' | 'category' | 'product' | 'location' | 'printer'

export interface OutboxEvent {
  entityType: OutboxEntityType
  /** The target row's existing nanoid — idempotency key for the cloud upsert. */
  entityId: string
  /** Row snapshot to mirror (a full row on create; the changed fields on update). */
  payload: Record<string, unknown>
  /** Correlation: the order this change belongs to (null for tab-level receipts). */
  orderId?: string | null
  teamId?: string | null
  eventId?: string | null
  /** Defaults to 'upsert' — create and update both upsert by nanoid downstream. 'delete' removes a config row. */
  operation?: string
}

/**
 * True when this process should capture to the outbox — i.e. it's the venue Pi
 * with cloud sync turned on. OFF by default (and always on Cloudflare), so
 * existing deploys are unchanged and pay no extra writes.
 */
export function isCloudSyncEnabled(): boolean {
  const flag = process.env.CROUTON_SALES_CLOUD_SYNC
  return flag === '1' || flag === 'true'
}

async function loadOutboxSchema() {
  const { salesSyncOutbox } = await import('../database/schema')
  return { salesSyncOutbox }
}

/**
 * Append one pending outbox row per event. No-op when cloud sync is disabled.
 * Never throws — capture must not break the till.
 */
export async function recordOutboxEvents(db: any, events: OutboxEvent[]): Promise<void> {
  if (!isCloudSyncEnabled() || events.length === 0) return

  try {
    const { salesSyncOutbox } = await loadOutboxSchema()
    const now = new Date()
    await db.insert(salesSyncOutbox).values(
      events.map(e => ({
        id: nanoid(),
        entityType: e.entityType,
        entityId: e.entityId,
        operation: e.operation ?? 'upsert',
        orderId: e.orderId ?? null,
        teamId: e.teamId ?? null,
        eventId: e.eventId ?? null,
        payload: e.payload,
        createdAt: now,
        syncedAt: null,
      })),
    )
  }
  catch (err) {
    console.error('[crouton-sales] sync outbox capture failed:', err)
  }
}
