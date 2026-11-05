// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
// Hand-edited (#3379): picks allowed fields only and checks capacity in the same statement.
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { bookingsBookings } from '../../../../database/schema'
import { bookingsLocations } from '../../../../../../locations/server/database/schema'
import { LOCATION_COLS, dayRange, validateSelection, guardSql, guardedInsert, runAtomic } from '../../../../../../../server/utils/booking-capacity'

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readBody(event) || {}
  const tz: string = (useRuntimeConfig(event) as any)?.croutonBookings?.timezone || 'Europe/Brussels'
  const db = useDB() as any

  const [location] = await db.select(LOCATION_COLS).from(bookingsLocations)
    .where(and(eq(bookingsLocations.id as any, body.location), eq(bookingsLocations.teamId as any, team.id)))
  if (!location) throw createError({ status: 404, statusText: 'Location not found' })

  const range = dayRange(body.date, tz)
  if (!range) throw createError({ status: 400, statusText: 'Invalid date' })

  const selection = validateSelection(location, body.slot, body.quantity)
  const guard = guardSql({ teamId: team.id, locationId: location.id, range, selection })
  const id = nanoid()
  await runAtomic(db, [guardedInsert({
    id, teamId: team.id, owner: user.id, location: location.id, storedTs: range.storedTs,
    slot: selection.slot, group: body.group || null, quantity: selection.quantity,
    status: body.status || 'active', by: user.id, nowTs: Math.floor(Date.now() / 1000),
  }, guard)], 'No room left for that booking')

  const [booking] = await db.select().from(bookingsBookings).where(eq(bookingsBookings.id as any, id))
  return booking
})
