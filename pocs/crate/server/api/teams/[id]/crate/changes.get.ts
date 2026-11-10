// Recent changes, newest first, one entry per user action. Survives reloads: it reads crate_changes.
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  return readRecentChanges(useDB(), team.id)
})
