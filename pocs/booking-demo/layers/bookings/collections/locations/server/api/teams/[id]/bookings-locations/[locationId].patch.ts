// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateBookingsLocation, getBookingsLocationsByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bookingsLocationsSlotItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  capacity: z.number().optional()
})

const bodySchema = z.object({
  color: z.string().optional(),
  location: z.string().optional(),
  allowedMemberIds: z.array(z.string()).optional(),
  slots: z.array(bookingsLocationsSlotItemSchema).optional(),
  openDays: z.array(z.string()).nullish(),
  slotSchedule: z.record(z.string(), z.any()).nullish(),
  blockedDates: z.array(z.any()).nullish(),
  inventoryMode: z.boolean().optional(),
  quantity: z.number().optional(),
  maxBookingsPerMonth: z.number().optional(),
  title: z.string().optional(),
  street: z.string().optional(),
  zip: z.string().optional(),
  city: z.string().optional(),
  content: z.string().optional(),
  translations: z.record(
    z.string(),
    z.object({
      title: z.string().min(1, 'Title is required'),
      street: z.string().optional(),
      zip: z.string().optional(),
      city: z.string().optional(),
      content: z.string().optional()
    })
  ).refine(
    (translations) => translations.en && translations.en.title,
    { message: 'Translations for title (en) are required' }
  ),
  // Transient hint: which locale the translation patch targets (not a column)
  locale: z.string().optional()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { locationId } = getRouterParams(event)
  if (!locationId) {
    throw createError({ status: 400, statusText: 'Missing location ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

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

  // Only include fields that were actually sent in the request
  const updates: Record<string, any> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'locale') continue // transient translation hint, not a column
    if (value !== undefined) {
      updates[key] = value
    }
  }

  const dbTimer = timing.start('db')
  const result = await updateBookingsLocation(locationId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})