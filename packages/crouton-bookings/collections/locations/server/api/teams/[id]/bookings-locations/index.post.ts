// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import { createBookingsLocation } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

// Hand-added body validation (#3377): wrong types -> 400, unknown/system keys are stripped.
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
}).strip()

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  return await createBookingsLocation({
    ...body,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  } as Parameters<typeof createBookingsLocation>[0])
})
