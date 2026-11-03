// #2309 — make this package's collections queryable by the public collection endpoints
// (crouton-pages' collection-binder pages) without the app generating a registry entry.
import { registerCollectionQueries } from '@fyit/crouton-core/shared/utils/query-registry'
import { bookingsQueryRegistry } from '../query-registry'

export default defineNitroPlugin(() => {
  registerCollectionQueries(bookingsQueryRegistry)
})
