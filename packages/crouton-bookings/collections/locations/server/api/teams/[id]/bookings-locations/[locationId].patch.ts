// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import { updateBookingsLocation, getBookingsLocationsByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

// Hand-added body validation (#3377). `locale` is a transient merge hint, not a column.
const bodySchema = z.object({
  title: z.string().min(1),
  color: z.string().nullish(),
  street: z.string().nullish(),
  zip: z.string().nullish(),
  city: z.string().nullish(),
  location: z.string().nullish(),
  content: z.string().nullish(),
  allowedMemberIds: z.array(z.string()).nullish(),
  slots: z.array(z.object({
    id: z.string(),
    label: z.string(),
    capacity: z.number().optional()
  })).nullish(),
  openDays: z.array(z.number()).nullish(),
  slotSchedule: z.record(z.string(), z.any()).nullish(),
  blockedDates: z.array(z.any()).nullish(),
  offerFullDay: z.boolean().nullish(),
  inventoryMode: z.boolean().nullish(),
  quantity: z.number().int().nullish(),
  maxBookingsPerMonth: z.number().int().nullish(),
  translations: z.record(z.string(), z.object({
    title: z.string().optional(),
    street: z.string().optional(),
    zip: z.string().optional(),
    city: z.string().optional(),
    content: z.string().optional()
  })).nullish()
}).partial().extend({ locale: z.string().optional() }).strip()

export default defineEventHandler(async (event) => {
  const { locationId } = getRouterParams(event)
  if (!locationId) {
    throw createError({ status: 400, statusText: 'Missing location ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

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
