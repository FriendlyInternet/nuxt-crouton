// The web-research question for one track (#2243): the card shares it to Claude on the phone,
// scripts/research.mjs feeds it to `claude -p` on the Mac. Same text either way.
import { and, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { cratePiles, crateTracks } from '~~/server/db/schema'
import { buildResearchPrompt, RESEARCH_JSON_SCHEMA } from '~~/server/utils/crate-research'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const { trackId } = getRouterParams(event)
  const db = useDB()
  const [track] = await db.select().from(crateTracks)
    .where(and(eq(crateTracks.teamId, team.id), eq(crateTracks.id, trackId!))).limit(1)
  if (!track) throw createError({ statusCode: 404, statusMessage: 'Track not found' })
  const [piles, others] = await Promise.all([
    db.select({ id: cratePiles.id, name: cratePiles.name, parentId: cratePiles.parentId }).from(cratePiles).where(eq(cratePiles.teamId, team.id)),
    db.select({ id: crateTracks.id, name: crateTracks.name, artist: crateTracks.artist, tags: crateTracks.tags }).from(crateTracks).where(eq(crateTracks.teamId, team.id))
  ])
  const { prompt } = buildResearchPrompt(
    track as Parameters<typeof buildResearchPrompt>[0],
    piles,
    (others as { id: string, name: string, artist: string | null, tags: string[] | null }[]).map(o => ({ ...o, tags: o.tags ?? [] }))
  )
  return { prompt, schema: RESEARCH_JSON_SCHEMA }
})
