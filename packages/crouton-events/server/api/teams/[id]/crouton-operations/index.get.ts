import { desc, eq, gte, lte, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { croutonOperations } from '../../../../database/schema'

/**
 * GET /api/teams/:id/crouton-operations
 *
 * Query persisted system operations for a team.
 *
 * Supported query params:
 *   type      — exact match on operation type (e.g. 'auth:login')
 *   source    — filter by emitting package (e.g. 'crouton-auth')
 *   userId    — filter by user
 *   dateFrom  — ISO 8601 lower bound on timestamp
 *   dateTo    — ISO 8601 upper bound on timestamp
 *   page      — 1-based page number (default 1)
 *   pageSize  — results per page (default 50, max 200)
 */
export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()
  const q = getQuery(event)

  const conditions = [eq(croutonOperations.teamId, team.id)]

  if (q.type) conditions.push(eq(croutonOperations.type, String(q.type)))
  if (q.source) conditions.push(eq(croutonOperations.source, String(q.source)))
  if (q.userId) conditions.push(eq(croutonOperations.userId, String(q.userId)))
  if (q.dateFrom) conditions.push(gte(croutonOperations.timestamp, new Date(String(q.dateFrom))))
  if (q.dateTo) conditions.push(lte(croutonOperations.timestamp, new Date(String(q.dateTo))))

  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50))
  const offset = (page - 1) * pageSize

  const rows = await db
    .select()
    .from(croutonOperations)
    .where(and(...conditions))
    .orderBy(desc(croutonOperations.timestamp))
    .limit(pageSize)
    .offset(offset)

  return rows
})
