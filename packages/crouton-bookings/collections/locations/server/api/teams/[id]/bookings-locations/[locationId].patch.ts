// Team-based endpoint - requires @fyit/crouton-auth package
// The requireTeamAdmin utility handles team resolution and auth
import { z } from 'zod'
import { assertBookingsLocationReferences, updateBookingsLocation, getBookingsLocationsByIds } from '../../../../database/queries'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { ensureLocationProducts } from '../../../../../../../server/utils/location-products'

// A location lists each team product once, with a whole-number stock of at least 1 (#3967)
const productsSchema = z.array(z.object({
  product: z.string().min(1),
  stock: z.number().int().min(1)
})).refine(list => new Set(list.map(p => p.product)).size === list.length, { message: 'Each product may be listed once' }).nullish()

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
}).partial().extend({ locale: z.string().optional() }).strip()

export default defineEventHandler(async (event) => {
  const { locationId } = getRouterParams(event)
  if (!locationId) {
    throw createError({ status: 400, statusText: 'Missing location ID' })
  }
  const { team, user, membership } = await requireTeamAdmin(event)

  const body = await readValidatedBody(event, bodySchema.parse)
  await assertBookingsLocationReferences(team.id, body)

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

  const location = await updateBookingsLocation(locationId, team.id, user.id, {
    title: body.title,
    color: body.color,
    street: body.street,
    zip: body.zip,
    city: body.city,
    location: body.location,
    content: body.content,
    allowedMemberIds: body.allowedMemberIds,
    slots: body.slots,
    products: body.products,
    openDays: (body.openDays) as unknown as string[] | undefined,
    slotSchedule: body.slotSchedule,
    blockedDates: body.blockedDates,
    maxBookingsPerMonth: body.maxBookingsPerMonth,
    translations: body.translations
  } as Parameters<typeof updateBookingsLocation>[3], { role: membership.role })

  // A PATCH that leaves products NULL (e.g. sends `products: null`) gets the own product back (#4044)
  return (await ensureLocationProducts(useDB(), team.id, location.id)) ?? location
})
