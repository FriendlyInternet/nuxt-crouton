/**
 * GET /api/teams/[id]/email-logs
 *
 * List auth email logs for a team. Requires the `team:manage` action.
 * Scoped to emails sent to team member addresses.
 *
 * Query params:
 * - type: filter by email type (verification, password-reset, invitation, magic-link)
 * - status: filter by status (pending, sent, failed)
 * - limit: max results (default 50, max 200)
 * - offset: pagination offset (default 0)
 */
import { requireCan } from '../../../../utils/permissions'
import { useDB, tables, eq, and, desc, count, inArray } from '../../../../utils/database'

export default defineEventHandler(async (event) => {
  const { team } = await requireCan(event, 'team:manage')

  const query = getQuery(event)
  const emailType = query.type as string | undefined
  const status = query.status as string | undefined
  const limit = Math.min(Number(query.limit) || 50, 200)
  const offset = Number(query.offset) || 0

  const db = useDB()

  // Get team member emails to scope logs to this team
  const teamMembers = await db
    .select({ email: tables.user.email })
    .from(tables.member)
    .innerJoin(tables.user, eq(tables.member.userId, tables.user.id))
    .where(eq(tables.member.organizationId, team.id))

  const memberEmails = teamMembers.map((m: any) => m.email)

  if (memberEmails.length === 0) {
    return { items: [], total: 0 }
  }

  // Build where conditions
  const conditions: any[] = [
    inArray(tables.authEmailLog.recipientEmail, memberEmails)
  ]

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
