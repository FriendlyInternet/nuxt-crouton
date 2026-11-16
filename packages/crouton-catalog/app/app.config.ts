import { catalogProductsConfig } from '../collections/products/app/composables/useCatalogProducts'
// The products collection ships with this package; registering it here
// means a consuming app lists nothing for products in its own app.config.
// Every registered collection gets an entry in the admin menu's Collections
// group, linked to core's generic collection page — that is the Products page.

export default defineAppConfig({
  croutonCollections: {
    catalogProducts: {
      ...catalogProductsConfig,
      adminNav: { label: 'catalog.collections.products.title', icon: 'i-lucide-package' }
    }
  },

  // App auto-discovery registration for crouton-catalog. No routes, so the
  // sidebar leaves it out (the collection entry above is the one "Products"
  // link); it stays so useCroutonApps().hasApp('products') works.
  croutonApps: {
    products: {
      id: 'products',
      name: 'products.title',
      icon: 'i-lucide-package',
      adminRoutes: [],
      dashboardRoutes: [],
      settingsRoutes: []
    }
  }
})
