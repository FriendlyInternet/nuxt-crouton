// Only a team admin may delete a product; the query only matches this team's rows.
import { deleteCatalogProduct } from '../../../../database/queries'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { productId } = getRouterParams(event)
  if (!productId) {
    throw createError({ status: 400, statusText: 'Missing product ID' })
  }
  const { team, user, membership } = await requireTeamAdmin(event)

  return await deleteCatalogProduct(productId, team.id, user.id, { role: membership.role })
})
