// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateBookingsBooking } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { BookingsBooking } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const { bookingId } = getRouterParams(event)
  if (!bookingId) {
    throw createError({ status: 400, statusText: 'Missing booking ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const body = await readBody<Partial<BookingsBooking>>(event)

  return await updateBookingsBooking(bookingId, team.id, user.id, {
    location: body.location,
    date: body.date ? new Date(body.date) : body.date,
    slot: body.slot,
    group: body.group,
    quantity: body.quantity,
    status: body.status
  }, { role: membership.role })
})