// #2309 — the collections this package ships, under the key the generator would have
// written for each (`sales` + PascalCase directory). Registered process-wide by
// server/plugins/query-registry.ts so the pages package's public collection endpoints
// can serve them without the app generating anything. Kept in sync with collections/ by
// test/query-registry.test.ts.
import { collectionQueries, type QueryRegistry } from '@fyit/crouton-core/shared/utils/query-registry'

export const salesQueryRegistry: QueryRegistry = {
  salesCategories: collectionQueries(() => import('../collections/categories/server/database/queries'), 'SalesCategories'),
  salesClients: collectionQueries(() => import('../collections/clients/server/database/queries'), 'SalesClients'),
  salesEvents: collectionQueries(() => import('../collections/events/server/database/queries'), 'SalesEvents'),
  salesEventsettings: collectionQueries(() => import('../collections/eventsettings/server/database/queries'), 'SalesEventsettings'),
  salesKdsbumps: collectionQueries(() => import('../collections/kdsbumps/server/database/queries'), 'SalesKdsbumps'),
  salesLocations: collectionQueries(() => import('../collections/locations/server/database/queries'), 'SalesLocations'),
  salesOrderitems: collectionQueries(() => import('../collections/orderitems/server/database/queries'), 'SalesOrderitems'),
  salesOrders: collectionQueries(() => import('../collections/orders/server/database/queries'), 'SalesOrders'),
  salesPrinters: collectionQueries(() => import('../collections/printers/server/database/queries'), 'SalesPrinters'),
  salesPrintqueues: collectionQueries(() => import('../collections/printqueues/server/database/queries'), 'SalesPrintqueues'),
  salesProducts: collectionQueries(() => import('../collections/products/server/database/queries'), 'SalesProducts'),
}
