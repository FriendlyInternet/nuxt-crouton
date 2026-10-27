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
import { desc, eq, getTableColumns, isNull, or } from 'drizzle-orm'
import { chunkRowsForTable } from '@fyit/crouton-core/shared/utils/d1'

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
  /** Last time this till pulled config from the cloud; null = never. */
  lastPullAt: Date | null
}

/** A config edit that lost a conflict, as the settings card shows it (#816). */
export interface LostEdit {
  id: string
  deviceId: string | null
  entityType: string
  entityId: string
  reason: string
  /** What the till sent, and what the cloud kept. */
  lost: Record<string, unknown>
  kept: Record<string, unknown>
  createdAt: Date
}

/** How many losing edits the status endpoint returns. */
export const LOST_EDITS_LIMIT = 10
const SNAPSHOT_MAX_CHARS = 2000

async function loadStatusSchema() {
  const { salesSyncStatus } = await import('../database/schema')
  return { salesSyncStatus }
}

/** The identity a heartbeat is recorded for: a paired till, or the legacy shared-key row. */
export interface SyncDevice {
  deviceId: string
  teamId: string | null
}

const SHARED_KEY_DEVICE: SyncDevice = { deviceId: SYNC_STATUS_ROW_ID, teamId: null }

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
  device: SyncDevice = SHARED_KEY_DEVICE
): Promise<void> {
  try {
    const { salesSyncStatus } = await loadStatusSchema()
    const now = new Date()
    const applied = Number(appliedCount) || 0
    const data = applied > 0 ? { lastEventAt: now, lastBatchApplied: applied } : undefined

    await db
      .insert(salesSyncStatus)
      .values({
        id: device.deviceId,
        teamId: device.teamId,
        lastContactAt: now,
        lastEventAt: null,
        lastBatchApplied: 0,
        updatedAt: now,
        ...data,
      })
      .onConflictDoUpdate({
        target: salesSyncStatus.id,
        set: { lastContactAt: now, updatedAt: now, ...data },
      })
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
    .where(teamId ? or(eq(salesSyncStatus.teamId, teamId), isNull(salesSyncStatus.teamId)) : undefined)
    .orderBy(desc(salesSyncStatus.lastContactAt))
    .limit(200)

  return rows
    .map(r => ({
      deviceId: r.id,
      teamId: r.teamId ?? null,
      lastContactAt: r.lastContactAt ?? null,
      lastEventAt: r.lastEventAt ?? null,
      lastBatchApplied: r.lastBatchApplied ?? 0,
      lastPullAt: r.lastPullAt ?? null,
    }))
}

/** Stamp the time a till pulled config. Best-effort — never throws. */
export async function recordSyncPull(db: any, device: SyncDevice): Promise<void> {
  try {
    const { salesSyncStatus } = await loadStatusSchema()
    const now = new Date()
    await db
      .insert(salesSyncStatus)
      .values({ id: device.deviceId, teamId: device.teamId, lastPullAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: salesSyncStatus.id, set: { lastPullAt: now, updatedAt: now } })
  }
  catch (err: any) {
    console.warn('[crouton-sales] sync pull stamp failed (ignored):', err?.message || err)
  }
}

/** Keep a snapshot small and JSON-safe (never the bulky columns). */
function snapshot(row: Record<string, unknown> | null | undefined): string {
  const json = JSON.stringify(row ?? {})
  return json.length > SNAPSHOT_MAX_CHARS ? JSON.stringify({ truncated: true }) : json
}

/** Persist edits that lost the conflict rule on ingest. Best-effort — never throws. */
export async function recordLostEdits(
  db: any,
  conflicts: Array<{ entityType: string, entityId: string, reason: string, payload: Record<string, unknown>, current?: Record<string, unknown> | null }> | undefined,
  device: { deviceId?: string | null, teamId?: string | null },
): Promise<void> {
  if (!conflicts?.length || !device.teamId) return
  try {
    const { salesSyncConflicts } = await import('../database/schema')
    // D1 caps a query at 100 bound params and a multi-row insert binds one per column per row.
    const rows = conflicts.map(c => ({
      teamId: device.teamId!,
      deviceId: device.deviceId ?? null,
      entityType: c.entityType,
      entityId: c.entityId,
      reason: c.reason,
      lostJson: snapshot(c.payload),
      keptJson: snapshot(c.current),
    }))
    for (const batch of chunkRowsForTable(rows, getTableColumns(salesSyncConflicts))) {
      await db.insert(salesSyncConflicts).values(batch)
    }
  }
  catch (err: any) {
    console.warn('[crouton-sales] lost-edit record failed (ignored):', err?.message || err)
  }
}

function parseSnapshot(json: string): Record<string, unknown> {
  try { return JSON.parse(json) }
  catch { return {} }
}

/** The latest losing edits of a team, newest first. */
export async function readLostEdits(db: any, teamId: string, limit: number = LOST_EDITS_LIMIT): Promise<LostEdit[]> {
  const { salesSyncConflicts } = await import('../database/schema')
  const rows: any[] = await db
    .select()
    .from(salesSyncConflicts)
    .where(eq(salesSyncConflicts.teamId, teamId))
    .orderBy(desc(salesSyncConflicts.createdAt))
    .limit(limit)
  return rows.map(r => ({
    id: r.id,
    deviceId: r.deviceId ?? null,
    entityType: r.entityType,
    entityId: r.entityId,
    reason: r.reason,
    lost: parseSnapshot(r.lostJson),
    kept: parseSnapshot(r.keptJson),
    createdAt: r.createdAt,
  }))
}

/** Pick the freshest status (the banner's headline). */
export function freshestStatus(statuses: SyncStatus[]): SyncStatus | null {
  return statuses.reduce<SyncStatus | null>((best, s) => {
    const t = s.lastContactAt?.getTime() ?? -1
    return !best || t > (best.lastContactAt?.getTime() ?? -1) ? s : best
  }, null)
}

/**
 * The status endpoint's payload: the freshest till as the headline (so existing
 * banners keep working) plus every till of the team, freshest first (#2725).
 * `now` is the server clock, so clients compute age immune to device clock skew.
 */
export function toStatusPayload(statuses: SyncStatus[], now: number = Date.now(), lostEdits: LostEdit[] = []) {
  const ms = (d: Date | null) => d?.getTime() ?? null
  const freshest = freshestStatus(statuses)
  return {
    lastContactAt: ms(freshest?.lastContactAt ?? null),
    lastEventAt: ms(freshest?.lastEventAt ?? null),
    lastBatchApplied: freshest?.lastBatchApplied ?? 0,
    devices: statuses.map(s => ({
      deviceId: s.deviceId,
      lastContactAt: ms(s.lastContactAt),
      lastEventAt: ms(s.lastEventAt),
      lastBatchApplied: s.lastBatchApplied,
      lastPullAt: ms(s.lastPullAt),
    })),
    lostEdits: lostEdits.map(l => ({
      id: l.id,
      deviceId: l.deviceId,
      entityType: l.entityType,
      entityId: l.entityId,
      reason: l.reason,
      lost: l.lost,
      kept: l.kept,
      at: l.createdAt instanceof Date ? l.createdAt.getTime() : Number(l.createdAt),
    })),
    serverNow: now,
  }
}
