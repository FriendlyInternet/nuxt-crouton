// #2309 — the collections this package ships, under the key the generator would have
// written for each (`pages` + PascalCase directory). Registered process-wide by
// server/plugins/query-registry.ts so the pages package's public collection endpoints
// can serve them without the app generating anything. Kept in sync with collections/ by
// test/query-registry.test.ts.
import { collectionQueries, type QueryRegistry } from '@fyit/crouton-core/shared/utils/query-registry'

export const pagesQueryRegistry: QueryRegistry = {
  pagesPages: collectionQueries(() => import('../collections/pages/server/database/queries'), 'PagesPages'),
}
