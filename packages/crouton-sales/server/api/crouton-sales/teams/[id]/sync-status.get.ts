/**
 * Sync status (freshness) endpoint for the online dashboard (#179, epic #175).
 *
 * Returns the cloud's D1-mirror heartbeat — when the venue Pi last checked in —
 * so the live dashboard can render "last synced Xs ago" and flag staleness when
 * the Pi is offline. Read-only; team-members-only (mirror data is team-scoped).
 *
 * `serverNow` is included so the client computes age against the *server's*
 * clock, immune to device clock skew. Heartbeats are keyed per paired till (#2725) and
 * filtered to the caller's team — see server/database/schema.ts.
 */
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { freshestStatus, readSyncStatuses } from '../../../../utils/sync-status'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const statuses = await readSyncStatuses(db, team.id)
  const freshest = freshestStatus(statuses)
  const ms = (d: Date | null) => (d ? d.getTime() : null)

  return {
    // Headline = the freshest till, so existing banners keep working.
    lastContactAt: ms(freshest?.lastContactAt ?? null),
    lastEventAt: ms(freshest?.lastEventAt ?? null),
    lastBatchApplied: freshest?.lastBatchApplied ?? 0,
    // Every till of the team (#2725), freshest first.
    devices: statuses.map(s => ({
      deviceId: s.deviceId,
      lastContactAt: ms(s.lastContactAt),
      lastEventAt: ms(s.lastEventAt),
      lastBatchApplied: s.lastBatchApplied,
    })),
    serverNow: Date.now(),
  }
})
