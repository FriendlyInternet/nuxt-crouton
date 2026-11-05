// Replace one track's tags, recorded as one undoable change.
import { z } from 'zod'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

const bodySchema = z.object({ tags: z.array(z.string().min(1)).max(100), summary: z.string().max(300) })

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const { trackId } = getRouterParams(event)
  const { tags, summary } = await readValidatedBody(event, bodySchema.parse)
  const result = await writeTags({ teamId: team.id, userId: user.id }, [{ trackId: trackId!, tags }], summary)
  if (!result.tracks.length) throw createError({ status: 404, statusText: 'Track not found' })
  return result
})
