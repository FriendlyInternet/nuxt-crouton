// Genre hints for one track (#2212): each source's words (tappable) + piles to suggest/glow.
import { and, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { crateLookups } from '~~/server/db/schema'

const SUGGEST_FROM = 0.3

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const { trackId } = getRouterParams(event)
  const [lookup] = await useDB().select({ results: crateLookups.results }).from(crateLookups)
    .where(and(eq(crateLookups.teamId, team.id), eq(crateLookups.trackId, trackId!))).limit(1)
  const results = ((lookup as { results: Parameters<typeof wordsOf>[0] | null } | undefined)?.results ?? [])
  if (!results.length) return { sources: [], scores: [] }

  const { model } = await hintModel(team.id)
  const sources = results.map((r) => {
    const words = wordsOf([r])
    const seen = new Set<string>()
    return {
      label: sourceLabel(r),
      url: r.url ?? null,
      words: words.filter(w => !seen.has(w.key) && seen.add(w.key)).map(w => ({
        word: w.word,
        pileId: model.exactPile(w.key)?.id ?? null,
        parentId: model.exactPile(w.key) ? null : guessParent(model, w.key)
      }))
    }
  })
  return { sources, scores: scorePiles(model, wordsOf(results)).filter(s => s.score >= SUGGEST_FROM / 2) }
})
