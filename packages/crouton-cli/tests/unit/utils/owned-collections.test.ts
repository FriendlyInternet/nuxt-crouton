/**
 * #2278 — the generator must REFUSE to generate a collection a package owns.
 *
 * A package that ships a collection end to end (Drizzle schema, queries, routes, form) declares
 * `ownsCollections: true` in its manifest. Generating the same collection into an app would
 * fork it: a second `salesProducts` table definition, a second set of routes, and an app copy
 * that drifts from the package (kassa's printers did exactly that — #2278).
 *
 * Identity is (layer, plural name): `sales/products` is crouton-sales' `salesProducts` table,
 * while `shop/products` is an unrelated app collection and must stay allowed.
 */
import { describe, it, expect } from 'vitest'
import {
  findCollectionOwner,
  findOwnedCollectionConflicts,
  assertNoOwnedCollections,
  OwnedCollectionError,
} from '../../../lib/utils/owned-collections'
import salesManifest from '../../../../crouton-sales/crouton.manifest'

const sales = {
  id: 'crouton-sales',
  layer: { name: 'sales' },
  ownsCollections: true,
  collections: [{ name: 'product' }, { name: 'orderItem' }, { name: 'category' }],
}
// A manifest that still lets the app generate its collections (not migrated yet).
const bookings = {
  id: 'crouton-bookings',
  layer: { name: 'bookings' },
  collections: [{ name: 'booking' }, { name: 'location' }],
}
const manifests = [sales, bookings]

describe('findCollectionOwner', () => {
  it('names the owning package for a collection in its layer', () => {
    expect(findCollectionOwner('sales', 'products', manifests)).toBe('@fyit/crouton-sales')
  })

  it('matches plural and case-insensitively (kassa writes `orderitems`, the manifest `orderItem`)', () => {
    expect(findCollectionOwner('sales', 'orderitems', manifests)).toBe('@fyit/crouton-sales')
    expect(findCollectionOwner('sales', 'Categories', manifests)).toBe('@fyit/crouton-sales')
  })

  it('allows the same name in another layer — a different table', () => {
    expect(findCollectionOwner('shop', 'products', manifests)).toBeNull()
  })

  it('allows collections of a manifest that does not own them', () => {
    expect(findCollectionOwner('bookings', 'bookings', manifests)).toBeNull()
  })

  it('allows an app collection the package does not declare', () => {
    expect(findCollectionOwner('sales', 'vouchers', manifests)).toBeNull()
  })
})

describe('assertNoOwnedCollections', () => {
  it('passes a config with no packaged collections', () => {
    const config = {
      collections: [{ name: 'pages' }],
      targets: [{ layer: 'pages', collections: ['pages'] }],
    }
    expect(findOwnedCollectionConflicts(config, manifests)).toEqual([])
    expect(() => assertNoOwnedCollections(config, manifests)).not.toThrow()
  })

  it('THROWS "owned by @fyit/crouton-sales" when kassa adds products back', () => {
    const config = {
      collections: [{ name: 'products' }, { name: 'pages' }],
      targets: [
        { layer: 'sales', collections: ['products'] },
        { layer: 'pages', collections: ['pages'] },
      ],
    }
    expect(() => assertNoOwnedCollections(config, manifests)).toThrow(OwnedCollectionError)
    expect(() => assertNoOwnedCollections(config, manifests)).toThrow(/sales\/products.*owned by @fyit\/crouton-sales/)
  })

  it('reports every conflict, not only the first', () => {
    const config = {
      targets: [{ layer: 'sales', collections: ['products', 'orderitems', 'vouchers'] }],
    }
    expect(findOwnedCollectionConflicts(config, manifests)).toEqual([
      { layer: 'sales', collection: 'products', packageName: '@fyit/crouton-sales' },
      { layer: 'sales', collection: 'orderitems', packageName: '@fyit/crouton-sales' },
    ])
  })
})

// Corpus check: the real crouton-sales manifest against kassa's pre-#2278 config.
describe('real crouton-sales manifest', () => {
  const kassaBefore = {
    targets: [{
      layer: 'sales',
      collections: ['events', 'products', 'categories', 'orders', 'orderitems',
        'locations', 'clients', 'eventsettings', 'printers', 'printqueues'],
    }, { layer: 'pages', collections: ['pages'] }],
  }

  it('owns every sales collection kassa used to generate (10 of 10), and not pages', () => {
    const conflicts = findOwnedCollectionConflicts(kassaBefore, [salesManifest as any])
    expect(conflicts.map(c => c.collection)).toEqual(kassaBefore.targets[0].collections)
    expect(conflicts.every(c => c.packageName === '@fyit/crouton-sales')).toBe(true)
  })
})
