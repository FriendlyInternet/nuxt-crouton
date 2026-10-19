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

/**
 * A `refTarget` that names a collection a package owns (#2311).
 *
 * Keyed by the plural directory name (`assets`, `orderitems`) — the spelling a schema's
 * `refTarget` uses. Only packages the app EXTENDS count: the generated queries file imports
 * the table from the package, and an import to a package the app does not have fails at
 * build time, which is exactly the opaque failure #1957 removed.
 */
export interface OwnedRefTarget {
  layer: string
  packageName: string
  /** The package's schema export, e.g. `@fyit/crouton-assets/collections/assets/server/database/schema`. */
  importPath: string
}

export function ownedRefTargets(manifests: OwningManifest[], extendedPackageIds: Iterable<string>): Map<string, OwnedRefTarget> {
  const extended = new Set(extendedPackageIds)
  const targets = new Map<string, OwnedRefTarget>()
  const ambiguous = new Set<string>()
  for (const m of manifests) {
    if (!m.ownsCollections || !m.layer?.name || !extended.has(m.id)) continue
    for (const c of m.collections ?? []) {
      const dir = key(c.name)
      // Two extended packages shipping the same directory name (sales AND bookings both have
      // `locations`): a bare `refTarget: "locations"` can't say which, so neither registers and
      // the usual refusal fires. A layer-qualified refTarget is not supported (yet).
      if (targets.has(dir)) { ambiguous.add(dir); continue }
      targets.set(dir, {
        layer: m.layer.name,
        packageName: `@fyit/${m.id}`,
        importPath: `@fyit/${m.id}/collections/${dir}/server/database/schema`,
      })
    }
  }
  for (const dir of ambiguous) targets.delete(dir)
  return targets
}

/** Both spellings a schema may use for an owned target (`asset` / `assets`), lowercased. */
export function ownedRefTargetNames(targets: Map<string, OwnedRefTarget>): Set<string> {
  const names = new Set<string>()
  for (const dir of targets.keys()) {
    names.add(dir)
    names.add(pluralize.singular(dir).toLowerCase())
  }
  return names
}
