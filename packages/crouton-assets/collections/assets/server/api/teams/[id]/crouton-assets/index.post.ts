// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createCroutonAsset } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readBody(event)

  // Exclude id field to let the database generate it
  const { id, ...dataWithoutId } = body

  // Convert date string to Date object
  if (dataWithoutId.uploadedAt) {
    dataWithoutId.uploadedAt = new Date(dataWithoutId.uploadedAt)
  }
  return await createCroutonAsset({
    ...dataWithoutId,
    teamId: team.id,
    userId: user.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
})