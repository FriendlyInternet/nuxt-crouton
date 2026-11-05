/**
 * GET /api/site/:slug — the PUBLIC read for a served page (#2490).
 *
 * The builder's collection API is team-scoped and needs a session; the page a
 * designer publishes should not. This returns only what the served page renders:
 * the title and the live layout (the `board` JSON), nothing else from the row.
 *
 * Slugs are unique per TEAM, not globally — every team's first page is `page-1`.
 * So the reader's active team wins; only a slug no team of theirs has falls back to
 * the first match (#2598: an owner's page rendered another team's empty `page-1`).
 */
import { eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import * as tables from '../../../collections/pages/server/database/schema'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ status: 400, statusText: 'Missing slug' })
  const db = useDB()
  const rows = await db.select({ teamId: tables.builderPages.teamId, title: tables.builderPages.title, board: tables.builderPages.board })
    .from(tables.builderPages)
    .where(eq(tables.builderPages.slug, slug))
    .all()
  if (!rows.length) throw createError({ status: 404, statusText: 'Page not found' })
  const activeTeamId = await resolveTeamAndCheckMembership(event).then(c => c.team.id, () => null)
  const row = rows.find(r => r.teamId === activeTeamId) ?? rows[0]!
  return { title: row.title, board: row.board ?? {} }
})
