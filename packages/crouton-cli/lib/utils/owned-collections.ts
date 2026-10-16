/**
 * Refuse to generate a collection a package owns (#2278).
 *
 * A package that ships a collection end to end (Drizzle schema, queries, routes,
 * list, form) declares `ownsCollections: true` in its manifest. Generating the
 * same collection into an app would fork it: a second table definition, a second
 * set of routes, and an app copy that drifts from the package.
 *
 * Identity is (layer, plural name), case-insensitive: `sales/products` is
 * crouton-sales' `salesProducts`, while `shop/products` is an unrelated app
 * collection and stays allowed.
 */
import pluralize from 'pluralize'

interface OwningManifest {
  id: string
  layer?: { name: string }
  ownsCollections?: boolean
  collections?: Array<{ name: string }>
}

interface TargetedConfig {
  targets?: Array<{ layer: string; collections: string[] }>
}

export interface OwnedCollectionConflict {
  layer: string
  collection: string
  packageName: string
}

export class OwnedCollectionError extends Error {
  constructor(public conflicts: OwnedCollectionConflict[]) {
    super(
      conflicts
        .map(c => `${c.layer}/${c.collection} is owned by ${c.packageName} — it ships the schema, routes and form. Remove it from crouton.config.js; extending ${c.packageName} is enough.`)
        .join('\n'),
    )
    this.name = 'OwnedCollectionError'
  }
}

const key = (name: string) => pluralize(name).toLowerCase()

/** The package (`@fyit/<id>`) that owns `layer/collection`, or null. */
export function findCollectionOwner(layer: string, collection: string, manifests: OwningManifest[]): string | null {
  for (const m of manifests) {
    if (!m.ownsCollections || m.layer?.name !== layer) continue
    if (m.collections?.some(c => key(c.name) === key(collection))) return `@fyit/${m.id}`
  }
  return null
}

/** Every targeted collection a package owns, in config order. */
export function findOwnedCollectionConflicts(config: TargetedConfig, manifests: OwningManifest[]): OwnedCollectionConflict[] {
  const conflicts: OwnedCollectionConflict[] = []
  for (const target of config.targets ?? []) {
    for (const collection of target.collections) {
      const packageName = findCollectionOwner(target.layer, collection, manifests)
      if (packageName) conflicts.push({ layer: target.layer, collection, packageName })
    }
  }
  return conflicts
}

export function assertNoOwnedCollections(config: TargetedConfig, manifests: OwningManifest[]): void {
  const conflicts = findOwnedCollectionConflicts(config, manifests)
  if (conflicts.length > 0) throw new OwnedCollectionError(conflicts)
}
