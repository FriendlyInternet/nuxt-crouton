/**
 * Simple Products Configuration Example
 * =====================================
 *
 * Minimal config for generating a single products collection.
 * For a comprehensive example with all options, see crouton.config.example.js
 *
 * Usage:
 *   npx crouton-generate config ./crouton.config.products.js
 */

export default {
  // Feature flags (optional) - used by getCroutonLayers()
  // features: {
  //   editor: true,  // Enable TipTap rich text
  // },

  dialect: 'sqlite',

  // Enhanced format: each collection has its own schema
  collections: [
    {
      name: 'products',
      fieldsFile: './test-product-schema.json'
    }
  ],

  targets: [
    {
      layer: 'shop',
      collections: ['products']
    }
  ],

  flags: {
    noTranslations: true,
    force: true,
    noDb: false,
    dryRun: false
    // NOTE: Team fields (teamId, owner) are always included
    // All generated endpoints use @crouton/auth for team-based authentication
  }
}
