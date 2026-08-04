import { defineCroutonManifest, defineGeneratorContribution } from '@fyit/crouton-core/shared/manifest'
import eventsSchema from './schemas/events.json'
import productsSchema from './schemas/products.json'
import categoriesSchema from './schemas/categories.json'
import ordersSchema from './schemas/orders.json'
import orderItemsSchema from './schemas/orderItems.json'
import locationsSchema from './schemas/locations.json'
import clientsSchema from './schemas/clients.json'
import eventSettingsSchema from './schemas/eventSettings.json'
import printersSchema from './schemas/printers.json'
import printQueuesSchema from './schemas/printQueues.json'
import kdsBumpsSchema from './schemas/kdsBumps.json'

export default defineCroutonManifest({
  id: 'crouton-sales',
  name: 'Point of Sale',
  description: 'Event-based POS system for pop-up events, markets, and temporary retail. Includes products, categories, orders, and optional thermal receipt printing.',
  icon: 'i-lucide-shopping-cart',
  version: '1.0.0',
  category: 'miniapp',
  aiHint: 'use when app needs point of sale, product catalog, or order management',

  layer: {
    name: 'sales',
    editable: false,
    reason: 'Table names are prefixed with "sales" (e.g., salesProducts, salesOrders). This cannot be changed.'
  },

  dependencies: [
    '@fyit/crouton',
    '@fyit/crouton-auth'
  ],

  collections: [
    {
      name: 'event',
      tableName: 'salesEvents',
      description: 'Event records with dates, status, and helper PIN for volunteer login.',
      schema: eventsSchema,
      schemaPath: './schemas/events.json'
    },
    {
      name: 'product',
      tableName: 'salesProducts',
      description: 'Products with prices, options, and category assignments.',
      schema: productsSchema,
      schemaPath: './schemas/products.json'
    },
    {
      name: 'category',
      tableName: 'salesCategories',
      description: 'Product categories for organizing menu items.',
      schema: categoriesSchema,
      schemaPath: './schemas/categories.json'
    },
    {
      name: 'order',
      tableName: 'salesOrders',
      description: 'Customer orders with status tracking and optional client linkage.',
      schema: ordersSchema,
      schemaPath: './schemas/orders.json'
    },
    {
      name: 'orderItem',
      tableName: 'salesOrderitems',
      description: 'Line items within orders including quantity, price, and selected options.',
      schema: orderItemsSchema,
      schemaPath: './schemas/orderItems.json'
    },
    {
      name: 'location',
      tableName: 'salesLocations',
      description: 'Preparation locations/stations within an event.',
      schema: locationsSchema,
      schemaPath: './schemas/locations.json'
    },
    {
      name: 'client',
      tableName: 'salesClients',
      description: 'Customer records that can be reused across events.',
      schema: clientsSchema,
      schemaPath: './schemas/clients.json'
    },
    {
      name: 'eventSetting',
      tableName: 'salesEventsettings',
      description: 'Key-value settings per event for custom configuration.',
      schema: eventSettingsSchema,
      schemaPath: './schemas/eventSettings.json'
    },
    {
      name: 'printer',
      tableName: 'salesPrinters',
      description: 'Thermal receipt printers with IP address and port configuration.',
      schema: printersSchema,
      schemaPath: './schemas/printers.json',
      optional: true,
      condition: 'config.print.enabled'
    },
    {
      name: 'printQueue',
      tableName: 'salesPrintqueues',
      description: 'Print job queue with status tracking and retry handling.',
      schema: printQueuesSchema,
      schemaPath: './schemas/printQueues.json',
      optional: true,
      condition: 'config.print.enabled'
    },
    {
      name: 'kdsBump',
      tableName: 'salesKdsbumps',
      description: 'Kitchen-display bump records — one per (order × location) cleared off a screen, so kitchen and bar screens bump the same order independently.',
      schema: kdsBumpsSchema,
      schemaPath: './schemas/kdsBumps.json'
    }
  ],

  configuration: {
    'print.enabled': {
      type: 'boolean',
      label: 'Enable Thermal Printing',
      description: 'Enable receipt printing to thermal printers. Requires network-connected printers.',
      default: false
    }
  },

  extensionPoints: [
    {
      collection: 'product',
      allowedFields: ['customData', 'metadata'],
      description: 'Add custom fields to products for additional attributes.'
    },
    {
      collection: 'order',
      allowedFields: ['customData', 'metadata'],
      description: 'Add custom fields to orders for additional tracking data.'
    },
    {
      collection: 'event',
      allowedFields: ['customData', 'metadata'],
      description: 'Add custom fields to events for venue-specific information.'
    }
  ],

  provides: {
    composables: [
      'usePosOrder',
      'useHelperAuth'
    ],
    components: [
      { name: 'SalesClientOrderInterface', description: 'Main customer-facing order page', props: ['eventId', 'teamId'] },
      { name: 'SalesClientCart', description: 'Shopping cart with quantity controls', props: ['modelValue'] },
      { name: 'SalesClientProductList', description: 'Product grid with inline options', props: ['products', 'categories'] },
      { name: 'SalesClientCategoryTabs', description: 'Category navigation tabs', props: ['categories', 'modelValue'] },
      { name: 'SalesClientProductOptionsSelect', description: 'Product variant/option selection', props: ['product', 'modelValue'] },
      { name: 'SalesClientCartTotal', description: 'Order total with item count', props: ['total', 'itemCount'] },
      { name: 'SalesClientSelector', description: 'Client selector with create-on-type', props: ['clients', 'modelValue'] },
      { name: 'SalesClientOfflineBanner', description: 'Offline mode indicator', props: [] },
      { name: 'SalesPosOrdersList', description: 'Orders table with status filtering', props: ['eventId', 'filters'] },
      { name: 'SalesAdminPosSidebar', description: 'Admin navigation sidebar', props: [] },
      { name: 'SalesSettingsReceiptSettingsModal', description: 'Receipt text customization modal', props: ['modelValue'] },
      { name: 'SalesSettingsPrintPreviewModal', description: 'Receipt preview with test print', props: ['modelValue', 'order'] }
    ],
    apiRoutes: [
      '/api/crouton-sales/events/[eventId]/orders',
      '/api/crouton-sales/events/[eventId]/products',
      '/api/crouton-sales/events/[eventId]/availability',
      '/api/crouton-sales/events/[eventId]/helper-auth'
    ]
  }
})

// The package ships bespoke forms for these collections. Declaring them here wires
// the composable's componentName + skips the generic generated _Form.vue for ANY
// consuming app — no per-app `formComponent` config needed, and it survives regen.
// The CLI calls getFormComponent during generation (see generate-collection.ts).
export const generatorContribution = defineGeneratorContribution({
  getFormComponent({ collectionName }) {
    const forms: Record<string, string> = {
      product: 'SalesProductForm', products: 'SalesProductForm',
      category: 'SalesCategoryForm', categories: 'SalesCategoryForm',
      printer: 'SalesPrinterForm', printers: 'SalesPrinterForm',
      location: 'SalesLocationForm', locations: 'SalesLocationForm'
    }
    return forms[collectionName] ?? null
  }
})
