// #2309 — the collections this package ships, under the key the generator would have
// written for each (`bookings` + PascalCase directory). Registered process-wide by
// server/plugins/query-registry.ts so the pages package's public collection endpoints
// can serve them without the app generating anything. Kept in sync with collections/ by
// test/query-registry.test.ts.
import { collectionQueries, type QueryRegistry } from '@fyit/crouton-core/shared/utils/query-registry'

export const bookingsQueryRegistry: QueryRegistry = {
  bookingsBookings: collectionQueries(() => import('../collections/bookings/server/database/queries'), 'BookingsBookings'),
  bookingsEmaillogs: collectionQueries(() => import('../collections/emaillogs/server/database/queries'), 'BookingsEmaillogs'),
  bookingsEmailtemplates: collectionQueries(() => import('../collections/emailtemplates/server/database/queries'), 'BookingsEmailtemplates'),
  bookingsLocations: collectionQueries(() => import('../collections/locations/server/database/queries'), 'BookingsLocations'),
  bookingsSettings: collectionQueries(() => import('../collections/settings/server/database/queries'), 'BookingsSettings'),
}
