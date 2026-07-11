/**
 * Slim single-job status read for the Testprint button's outcome poll (#1506).
 *
 * The Testprint POST returns `{ queueId }`; the form polls THIS endpoint for
 * that one job's terminal status so it can report printed ✓ / failed ✗ + the
 * spooler's reason (not just "queued"). Team-authed sibling of
 * `printqueues/status.get.ts` — same generic crouton-printing `print_jobs`
 * queue (epic #325), scoped to this team + event so a queueId from another
 * team/event can't be read. Returns only status + errorMessage (never the
 * bulky base64 payload) so it stays cheap to poll every couple of seconds.
 */
import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const eventId = getRouterParam(event, 'eventId')
  const queueId = getRouterParam(event, 'queueId')

  if (!eventId || !queueId) {
    throw createError({ status: 400, statusText: 'Event ID and queue ID are required' })
  }

  const db = useDB()

  const [job] = await db
    .select({
      id: printJobs.id,
      status: printJobs.status,
      errorMessage: printJobs.errorMessage,
      completedAt: printJobs.completedAt
    })
    .from(printJobs)
    .where(and(
      eq(printJobs.id, queueId),
      eq(printJobs.teamId, team.id),
      eq(printJobs.eventId, eventId),
      eq(printJobs.source, 'sales')
    ))
    .limit(1)

  if (!job) {
    throw createError({ status: 404, statusText: 'Print job not found' })
  }

  return job
})
