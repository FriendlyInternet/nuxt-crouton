// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createBookingsEmaillog, assertBookingsEmaillogReferences } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readBody(event)

  await assertBookingsEmaillogReferences(team.id, body)

  // Exclude id field to let the database generate it
  const { id, ...dataWithoutId } = body

  return await createBookingsEmaillog({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
})