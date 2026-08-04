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
    { name: 'events', fieldsFile: './schemas/events.json' },
    { name: 'products', fieldsFile: './schemas/products.json', sortable: true },
    { name: 'categories', fieldsFile: './schemas/categories.json' },
    { name: 'orders', fieldsFile: './schemas/orders.json' },
    { name: 'orderitems', fieldsFile: './schemas/orderItems.json' },
    { name: 'locations', fieldsFile: './schemas/locations.json' },
    { name: 'clients', fieldsFile: './schemas/clients.json' },
    { name: 'eventsettings', fieldsFile: './schemas/eventSettings.json' },
    { name: 'printers', fieldsFile: './schemas/printers.json' },
    { name: 'printqueues', fieldsFile: './schemas/printQueues.json' },
    { name: 'pages', fieldsFile: './schemas/pages.json', formComponent: 'CroutonPagesForm', hierarchy: { enabled: true, parentField: 'parentId', orderField: 'order', pathField: 'path', depthField: 'depth' } }
  ],

  targets: [
    {
      layer: 'sales',
      collections: [
        'events', 'products', 'categories', 'orders',
        'orderitems', 'locations', 'clients', 'eventsettings',
        'printers', 'printqueues'
      ]
    },
    {
      layer: 'pages',
      collections: ['pages']
    }
  ],

  dialect: 'sqlite'
}
