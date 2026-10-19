/**
 * #2311 — the collection KEY a reference field points the UI at.
 *
 * The form picker, the list cell and the asset detector all turned a `refTarget` into a
 * collection key by prefixing the CURRENT layer, so `refTarget: "assets"` in a `main` layer
 * became `mainAssets` — a collection that does not exist. The key must use the TARGET's layer,
 * which the generator already knows (`collectionLayerMap`, now including package-owned targets).
 */
import { describe, it, expect } from 'vitest'
import { resolveRefCollectionKey } from '../../../lib/utils/ref-collection'

describe('resolveRefCollectionKey', () => {
  it('uses the target layer when the map knows it', () => {
    expect(resolveRefCollectionKey('assets', 'main', new Map([['assets', 'crouton']]))).toBe('croutonAssets')
    expect(resolveRefCollectionKey('contacts', 'projects', new Map([['contacts', 'people']]))).toBe('peopleContacts')
  })

  it('falls back to the current layer for an unknown target (same-layer sibling)', () => {
    expect(resolveRefCollectionKey('categories', 'shop', new Map())).toBe('shopCategories')
  })

  it('finds a target keyed by its configured (singular) name', () => {
    // apps configure `location`, schemas say `refTarget: "locations"` (see #1957)
    expect(resolveRefCollectionKey('locations', 'main', new Map([['location', 'bookings']]))).toBe('bookingsLocations')
  })

  it('camel-cases a layer with dashes or underscores', () => {
    expect(resolveRefCollectionKey('articles', 'blog', new Map([['articles', 'knowledge-base']]))).toBe('knowledgeBaseArticles')
    expect(resolveRefCollectionKey('articles', 'my_app', new Map())).toBe('myAppArticles')
  })
})
