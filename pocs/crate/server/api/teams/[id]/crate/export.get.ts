// Tags to write back to rekordbox (#2213): every track whose tags differ from the Comments it
// had at its last import. Re-importing the XML afterwards resets the baseline, so they drop out.
import { eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateTracks, cratePiles } from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()
  const [rows, piles] = await Promise.all([
    db.select({ rekordboxId: crateTracks.rekordboxId, tags: crateTracks.tags, originalComments: crateTracks.originalComments })
      .from(crateTracks).where(eq(crateTracks.teamId, team.id)),
    db.select({ name: cratePiles.name }).from(cratePiles).where(eq(cratePiles.teamId, team.id))
  ])
  const changed = (rows as { rekordboxId: string, tags: string[] | null, originalComments: string | null }[])
    .filter(r => !sameTags(r.tags, splitComments(r.originalComments)))
    .map(r => ({ rekordboxId: r.rekordboxId, tags: r.tags ?? [] }))
  // Pile names = the genre vocabulary; anything else (PMCP, Wedding, NEW…) isn't a genre.
  return { tracks: changed, genres: (piles as { name: string }[]).map(p => p.name) }
})
