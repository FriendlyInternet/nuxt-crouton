// #2309 — the collections this package exposes to crouton-pages' PUBLIC collection endpoints
// (`/api/public/[team]/<key>`, unauthenticated, cached), keyed as the generator would
// (`sales` + PascalCase directory). Registered process-wide by server/plugins/query-registry.ts.
//
// Deliberately NOT every collection: the queries are the admin ones and an admin can bind any
// registered key on a public page, so only what belongs on a public page is listed. The rest
// stay admin-only (they hold customer/staff data or internal configuration).
// test/query-registry.test.ts pins both lists.
import { collectionQueries, type QueryRegistry } from '@fyit/crouton-core/shared/utils/query-registry'

export const salesQueryRegistry: QueryRegistry = {
  salesProducts: collectionQueries(() => import('../collections/products/server/database/queries'), 'SalesProducts'),
  salesCategories: collectionQueries(() => import('../collections/categories/server/database/queries'), 'SalesCategories'),
  salesEvents: collectionQueries(() => import('../collections/events/server/database/queries'), 'SalesEvents'),
  salesLocations: collectionQueries(() => import('../collections/locations/server/database/queries'), 'SalesLocations'),
}
