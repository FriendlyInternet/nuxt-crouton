// Undo the newest change — works after a reload because history lives in crate_changes.
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  return (await undoLast({ teamId: team.id, userId: user.id })) ?? { groupId: null, tracks: [] }
})
