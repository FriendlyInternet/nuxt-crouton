/**
 * GET /api/site/:slug — the PUBLIC read for a served page (#2490).
 *
 * The builder's collection API is team-scoped and needs a session; the page a
 * designer publishes should not. This returns only what the served page renders:
 * the title and the live layout (the `board` JSON), nothing else from the row.
 *
 * POC scope: slugs are unique per team; this resolves the first match across
 * teams. A real app would route by team/site domain first.
 */
import { eq } from 'drizzle-orm'
import * as tables from '../../../collections/pages/server/database/schema'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ status: 400, statusText: 'Missing slug' })
  const db = useDB()
  const row = await db.select({ title: tables.builderPages.title, board: tables.builderPages.board, status: tables.builderPages.status })
    .from(tables.builderPages)
    .where(eq(tables.builderPages.slug, slug))
    .get()
  if (!row) throw createError({ status: 404, statusText: 'Page not found' })
  return { title: row.title, board: row.board ?? {} }
})
