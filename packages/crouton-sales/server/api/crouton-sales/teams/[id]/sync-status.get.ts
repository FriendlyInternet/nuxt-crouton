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
import { readLostEdits, readSyncStatuses, toStatusPayload } from '../../../../utils/sync-status'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()
  const [statuses, lostEdits] = await Promise.all([readSyncStatuses(db, team.id), readLostEdits(db, team.id)])
  return toStatusPayload(statuses, Date.now(), lostEdits)
})
