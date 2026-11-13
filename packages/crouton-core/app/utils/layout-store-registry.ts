/**
 * Layout store registry (#3650) — where a package registers the stores a layout
 * can feed to its blocks.
 *
 * Definitions live **per Nuxt app**, not in the module: Nuxt runs plugins again
 * on every server request with a fresh app, so a module-level map would be
 * written by every request (and would "conflict" with itself from the second
 * request on). `registryFor(nuxtApp)` hands each app instance its own registry
 * through a `WeakMap`, freed with the app after the request.
 *
 * Call `defineCroutonLayoutStore` from a Nuxt plugin (anywhere `useNuxtApp()`
 * works). Registering the same definition object again is a silent no-op; a
 * different definition under a taken id replaces it, with a dev-mode warning.
 * Read definitions with `useCroutonLayoutStoreRegistry()`.
 */
import type { CroutonLayoutStoreDefinition } from '../types/layout'

export interface CroutonLayoutStoreRegistry {
  register: (def: CroutonLayoutStoreDefinition) => void
  get: (id: string) => CroutonLayoutStoreDefinition | undefined
  list: () => CroutonLayoutStoreDefinition[]
}

/** A fresh registry backed by its own Map. Pure — unit-testable. */
export function createLayoutStoreRegistry(): CroutonLayoutStoreRegistry {
  const defs = new Map<string, CroutonLayoutStoreDefinition>()
  return {
    register(def) {
      const existing = defs.get(def.id)
      if (existing === def) return
      // `!== false`: Nuxt defines it false in production builds; dev + unit tests warn.
      if (existing && import.meta.dev !== false) {
        console.warn(`[crouton] layout store "${def.id}" was registered twice with different definitions; the last one wins.`)
      }
      defs.set(def.id, def)
    },
    get: id => defs.get(id),
    list: () => [...defs.values()],
  }
}

const registries = new WeakMap<object, CroutonLayoutStoreRegistry>()

/** The registry belonging to one Nuxt app instance (created on first use). */
export function registryFor(nuxtApp: object): CroutonLayoutStoreRegistry {
  let r = registries.get(nuxtApp)
  if (!r) {
    r = createLayoutStoreRegistry()
    registries.set(nuxtApp, r)
  }
  return r
}

/** Register a layout store on the current Nuxt app. Call from a Nuxt plugin. */
export function defineCroutonLayoutStore<S>(def: CroutonLayoutStoreDefinition<S>): CroutonLayoutStoreDefinition<S> {
  registryFor(useNuxtApp()).register(def)
  return def
}
