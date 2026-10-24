// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateBookingsLocation, getBookingsLocationsByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { BookingsLocation } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const { locationId } = getRouterParams(event)
  if (!locationId) {
    throw createError({ status: 400, statusText: 'Missing location ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const body = await readBody<Partial<BookingsLocation>>(event)

  // Handle translation updates properly
  if (body.translations && body.locale) {
    const [existing] = await getBookingsLocationsByIds(team.id, [locationId]) as any[]
    if (existing) {
      body.translations = {
        ...existing.translations,
        [body.locale]: {
          ...existing.translations?.[body.locale],
          ...body.translations[body.locale]
        }
      }
    }
  }

  return await updateBookingsLocation(locationId, team.id, user.id, {
    title: body.title,
    color: body.color,
    street: body.street,
    zip: body.zip,
    city: body.city,
    location: body.location,
    content: body.content,
    allowedMemberIds: body.allowedMemberIds,
    slots: body.slots,
    openDays: body.openDays,
    slotSchedule: body.slotSchedule,
    blockedDates: body.blockedDates,
    inventoryMode: body.inventoryMode,
    quantity: body.quantity,
    maxBookingsPerMonth: body.maxBookingsPerMonth,
    translations: body.translations
  }, { role: membership.role })
})