/// <reference path="../../../crouton-catalog/server/crouton-hooks.d.ts" />
// #4278 — refuse deleting a catalog product that a location of the team still
// lists. No try/catch: a throw reaches the delete route, which answers with its
// "could not check" 409 and deletes nothing.
import { productBlockers } from '../utils/product-in-use'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('crouton:catalog:before-delete-product', async (p) => {
    p.blockers.push(...await productBlockers(useDB(), p.teamId, p.productId))
  })
})
