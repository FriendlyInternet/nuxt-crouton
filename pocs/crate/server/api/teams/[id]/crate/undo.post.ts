// Undo the newest change — works after a reload because history lives in crate_changes.
// Returns the tags AND piles it put back, so the deck can apply both without reloading.
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  return (await undoLast({ teamId: team.id, userId: user.id })) ?? { groupId: null, tracks: [], piles: [], removedPileIds: [] }
})
