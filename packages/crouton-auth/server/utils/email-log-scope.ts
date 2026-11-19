/**
 * Which auth email log rows a team admin may see (#3546).
 *
 * Rule: a team admin sees exactly the emails that belong to their team.
 * - a row with `organizationId` = this team → included, even when the recipient
 *   is not (yet) a member — e.g. an invitation to someone who hasn't joined;
 * - a row with another team's `organizationId` → excluded;
 * - a row with no `organizationId` (verification, password reset, magic link,
 *   and rows logged before #3546) → included only when the recipient is a
 *   current member of this team.
 *
 * The member list is a subquery, not a list of bound values, so a big team
 * never hits D1's 100-bound-parameter cap.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { authEmailLog, member, user } from '../database/schema/auth'

export function teamEmailLogScope(db: any, teamId: string): SQL {
  const memberEmails = db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, teamId))

  return or(
    eq(authEmailLog.organizationId, teamId),
    and(isNull(authEmailLog.organizationId), inArray(authEmailLog.recipientEmail, memberEmails))
  )!
}
