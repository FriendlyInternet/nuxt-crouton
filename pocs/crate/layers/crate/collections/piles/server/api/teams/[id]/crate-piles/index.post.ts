// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createCratePile, getCratePilesByIds } from '../../../../database/queries'
import { nanoid } from 'nanoid'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  name: z.string().min(1, 'name is required'),
  parentId: z.string().nullable().optional()
}).strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)

  // body is the validated payload (id is not part of the schema) — we generate the id for path calculation
  const dataWithoutId = body

  // Generate ID upfront for correct path calculation
  const recordId = nanoid()

  // Calculate path based on parentId
  let path = `/${recordId}/`
  let depth = 0

  if (dataWithoutId.parentId) {
    const [parent] = await getCratePilesByIds(team.id, [dataWithoutId.parentId])
    if (parent) {
      path = `${parent.path}${recordId}/`
      depth = (parent.depth || 0) + 1
    }
  }

  const dbTimer = timing.start('db')
  const result = await createCratePile({
    ...dataWithoutId,
    id: recordId,
    path,
    depth,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})