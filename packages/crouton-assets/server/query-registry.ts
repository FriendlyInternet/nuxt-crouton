// #2309 — the collections this package ships, under the key the generator would have
// written for each (`crouton` + PascalCase directory). Registered process-wide by
// server/plugins/query-registry.ts so the pages package's public collection endpoints
// can serve them without the app generating anything. Kept in sync with collections/ by
// test/query-registry.test.ts.
import { collectionQueries, type QueryRegistry } from '@fyit/crouton-core/shared/utils/query-registry'

export const assetsQueryRegistry: QueryRegistry = {
  croutonAssets: collectionQueries(() => import('../collections/assets/server/database/queries'), 'CroutonAssets'),
}
