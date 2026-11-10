// Save a research answer as the track's "Agent" tip (#2243): pasted from a chat (`text`) or
// the Mac script's structured output (`answer`). Replaces an older Agent tip, keeps other sources.
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks } from '~~/server/db/schema'
import { measuredEnergy, parseResearchAnswer, researchAnswerSchema, toTip } from '~~/server/utils/crate-research'

const bodySchema = z.object({ text: z.string().min(1).max(50_000).optional(), answer: z.unknown().optional() })

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const { trackId } = getRouterParams(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const parsed = body.text !== undefined
    ? parseResearchAnswer(body.text)
    : (() => {
        const r = researchAnswerSchema.safeParse(body.answer)
        return r.success ? { data: r.data } : { error: 'That doesn\'t look like Claude\'s answer — copy the whole reply' }
      })()
  if ('error' in parsed) throw createError({ statusCode: 400, statusMessage: parsed.error, message: parsed.error })

  const [track] = await useDB().select({ id: crateTracks.id, comments: crateTracks.originalComments }).from(crateTracks)
    .where(and(eq(crateTracks.teamId, team.id), eq(crateTracks.id, trackId!))).limit(1)
  if (!track) throw createError({ statusCode: 404, statusMessage: 'Track not found' })

  const audit = { teamId: team.id, owner: user.id, createdBy: user.id, updatedBy: user.id }
  return mergeLookupSource(audit, 'Agent', [{ trackId: track.id, result: toTip(parsed.data, measuredEnergy(track.comments)) }])
})
