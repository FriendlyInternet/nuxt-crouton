/**
 * GET /api/teams/[id]/email-logs
 *
 * List auth email logs for a team. Requires admin role.
 * Scoped by teamEmailLogScope: this team's emails, plus team-less ones to its members (#3546).
 *
 * Query params:
 * - type: filter by email type (verification, password-reset, invitation, magic-link)
 * - status: filter by status (pending, sent, failed)
 * - limit: max results (default 50, max 200)
 * - offset: pagination offset (default 0)
 */
import { requireTeamAdmin } from '../../../../utils/team'
import { useDB, tables, eq, and, desc, count } from '../../../../utils/database'
import { teamEmailLogScope } from '../../../../utils/email-log-scope'

export default defineEventHandler(async (event) => {
  const { team } = await requireTeamAdmin(event)

  const query = getQuery(event)
  const emailType = query.type as string | undefined
  const status = query.status as string | undefined
  const limit = Math.min(Number(query.limit) || 50, 200)
  const offset = Number(query.offset) || 0

  const db = useDB()

  // Build where conditions
  const conditions: any[] = [teamEmailLogScope(db, team.id)]

  if (emailType) {
    conditions.push(eq(tables.authEmailLog.emailType, emailType))
  }
  if (status) {
    conditions.push(eq(tables.authEmailLog.status, status))
  }

  const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0]

  // Get total count
  const [countResult] = await db
    .select({ total: count() })
    .from(tables.authEmailLog)
    .where(whereClause)

  // Get paginated results
  const items = await db
    .select()
    .from(tables.authEmailLog)
    .where(whereClause)
    .orderBy(desc(tables.authEmailLog.createdAt))
    .limit(limit)
    .offset(offset)

  return {
    items,
    total: countResult?.total ?? 0
  }
})
