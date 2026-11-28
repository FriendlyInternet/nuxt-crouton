/**
 * Run the daily reminder / follow-up job now, for this team only (#3930).
 * POST /api/crouton-bookings/teams/[id]/scheduled-emails/run
 *
 * Admin or owner only. Sends real email to the customers whose reminder or
 * follow-up is due today; a booking + template already logged to that customer
 * is never sent again, so running it twice is safe.
 */
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { runScheduledBookingEmails } from '../../../../../utils/scheduled-emails'

export default defineEventHandler(async (event) => {
  const { team } = await requireTeamAdmin(event)
  const tz = (useRuntimeConfig(event) as any).croutonBookings?.timezone || 'Europe/Brussels'
  return await runScheduledBookingEmails({ teamId: team.id, tz })
})
