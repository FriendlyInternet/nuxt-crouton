import { croutonAssetsConfig } from '../collections/assets/app/composables/useCroutonAssets'
// The assets collection ships with this package (#2278); registering it here
// means a consuming app lists nothing for assets in its own app.config.

export default defineAppConfig({
  croutonCollections: {
    croutonAssets: {
      ...croutonAssetsConfig,
      container: 'modal',
      adminNav: { label: 'crouton.collections.assets.title' }
    }
  },

  // App auto-discovery registration for crouton-assets
  croutonApps: {
    assets: {
      id: 'assets',
      name: 'assets.title',
      icon: 'i-lucide-image',
      // API route prefixes for devtools operation tracking
      apiRoutes: ['/api/assets/'],
      // Admin routes (appear in /admin/[team]/ sidebar)
      adminRoutes: [
        {
          path: '/media',
          label: 'assets.admin.media',
          icon: 'i-lucide-image'
        }
      ],
      dashboardRoutes: [],
      settingsRoutes: []
    }
  }
})
