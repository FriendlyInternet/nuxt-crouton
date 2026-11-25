/**
 * GET /api/teams/[id]/email-logs/stats
 *
 * Get email log statistics for a team. Requires the `team:manage` action.
 * Returns counts by status and by email type.
 */
import { requireCan } from '../../../../utils/permissions'
import { useDB, tables, count } from '../../../../utils/database'
import { teamEmailLogScope } from '../../../../utils/email-log-scope'

export default defineEventHandler(async (event) => {
  const { team } = await requireCan(event, 'team:manage')

  const db = useDB()

  // This team's emails, plus team-less ones to its members (#3546)
  const emailFilter = teamEmailLogScope(db, team.id)

  // Total count
  const [totalResult] = await db
    .select({ total: count() })
    .from(tables.authEmailLog)
    .where(emailFilter)

  // Count by status
  const statusCounts = await db
    .select({
      status: tables.authEmailLog.status,
      count: count()
    })
    .from(tables.authEmailLog)
    .where(emailFilter)
    .groupBy(tables.authEmailLog.status)

  // Count by type
  const typeCounts = await db
    .select({
      emailType: tables.authEmailLog.emailType,
      count: count()
    })
    .from(tables.authEmailLog)
    .where(emailFilter)
    .groupBy(tables.authEmailLog.emailType)

  const statusMap: Record<string, number> = {}
  for (const row of statusCounts) {
    statusMap[row.status] = row.count
  }

  const typeMap: Record<string, number> = {}
  for (const row of typeCounts) {
    typeMap[row.emailType] = row.count
  }

  return {
    total: totalResult?.total ?? 0,
    sent: statusMap.sent ?? 0,
    failed: statusMap.failed ?? 0,
    pending: statusMap.pending ?? 0,
    byType: typeMap
  }
})
