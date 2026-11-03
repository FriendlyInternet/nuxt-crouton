/**
 * The collection KEY a reference field points the UI at (#2311).
 *
 * A `refTarget` names a collection directory (`assets`, `locations`); the UI components
 * (`CroutonFormReferenceSelect`, `CroutonItemCardMini`, `CroutonAssetsPicker`) take the
 * registered collection key (`croutonAssets`, `bookingsLocations`). The key is the TARGET's
 * layer + PascalCase plural. Three generators used to build it from the CURRENT layer, which
 * only holds for a same-layer sibling: a cross-layer ref or a package-owned collection
 * (`refTarget: "assets"` from a `main` layer) produced a key no collection registers under.
 *
 * `collectionLayerMap` is what the generator already holds for the queries import — the app's
 * configured collections (keyed as written, often singular) plus the package-owned targets
 * (keyed by plural directory). Unknown target → current layer, the historical behaviour.
 */
import { toCase, toLayerCamelCase } from './helpers.ts'

export { toLayerCamelCase }

export function resolveRefCollectionKey(
  refTarget: string,
  currentLayer: string,
  collectionLayerMap?: Map<string, string> | null,
): string {
  const cases = toCase(refTarget)
  const layer = collectionLayerMap?.get(refTarget.toLowerCase())
    ?? collectionLayerMap?.get(cases.plural)
    ?? collectionLayerMap?.get(cases.singular)
    ?? currentLayer
  return `${toLayerCamelCase(layer)}${cases.pascalCasePlural}`
}
