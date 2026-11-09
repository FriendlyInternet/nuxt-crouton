// Recent changes, newest first, one entry per user action. Survives reloads: it reads crate_changes.
import { desc, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateChanges } from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const rows = await useDB().select({
    groupId: crateChanges.groupId,
    trackId: crateChanges.trackId,
    pileId: crateChanges.pileId,
    summary: crateChanges.summary,
    undoOf: crateChanges.undoOf,
    createdAt: crateChanges.createdAt
  }).from(crateChanges).where(eq(crateChanges.teamId, team.id)).orderBy(desc(crateChanges.createdAt)).limit(300)
  return groupRecentChanges(rows)
})
