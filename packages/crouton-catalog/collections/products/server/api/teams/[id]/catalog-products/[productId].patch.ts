// Only a team admin may change a product; the query only matches this team's rows.
import { z } from 'zod'
import { updateCatalogProduct, getCatalogProductsByIds } from '../../../../database/queries'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'

// Body validation (#3377). `locale` is a transient merge hint, not a column.
const bodySchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  active: z.boolean().nullish(),
  translations: z.record(z.string(), z.object({
    title: z.string().optional(),
    description: z.string().optional()
  })).nullish()
}).partial().extend({ locale: z.string().optional() }).strip()

export default defineEventHandler(async (event) => {
  const { productId } = getRouterParams(event)
  if (!productId) {
    throw createError({ status: 400, statusText: 'Missing product ID' })
  }
  const { team, user, membership } = await requireTeamAdmin(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  // Merge a single-locale translation update into the stored translations
  if (body.translations && body.locale) {
    const [existing] = await getCatalogProductsByIds(team.id, [productId]) as any[]
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

  return await updateCatalogProduct(productId, team.id, user.id, {
    title: body.title,
    description: body.description,
    active: body.active,
    translations: body.translations
  } as Parameters<typeof updateCatalogProduct>[3], { role: membership.role })
})
