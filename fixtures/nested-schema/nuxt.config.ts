// Parity-only e2e fixture (epic #1445, WS1a #1446). NO e2e.manifest.json — it
// is never smoked; it exists solely so the schema-source resolver's parity
// suite has a NESTING-ONLY case: it extends crouton-core + crouton-sales ONLY,
// so crouton-printing's schema is reachable purely via the transitive
// sales -> printing edge (crouton-sales/nuxt.config.ts extends crouton-printing),
// never listed here. Do not add crouton-printing to extends or to the deps.
export default defineNuxtConfig({
  modules: ['@fyit/crouton'],
  compatibilityDate: '2025-07-15',
  extends: ['@fyit/crouton-core', '@fyit/crouton-sales'],
  hub: {
    db: 'sqlite'
  },

  // Match the other fixtures' Cloudflare-free prepare settings.
  ogImage: { enabled: false },
  croutonAuth: {
    methods: {
      passkeys: false
    }
  }
})
