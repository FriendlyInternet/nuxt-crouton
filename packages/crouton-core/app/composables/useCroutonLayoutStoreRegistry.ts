import type { CroutonLayoutStoreDefinition } from '../types/layout'
import { registryFor } from '../utils/layout-store-registry'

/**
 * Read the layout stores registered on this Nuxt app (#3650) with
 * `defineCroutonLayoutStore`. Not to be confused with crouton-layout's
 * `useCroutonLayoutStore` (which loads/saves a layout tree).
 */
export function useCroutonLayoutStoreRegistry(): {
  get: (id: string) => CroutonLayoutStoreDefinition | undefined
  list: () => CroutonLayoutStoreDefinition[]
} {
  const registry = registryFor(useNuxtApp())
  return { get: registry.get, list: registry.list }
}
