/**
 * Page Access Code (scoped visibility)
 *
 * Manages the scoped-access grant on ('page', pageId) — the code visitors
 * redeem in the ScopedAccessGate when the page has visibility 'scoped' and
 * no requiredScope of its own. The code is stored hashed (crouton-auth
 * grant), so GET only reports existence, never the code itself.
 *
 * GET    → { exists: boolean }
 * PUT    → body { code: string } — create/update the grant
 * DELETE → revoke the grant
 *
 * Team admin only.
 */
import { eq, and } from 'drizzle-orm'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import {
  upsertScopedGrant,
  revokeScopedGrantsForResource,
  listScopedGrantsForResource
} from '@fyit/crouton-auth/server/utils/scoped-access'

export default defineEventHandler(async (event) => {
  const { team } = await requireTeamAdmin(event)
  const pageId = getRouterParam(event, 'pageId')

  if (!pageId) {
    throw createError({ status: 400, statusText: 'Page ID is required' })
  }

  // Verify the page exists and belongs to this team
  const pagesSchema = await import('../../../../../../collections/pages/server/database/schema')
  const database = useDB()
  const [page] = await database
    .select({ id: pagesSchema.pagesPages.id as any })
    .from(pagesSchema.pagesPages as any)
    .where(
      and(
        eq(pagesSchema.pagesPages.id as any, pageId),
        eq(pagesSchema.pagesPages.teamId as any, team.id)
      )
    )
    .limit(1)

  if (!page) {
    throw createError({ status: 404, statusText: 'Page not found' })
  }

  const method = event.method

  if (method === 'GET') {
    const grants = await listScopedGrantsForResource('page', pageId)
    return { exists: grants.length > 0 }
  }

  if (method === 'PUT') {
    const body = await readBody<{ code?: string }>(event)
    const code = body?.code?.trim()

    if (!code) {
      throw createError({ status: 400, statusText: 'Code is required' })
    }

    await upsertScopedGrant({
      organizationId: team.id,
      resourceType: 'page',
      resourceId: pageId,
      secret: code,
      role: 'guest'
    })

    return { exists: true }
  }

  if (method === 'DELETE') {
    await revokeScopedGrantsForResource('page', pageId)
    return { exists: false }
  }

  throw createError({ status: 405, statusText: 'Method not allowed' })
})
