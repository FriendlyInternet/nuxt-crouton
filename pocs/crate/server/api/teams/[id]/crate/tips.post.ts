// Tips from a Mac-side source (#2229): audio "sounds like" votes, the web research agent.
// Each source owns its entry in a track's lookup results and replaces only that one.
import { z } from 'zod'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

const bodySchema = z.object({
  source: z.string().min(1),
  tips: z.array(z.object({ trackId: z.string().min(1), result: z.record(z.string(), z.unknown()) })).max(500)
})

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const audit = { teamId: team.id, owner: user.id, createdBy: user.id, updatedBy: user.id }
  return mergeLookupSource(audit, body.source, body.tips)
})
