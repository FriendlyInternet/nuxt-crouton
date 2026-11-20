import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-catalog',
  name: 'Product catalog',
  description: 'Shared team product list: what a team offers, used by bookings (stock) and later sales (price)',
  icon: 'i-lucide-package',
  version: '1.0.0',
  category: 'addon',
  aiHint: 'use when a team needs one shared list of products that other packages build on',
  dependencies: [],

  layer: {
    name: 'catalog',
    editable: false,
    reason: 'Table names are prefixed with "catalog" (catalogProducts). This cannot be changed.',
  },

  // The collection below ships from this package (collections/products), end to end.
  // The CLI refuses to generate it into an app; `collections` stays as the
  // package's self-description for AI hints and docs.
  ownsCollections: true,

  collections: [
    {
      name: 'product',
      tableName: 'catalogProducts',
      description: 'What a team offers: products that bookings gives a stock and sales gives a price.',
      schemaPath: './products-schema.json',
    },
  ],

  // Registers as 'products' app — detectable via useCroutonApps().hasApp('products')
  croutonApp: {
    id: 'products',
    adminRoutes: [],
  },
})
