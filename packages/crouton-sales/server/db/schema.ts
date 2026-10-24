// Database schema exports for crouton-sales.
// NuxtHub scans `server/db/schema.ts` across extended layers to build the
// bundled drizzle schema, so re-exporting here makes the consuming app pick up
// `sales_sync_outbox` + `sales_sync_status` in `db:generate` migrations
// automatically — no manual schema import needed in the app (same pattern as
// crouton-flow/crouton-collab).
export { salesSyncOutbox, salesSyncStatus } from '../database/schema'

// The sales collection tables (#2278) — owned by this package, so an app's
// migrations pick them up from here, not from a generated app layer.
export { salesEvents } from '../../collections/events/server/database/schema'
export { salesProducts } from '../../collections/products/server/database/schema'
export { salesCategories } from '../../collections/categories/server/database/schema'
export { salesOrders } from '../../collections/orders/server/database/schema'
export { salesOrderitems } from '../../collections/orderitems/server/database/schema'
export { salesLocations } from '../../collections/locations/server/database/schema'
export { salesClients } from '../../collections/clients/server/database/schema'
export { salesEventsettings } from '../../collections/eventsettings/server/database/schema'
export { salesPrinters } from '../../collections/printers/server/database/schema'
export { salesPrintqueues } from '../../collections/printqueues/server/database/schema'
export { salesKdsbumps } from '../../collections/kdsbumps/server/database/schema'
