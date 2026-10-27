/**
 * @crouton-package crouton-sales
 * @description Till-side capture of config edits and deletes (#814, epic #801).
 *
 * The package's config endpoints (event, eventsetting, category, product,
 * location, printer) call `captureConfigWrite` after a successful write. It puts
 * the change in the same outbox orders use, with the edit time corrected by the
 * till's last known clock offset. Deletes also leave a tombstone row.
 *
 * Only the till captures (`isCloudSyncEnabled()`); elsewhere this is a no-op.
 * Best-effort like the order capture: it never fails the request.
 */
import { correctTimestamp } from './config-conflict'
import { getClockOffset } from './sync-clock'
import { isCloudSyncEnabled, recordOutboxEvents, type OutboxEvent } from './sync-outbox'

export const CONFIG_ENTITY_TYPES = ['event', 'eventsetting', 'category', 'product', 'location', 'printer'] as const
export type ConfigEntityType = typeof CONFIG_ENTITY_TYPES[number]

export function isConfigEntityType(type: unknown): type is ConfigEntityType {
  return (CONFIG_ENTITY_TYPES as readonly unknown[]).includes(type)
}

export interface ConfigWrite {
  entityType: ConfigEntityType
  operation: 'create' | 'update' | 'delete'
  entityId: string
  teamId: string
  /** Full row on create; the changed fields on update; ignored on delete. */
  data?: Record<string, unknown>
  /** Only used when the entity is not an event itself. */
  eventId?: string | null
  /** Injectable clock for tests. */
  now?: number
}

/** The outbox event for one config write. Pure. */
export function buildConfigEvent(w: ConfigWrite, offsetMs = 0): OutboxEvent {
  const at = correctTimestamp(w.now ?? Date.now(), offsetMs)
  const data = w.data ?? {}
  const eventId = w.entityType === 'event' ? w.entityId : (w.eventId ?? (data.eventId as string | undefined) ?? null)
  if (w.operation === 'delete') {
    return {
      entityType: w.entityType,
      entityId: w.entityId,
      operation: 'delete',
      teamId: w.teamId,
      eventId,
      payload: { teamId: w.teamId, deletedAt: at },
    }
  }
  return {
    entityType: w.entityType,
    entityId: w.entityId,
    operation: 'upsert',
    teamId: w.teamId,
    eventId,
    payload: { ...data, teamId: w.teamId, updatedAt: at },
  }
}

export async function captureConfigWrite(db: any, writes: ConfigWrite | ConfigWrite[]): Promise<void> {
  if (!isCloudSyncEnabled()) return
  const list = Array.isArray(writes) ? writes : [writes]
  if (list.length === 0) return
  const offset = getClockOffset()
  const events = list.map(w => buildConfigEvent(w, offset))

  try {
    const { salesSyncTombstones } = await import('../database/schema')
    for (const ev of events.filter(e => e.operation === 'delete')) {
      const deletedAt = new Date(ev.payload.deletedAt as number)
      await db.insert(salesSyncTombstones)
        .values({ entityType: ev.entityType, entityId: ev.entityId, teamId: ev.teamId, deletedAt })
        .onConflictDoUpdate({
          target: [salesSyncTombstones.entityType, salesSyncTombstones.entityId],
          set: { deletedAt },
        })
    }
  }
  catch (err) {
    console.error('[crouton-sales] config tombstone write failed:', err)
  }
  await recordOutboxEvents(db, events)
}
