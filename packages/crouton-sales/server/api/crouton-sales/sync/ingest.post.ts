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
import { authenticateSync } from '../../../utils/cloud-sync-auth'
import { applyOutboxEvents, type IngestEvent } from '../../../utils/sync-ingest'
import { recordSyncHeartbeat } from '../../../utils/sync-status'

interface IngestBody {
  events?: IngestEvent[]
}

export default defineEventHandler(async (event) => {
  const identity = await authenticateSync(event)

  const body = await readBody<IngestBody>(event)
  if (!body || !Array.isArray(body.events)) {
    throw createError({ status: 400, statusText: 'Body must be { events: [...] }' })
  }

  const db = useDB()
  const result = await applyOutboxEvents(
    db,
    body.events,
    undefined,
    identity.kind === 'device' ? identity.teamId : undefined
  )

  // Stamp the freshness heartbeat the online dashboard (#179) reads. Advances on
  // every call — a real batch or the pusher's idle ping (events: []) — so a
  // quiet-but-online till still reads "connected". Best-effort: never fails the
  // ingest (the mirrored data already landed; the clock is advisory).
  await recordSyncHeartbeat(db, result.applied.length, identity.kind === 'device' ? identity : undefined)

  return {
    received: body.events.length,
    // Server clock (epoch ms) so a till can correct its own clock skew (#813/#814).
    serverNow: Date.now(),
    appliedCount: result.applied.length,
    ...result,
  }
})
