import { croutonRedirectsConfig } from './composables/useCroutonRedirects'
import { disabledButtonCompoundVariants } from './theme/disabled-button'

// NOTE: the `croutonLayoutBlocks` defaults (collection-list / entity-form / stats)
// moved to @fyit/crouton-layout with the layout engine (#751). They merge back in
// across layers (defu), so apps still see them — core no longer owns them.

export default defineAppConfig({
  croutonCollections: {
    croutonRedirects: croutonRedirectsConfig,
  },
  // Disabled UButton reads as disabled, not just faded (#4329).
  ui: {
    button: {
      compoundVariants: disabledButtonCompoundVariants,
    },
  },
})
