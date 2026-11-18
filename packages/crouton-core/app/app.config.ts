import { croutonRedirectsConfig } from './composables/useCroutonRedirects'

// NOTE: the `croutonLayoutBlocks` defaults (collection-list / entity-form / stats)
// moved to @fyit/crouton-layout with the layout engine (#751). They merge back in
// across layers (defu), so apps still see them — core no longer owns them.

export default defineAppConfig({
  croutonCollections: {
    croutonRedirects: croutonRedirectsConfig,
  },
  // Actions this package guards (#4104) — see crouton-auth CLAUDE.md "Permissions (actions)".
  croutonActions: {
    'site:manage': { label: 'permissions.siteManage' },
    'collections:manage': { label: 'permissions.collectionsManage' },
  },
})
