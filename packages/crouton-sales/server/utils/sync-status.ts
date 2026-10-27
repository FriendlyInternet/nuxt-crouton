/**
 * @crouton-package crouton-sales
 * @description Cloud-side sync heartbeat for the D1 live mirror (#179, epic #175).
 *
 * The mirror is a copy of the venue till — a row reveals nothing about *when* it
 * arrived. The online dashboard (#179) needs to distinguish "the Pi is connected
 * and syncing now" from "the Pi went offline, this is a stale snapshot". This is
 * that signal: a single-row `sales_sync_status` heartbeat the cloud ingest (#178)
 * stamps on EVERY call — real data batches and the pusher's periodic idle ping
 * alike — plus a read used by the dashboard's status endpoint.
 *
 * Best-effort: `recordSyncHeartbeat` swallows its own errors so a heartbeat
 * write can never fail an otherwise-successful ingest (the mirrored data is what
 * matters; the freshness clock is advisory).
 *
 * The heartbeat schema is package-owned (`../database/schema`), imported lazily
 * to stay import-safe — same pattern as the pusher.
 */
import { desc, eq } from 'drizzle-orm'

/** Heartbeat row id for shared-key (deviceless) setups. Paired tills use their device id (#2725). */
export const SYNC_STATUS_ROW_ID = 'live'

export interface SyncStatus {
  /** Heartbeat row key: the device id, or 'live' for shared-key setups. */
  deviceId: string
  teamId: string | null
  /** Last time the cloud heard from the Pi (data batch OR idle ping); null = never. */
  lastContactAt: Date | null
  /** Last time actual mirrored data was applied (applied > 0); null = never. */
  lastEventAt: Date | null
  /** Rows applied in the most recent non-empty batch. */
  lastBatchApplied: number
}

async function loadStatusSchema() {
  const { salesSyncStatus } = await import('../database/schema')
  return { salesSyncStatus }
}

/**
 * Stamp the heartbeat after an ingest call. `appliedCount` is how many events
 * the batch applied (0 for an idle ping). `lastContactAt` always advances;
 * `lastEventAt` + `lastBatchApplied` advance only when real data landed.
 *
 * Idempotent upsert of the device's row (`'live'` for shared-key setups). Best-effort — never throws.
 */
export async function recordSyncHeartbeat(
  db: any,
  appliedCount: number,
  device?: { deviceId: string, teamId: string }
): Promise<void> {
  const rowId = device?.deviceId ?? SYNC_STATUS_ROW_ID
  try {
    const { salesSyncStatus } = await loadStatusSchema()
    const now = new Date()
    const applied = Number(appliedCount) || 0

    const base = { lastContactAt: now, updatedAt: now }
    const dataFields = applied > 0 ? { lastEventAt: now, lastBatchApplied: applied } : {}

    const updated = await db
      .update(salesSyncStatus)
      .set({ ...base, ...dataFields })
      .where(eq(salesSyncStatus.id, rowId))
      .returning({ id: salesSyncStatus.id })

    if (updated.length === 0) {
      await db.insert(salesSyncStatus).values({
        id: rowId,
        teamId: device?.teamId ?? null,
        lastContactAt: now,
        lastEventAt: applied > 0 ? now : null,
        lastBatchApplied: applied,
        updatedAt: now,
      })
    }
  }
  catch (err: any) {
    console.warn('[crouton-sales] sync heartbeat write failed (ignored):', err?.message || err)
  }
}

/**
 * Read the heartbeats for the dashboard's status endpoint — one per till,
 * freshest first. Null fields = never synced. Pass `teamId` to scope to a team
 * (paired tills only; the deviceless 'live' row has no team and is always
 * included, since it predates per-team scoping).
 */
export async function readSyncStatuses(db: any, teamId?: string): Promise<SyncStatus[]> {
  const { salesSyncStatus } = await loadStatusSchema()
  const rows: any[] = await db
    .select()
    .from(salesSyncStatus)
    .orderBy(desc(salesSyncStatus.lastContactAt))
    .limit(200)

  return rows
    .filter(r => !teamId || !r.teamId || r.teamId === teamId)
    .map(r => ({
      deviceId: r.id,
      teamId: r.teamId ?? null,
      lastContactAt: r.lastContactAt ?? null,
      lastEventAt: r.lastEventAt ?? null,
      lastBatchApplied: r.lastBatchApplied ?? 0,
    }))
}

/** Pick the freshest status (the banner's headline). */
export function freshestStatus(statuses: SyncStatus[]): SyncStatus | null {
  return statuses.reduce<SyncStatus | null>((best, s) => {
    const t = s.lastContactAt?.getTime() ?? -1
    return !best || t > (best.lastContactAt?.getTime() ?? -1) ? s : best
  }, null)
}
