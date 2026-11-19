/**
 * Nitro hooks fired by @fyit/crouton-catalog (#4278).
 *
 * The catalog cannot know which packages store its product ids (they depend on
 * it, not the other way round), so it asks them through this hook before it
 * deletes a product.
 */

declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'crouton:catalog:before-delete-product': (payload: CatalogBeforeDeleteProductPayload) => void | Promise<void>
  }
}

/**
 * Payload for the crouton:catalog:before-delete-product Nitro hook.
 *
 * Fired by DELETE /api/teams/[id]/catalog-products/[productId] after the admin
 * check and before the row is deleted. To refuse the delete, a listener pushes
 * a full, human-readable sentence onto `blockers` (it is shown to the admin as
 * is; all blockers are joined with a space). A listener that throws also
 * refuses the delete ("could not check" 409). Nothing is deleted in either case.
 */
export interface CatalogBeforeDeleteProductPayload {
  teamId: string
  productId: string
  blockers: string[]
}

export {}
