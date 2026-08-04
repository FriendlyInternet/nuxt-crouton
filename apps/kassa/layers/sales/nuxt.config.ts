import { basename } from 'path'

const layerName = basename(__dirname)

export default defineNuxtConfig({
  components: {
    dirs: [
      {
        path: './components',
        prefix: layerName,
        global: true // Makes them available globally
      }
    ]
  },
  extends: [
    './collections/events',
    './collections/products',
    './collections/categories',
    './collections/orders',
    './collections/orderitems',
    './collections/locations',
    './collections/clients',
    './collections/eventsettings',
    './collections/printers',
    './collections/printqueues',
    './collections/kdsbumps'
  ]
})
