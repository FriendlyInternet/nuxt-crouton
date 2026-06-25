export default {
  // No `locales` override → crouton's default English UI, so the shared e2e auth
  // helpers (which match English button labels like "Sign in" / "Create account")
  // work. fanfare runs this domain nl-only for product reasons; the fixture only
  // needs the sales/printing behaviour, which is locale-agnostic.

  // Feature flags - which crouton packages to enable.
  // Sales drives the full POS + printing domain (no pages collection here —
  // the fixture exercises sales/printing, not crouton-pages).
  features: {
    sales: { config: { print: { enabled: true } } }
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
    { name: 'printqueues', fieldsFile: './schemas/printQueues.json' }
  ],

  targets: [
    {
      layer: 'sales',
      collections: [
        'events', 'products', 'categories', 'orders',
        'orderitems', 'locations', 'clients', 'eventsettings',
        'printers', 'printqueues'
      ]
    }
  ],

  dialect: 'sqlite'
}