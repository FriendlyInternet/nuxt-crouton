/**
 * Cloud-side ingest for the D1 live mirror (#178, epic #175).
 *
 * Receives a batch of outbox events from the Pi pusher (#177) and applies them
 * as idempotent upserts into the mirrored tables. The only writer of mirrored
 * venue data on the cloud. Auth is the till's paired device identity (#2725);
 * the deprecated shared secret (`x-sync-key`) only works with no device headers.
 *
 * Body:  { events: IngestEvent[] }
 * Reply: { applied: string[], skipped: [{ id, reason, permanent }] }
 *        — the pusher advances its cursor past `applied`, retries non-permanent
 *          skips, and may drop permanent ones.
 */
import { authenticateSync, deviceOf } from '../../../utils/cloud-sync-auth'
import { applyOutboxEvents, type IngestEvent } from '../../../utils/sync-ingest'
import { recordLostEdits, recordSyncHeartbeat } from '../../../utils/sync-status'

interface IngestBody {
  events?: IngestEvent[]
}

async function readEvents(event: Parameters<typeof readBody>[0]): Promise<IngestEvent[]> {
  const body = await readBody<IngestBody>(event)
  if (!body || !Array.isArray(body.events)) {
    throw createError({ status: 400, statusText: 'Body must be { events: [...] }' })
  }
  return body.events
}

function logConflicts(conflicts?: unknown[]) {
  const count = conflicts?.length ?? 0
  if (count) console.info(`[crouton-sales] sync ingest kept the cloud version for ${count} config write(s)`)
}

// fallow-ignore-next-line complexity -- thin handler: optional device fields only, the logic is unit-tested in sync-ingest.ts
export default defineEventHandler(async (event) => {
  const device = deviceOf(await authenticateSync(event))
  const events = await readEvents(event)

  const db = useDB()
  const result = await applyOutboxEvents(db, events, undefined, device?.teamId, { deviceId: device?.deviceId })
  logConflicts(result.conflicts)
  await recordLostEdits(db, result.conflicts, { deviceId: device?.deviceId, teamId: device?.teamId })

  // Stamp the freshness heartbeat the online dashboard (#179) reads. Advances on
  // every call — a real batch or the pusher's idle ping (events: []) — so a
  // quiet-but-online till still reads "connected". Best-effort: never fails the
  // ingest (the mirrored data already landed; the clock is advisory).
  await recordSyncHeartbeat(db, result.applied.length, device)

  return {
    received: events.length,
    // Server clock (epoch ms) so a till can correct its own clock skew (#813/#814).
    serverNow: Date.now(),
    appliedCount: result.applied.length,
    ...result,
  }
})
