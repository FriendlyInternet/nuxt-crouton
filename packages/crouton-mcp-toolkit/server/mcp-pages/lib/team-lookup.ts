/**
 * The real team deps for the page tools (#4097), from crouton-auth. In its own
 * file (not `deps.ts`) so a test can load it without the pages / collab / layout
 * imports `deps.ts` pulls in.
 *
 * `getTeamById` and `getTeamBySlug` are both async: they are awaited one after
 * the other. (`getTeamById(…) ?? getTeamBySlug(…)` would never try the slug — a
 * Promise is never nullish — and every call naming a team by slug, the form
 * `list_teams` gives Claude, would be refused.)
 */
import { canEditPages, getTeamById, getTeamBySlug, getUserTeamsDirect } from '@fyit/crouton-auth/server/utils/team'
import type { PagesToolDeps } from './tools'

export function pagesTeamDeps(): PagesToolDeps['teams'] {
  return {
    findTeam: async (idOrSlug) => {
      const event = useEvent()
      const team = (await getTeamById(event, idOrSlug)) ?? (await getTeamBySlug(event, idOrSlug))
      return team ? { id: team.id, slug: team.slug, name: team.name } : null
    },
    canEditPages: (teamId, userId) => canEditPages(teamId, userId),
    listUserTeams: userId => getUserTeamsDirect(userId)
  }
}
