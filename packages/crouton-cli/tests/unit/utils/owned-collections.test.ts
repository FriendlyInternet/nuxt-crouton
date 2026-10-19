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
import assetsManifest from '../../../../crouton-assets/crouton.manifest'

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

// The real crouton-assets manifest against velo's pre-#2278 target: the media library
// lived in a generated `crouton` layer as `assets`.
describe('real crouton-assets manifest', () => {
  it('owns crouton/assets, and leaves an app\'s own assets in another layer alone', () => {
    expect(findCollectionOwner('crouton', 'assets', [assetsManifest as any])).toBe('@fyit/crouton-assets')
    expect(findCollectionOwner('media', 'assets', [assetsManifest as any])).toBeNull()
  })
})

/**
 * #2311 — a field may reference a collection a package owns.
 *
 * `refTarget: "assets"` must resolve to the owning package's layer (for the table name the
 * join uses: `croutonAssets`) and to the package's schema export (for the import the generated
 * queries file emits). Only packages the app actually EXTENDS count: an import to a package
 * the app does not have would fail at build, which is the opaque failure #1957 removed.
 */
import { ownedRefTargets, ownedRefTargetNames } from '../../../lib/utils/owned-collections'
import bookingsManifest from '../../../../crouton-bookings/crouton.manifest'
import pagesManifest from '../../../../crouton-pages/crouton.manifest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('ownedRefTargets', () => {
  it('maps an owned collection, by its plural directory name, to its layer and schema export', () => {
    const targets = ownedRefTargets(manifests, ['crouton-core', 'crouton-sales'])
    expect(targets.get('products')).toEqual({
      layer: 'sales',
      packageName: '@fyit/crouton-sales',
      importPath: '@fyit/crouton-sales/collections/products/server/database/schema',
    })
    // The manifest says `orderItem`; the directory (and so the refTarget) is `orderitems`.
    expect(targets.get('orderitems')?.importPath).toBe('@fyit/crouton-sales/collections/orderitems/server/database/schema')
  })

  it('ignores an owning package the app does not extend', () => {
    expect(ownedRefTargets(manifests, ['crouton-core']).size).toBe(0)
  })

  it('ignores a manifest that does not own its collections', () => {
    // `bookings` here is the not-yet-migrated shape: the app generates those itself.
    expect(ownedRefTargets(manifests, ['crouton-bookings']).has('bookings')).toBe(false)
  })

  it('ownedRefTargetNames accepts both the singular and the plural spelling', () => {
    const names = ownedRefTargetNames(ownedRefTargets(manifests, ['crouton-sales']))
    expect(names.has('product')).toBe(true)
    expect(names.has('products')).toBe(true)
    expect(names.has('orderitem')).toBe(true)
    expect(names.has('orderitems')).toBe(true)
  })

  it('drops a directory name two extended packages both ship — a bare refTarget is ambiguous', () => {
    const both = ownedRefTargets([salesManifest, bookingsManifest] as any[], ['crouton-sales', 'crouton-bookings'])
    expect(both.has('locations')).toBe(false)
    expect(both.get('products')?.layer).toBe('sales')
    expect(both.get('bookings')?.layer).toBe('bookings')
    // Extend only one of them and its locations are addressable again.
    expect(ownedRefTargets([salesManifest, bookingsManifest] as any[], ['crouton-bookings']).get('locations')?.layer).toBe('bookings')
  })

  it('resolves the assets collection to the crouton layer (its table is croutonAssets)', () => {
    const targets = ownedRefTargets([assetsManifest as any], ['crouton-assets'])
    expect(targets.get('assets')).toEqual({
      layer: 'crouton',
      packageName: '@fyit/crouton-assets',
      importPath: '@fyit/crouton-assets/collections/assets/server/database/schema',
    })
  })

  // Run the rule over the corpus: every import path it would emit for a shipping package
  // must point at a schema file that exists, or the generated app fails to build.
  it('every shipping package-owned collection has the schema file its import path names', () => {
    const shipping = [salesManifest, bookingsManifest, pagesManifest, assetsManifest] as any[]
    const targets = ownedRefTargets(shipping, shipping.map(m => m.id))
    // 11 sales + 5 bookings + 1 pages + 1 assets = 18, minus BOTH `locations` entries
    // (sales and bookings each ship one, so the bare name is ambiguous)
    expect(targets.size).toBe(16)
    for (const [, t] of targets) {
      const rel = t.importPath.replace(/^@fyit\//, '') + '.ts'
      expect(existsSync(resolve(__dirname, '../../../..', rel)), rel).toBe(true)
    }
  })
})
