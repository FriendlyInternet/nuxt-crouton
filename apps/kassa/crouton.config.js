export default {
  // Single-language app: Dutch only (no locale switcher / no URL locale prefix)
  locales: ['nl'],
  defaultLocale: 'nl',

  // Feature flags - which crouton packages to enable
  features: {
    sales: { config: { print: { enabled: true } } },
    pages: true,
    // crouton-layout is `bundled: true` (default-on). Kassa doesn't use the layout
    // engine — its `0018` layout_configs table was dead weight — so opt out
    // explicitly, or `crouton config` writes the extends back (#1455).
    layout: false
  },

  collections: [
    { name: 'pages', fieldsFile: './schemas/pages.json', formComponent: 'CroutonPagesForm', hierarchy: { enabled: true, parentField: 'parentId', orderField: 'order', pathField: 'path', depthField: 'depth' } }
  ],

  targets: [
    {
      layer: 'pages',
      collections: ['pages']
    }
  ],

  dialect: 'sqlite'
}
