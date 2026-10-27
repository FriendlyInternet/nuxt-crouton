/**
 * @crouton-package crouton-sales
 * @description Pi-side push loop for the D1 live mirror (#177, epic #175).
 *
 * Drains pending `sales_sync_outbox` rows (#176) and POSTs them in batches to the
 * cloud ingest endpoint (#178). On the cloud's ack it sets `synced_at` on the
 * applied rows (advancing the cursor); non-permanent skips stay pending and retry
 * next tick, permanent (malformed) skips are dropped so a poison row can't wedge
 * the loop. Idempotent by nanoid downstream, so re-sending after an uncertain
 * push never duplicates — if the network drops after the cloud applied but before
 * we read the response, the rows stay pending and the next push converges.
 *
 * Transport failures throw so the Nitro plugin can back off; the till is never
 * blocked (this runs entirely outside the order/print path).
 *
 * The outbox schema is package-owned (`../database/schema`, imported lazily).
 */
import { asc, inArray, isNull } from 'drizzle-orm'

export interface PushOptions {
  /** Ingest endpoint URL; defaults to env CROUTON_SALES_CLOUD_SYNC_URL. */
  url?: string
  /** Shared secret; defaults to env NUXT_CROUTON_SALES_CLOUD_SYNC_SECRET. */
  secret?: string
  /** Paired device id; defaults to env CROUTON_SALES_DEVICE_ID (legacy FANFARE_DEVICE_ID). */
  deviceId?: string
  /** Paired device secret; defaults to env CROUTON_SALES_DEVICE_SECRET (legacy FANFARE_DEVICE_SECRET). */
  deviceSecret?: string
  /** Max rows per batch. Default 100. */
  batchSize?: number
  /** Per-request timeout (ms). Default 15000. */
  timeoutMs?: number
  /** Injectable HTTP client for tests; defaults to $fetch. */
  fetcher?: (url: string, init: Record<string, unknown>) => Promise<IngestResponse>
}

interface IngestResponse {
  serverNow?: number
  applied?: string[]
  skipped?: Array<{ id: string, reason?: string, permanent?: boolean }>
}

export interface PushResult {
  claimed: number
  applied: number
  skippedRetry: number
  skippedPermanent: number
}

/**
 * Auth headers for the ingest. A paired till sends its device identity (#2725);
 * only a till with no identity falls back to the deprecated shared key.
 */
export function syncAuthHeaders(opts: PushOptions): Record<string, string> {
  const deviceId = opts.deviceId || process.env.CROUTON_SALES_DEVICE_ID || process.env.FANFARE_DEVICE_ID
  const deviceSecret = opts.deviceSecret || process.env.CROUTON_SALES_DEVICE_SECRET || process.env.FANFARE_DEVICE_SECRET
  if (deviceId && deviceSecret) {
    return { 'x-device-id': deviceId, 'x-device-secret': deviceSecret }
  }
  const secret = opts.secret || process.env.NUXT_CROUTON_SALES_CLOUD_SYNC_SECRET
  if (!secret) throw new Error('No device identity (CROUTON_SALES_DEVICE_ID/SECRET) and NUXT_CROUTON_SALES_CLOUD_SYNC_SECRET not set')
  return { 'x-sync-key': secret }
}

async function loadOutboxSchema() {
  const { salesSyncOutbox } = await import('../database/schema')
  return { salesSyncOutbox }
}

/**
 * Push one batch of pending outbox rows. Returns counts; `claimed` reaching
 * `batchSize` signals more may be pending (the plugin drains again immediately).
 */
export async function pushPendingOutbox(db: any, opts: PushOptions = {}): Promise<PushResult> {
  const url = opts.url || process.env.CROUTON_SALES_CLOUD_SYNC_URL
  if (!url) throw new Error('CROUTON_SALES_CLOUD_SYNC_URL not set')
  const headers = syncAuthHeaders(opts)

  const { salesSyncOutbox } = await loadOutboxSchema()
  const batchSize = opts.batchSize ?? 100

  const rows = await db
    .select()
    .from(salesSyncOutbox)
    .where(isNull(salesSyncOutbox.syncedAt))
    .orderBy(asc(salesSyncOutbox.seq))
    .limit(batchSize)

  if (rows.length === 0) return { claimed: 0, applied: 0, skippedRetry: 0, skippedPermanent: 0 }

  const events = rows.map((r: any) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    operation: r.operation,
    orderId: r.orderId,
    teamId: r.teamId,
    eventId: r.eventId,
    payload: r.payload,
  }))

  const doFetch = opts.fetcher ?? (globalThis as any).$fetch
  const res: IngestResponse = await doFetch(url, {
    method: 'POST',
    headers,
    body: { events },
    timeout: opts.timeoutMs ?? 15000,
    retry: 0,
  })

  const applied = Array.isArray(res?.applied) ? res.applied : []
  const skipped = Array.isArray(res?.skipped) ? res.skipped : []
  const permanentIds = skipped.filter(s => s?.permanent).map(s => s.id)
  const retryCount = skipped.length - permanentIds.length

  // Mark confirmed rows synced: applied + permanently-dropped. Non-permanent
  // skips (e.g. a transition that arrived before its create) stay pending.
  const toMark = [...applied, ...permanentIds].filter(Boolean)
  if (toMark.length > 0) {
    await db.update(salesSyncOutbox).set({ syncedAt: new Date() }).where(inArray(salesSyncOutbox.id, toMark))
  }
  if (permanentIds.length > 0) {
    console.warn(`[crouton-sales] cloud sync dropped ${permanentIds.length} malformed outbox row(s):`, permanentIds)
  }

  return { claimed: rows.length, applied: applied.length, skippedRetry: retryCount, skippedPermanent: permanentIds.length }
}

/**
 * Idle heartbeat ping (#179, epic #175). POSTs an empty batch to the ingest so
 * the cloud's freshness clock (`sales_sync_status.lastContactAt`) keeps advancing
 * even when the till is quiet (no orders to push). Without it, the online
 * dashboard couldn't tell "Pi online but no sales right now" from "Pi offline".
 *
 * The plugin calls this only when there's nothing pending and the ping interval
 * has elapsed — a real push already refreshes the same clock cloud-side. Throws
 * on transport failure so the plugin backs off, exactly like a data push.
 */
export async function pingHeartbeat(opts: PushOptions = {}): Promise<void> {
  const url = opts.url || process.env.CROUTON_SALES_CLOUD_SYNC_URL
  if (!url) throw new Error('CROUTON_SALES_CLOUD_SYNC_URL not set')
  const headers = syncAuthHeaders(opts)

  const doFetch = opts.fetcher ?? (globalThis as any).$fetch
  await doFetch(url, {
    method: 'POST',
    headers,
    body: { events: [] },
    timeout: opts.timeoutMs ?? 15000,
    retry: 0,
  })
}
