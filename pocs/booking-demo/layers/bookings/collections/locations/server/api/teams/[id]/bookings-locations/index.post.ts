// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createBookingsLocation } from '../../../../database/queries'
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
  )
}).strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)

  // body is the validated payload (id is not part of the schema) — the database generates the id
  const dataWithoutId = body

  const dbTimer = timing.start('db')
  const result = await createBookingsLocation({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})