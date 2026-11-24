/// <reference path="../../../../../../../server/crouton-hooks.d.ts" />
// Only a team admin may delete a product; the query only matches this team's rows.
// Before deleting, packages that store product ids may refuse it through the
// `crouton:catalog:before-delete-product` hook (#4278).
import { deleteCatalogProduct } from '../../../../database/queries'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { productId } = getRouterParams(event)
  if (!productId) {
    throw createError({ status: 400, statusText: 'Missing product ID' })
  }
  const { team, user, membership } = await requireTeamAdmin(event)

  const payload = { teamId: team.id, productId, blockers: [] as string[] }
  try {
    await useNitroApp().hooks.callHook('crouton:catalog:before-delete-product', payload)
  } catch (err) {
    console.error('[crouton-catalog] before-delete-product hook failed:', err)
    throw createError({
      status: 409,
      statusText: 'Product in use check failed',
      message: 'Could not check whether this product is still in use. Nothing was deleted.',
    })
  }
  if (payload.blockers.length) {
    throw createError({ status: 409, statusText: 'Product in use', message: payload.blockers.join(' ') })
  }

  return await deleteCatalogProduct(productId, team.id, user.id, { role: membership.role })
})
