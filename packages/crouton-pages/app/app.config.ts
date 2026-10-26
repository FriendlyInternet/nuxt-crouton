import { pagesPagesConfig } from '../collections/pages/app/composables/usePagesPages'
// The pages collection ships with this package (#2278); registering it here
// means a consuming app lists nothing for pages in its own app.config.

export default defineAppConfig({
  croutonCollections: {
    pagesPages: { ...pagesPagesConfig, adminNav: { label: 'pages.collections.pages.title' } }
  },
  // App auto-discovery registration for crouton-pages
  croutonApps: {
    pages: {
      id: 'pages',
      name: 'pages.title',
      icon: 'i-lucide-file-text',
      // Admin routes (appear in /admin/[team]/ sidebar)
      adminRoutes: [
        {
          path: '/workspace',
          label: 'pages.admin.pages',
          icon: 'i-lucide-file-text'
        }
      ],
      // No dashboard routes - pages are public-facing
      dashboardRoutes: [],
      // No settings routes - page settings are managed in admin
      settingsRoutes: [],
      // Core page type for regular content pages
      pageTypes: [
        {
          id: 'regular',
          // name/description are i18n keys, translated at render via useT().
          name: 'pages.pageTypes.regular.name',
          description: 'pages.pageTypes.regular.description',
          icon: 'i-lucide-file-text',
          component: 'CroutonPagesRegularContent',
          category: 'content',
          configSchema: []
        },
        {
          id: 'collection-binder',
          name: 'pages.pageTypes.collectionBinder.name',
          description: 'pages.pageTypes.collectionBinder.description',
          icon: 'i-lucide-layers',
          component: 'CroutonPagesCollectionBinderRenderer',
          category: 'collections',
          configSchema: []
        },
        {
          id: 'footer',
          name: 'pages.pageTypes.footer.name',
          description: 'pages.pageTypes.footer.description',
          icon: 'i-lucide-panel-bottom',
          component: 'CroutonPagesFooterRenderer',
          category: 'layout',
          hasBlockContent: true,
          singleton: true,
          configSchema: []
        }
      ]
    }
  }
})
