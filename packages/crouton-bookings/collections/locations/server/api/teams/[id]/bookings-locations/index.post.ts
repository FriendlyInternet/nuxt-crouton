// Team-based endpoint - requires @fyit/crouton-auth package
// The requireCan utility handles team resolution and auth
import { z } from 'zod'
import { assertBookingsLocationReferences, createBookingsLocation } from '../../../../database/queries'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'
import { ensureLocationProducts } from '../../../../../../../server/utils/location-products'

// A location lists each team product once, with a whole-number stock of at least 1 (#3967)
const productsSchema = z.array(z.object({
  product: z.string().min(1),
  stock: z.number().int().min(1)
})).refine(list => new Set(list.map(p => p.product)).size === list.length, { message: 'Each product may be listed once' }).nullish()

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
    label: z.string()
  })).nullish(),
  products: productsSchema,
  openDays: z.array(z.number()).nullish(),
  slotSchedule: z.record(z.string(), z.any()).nullish(),
  blockedDates: z.array(z.any()).nullish(),
  offerFullDay: z.boolean().nullish(),
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
  const { team, user } = await requireCan(event, 'bookings:manage')

  const body = await readValidatedBody(event, bodySchema.parse)
  await assertBookingsLocationReferences(team.id, body)

  const location = await createBookingsLocation({
    ...body,
    products: body.products,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  } as Parameters<typeof createBookingsLocation>[0])

  // Saved without products → the location gets one product of its own (#4044)
  return (await ensureLocationProducts(useDB(), team.id, location.id)) ?? location
})
