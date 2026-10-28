/**
 * Form/detail resolution by canonical name.
 *
 * A collection key is already `<layer><Plural>` in camelCase (e.g. `bookingsLocations`),
 * so the form is `<Key>Form` and the detail `<Key>Detail` once the first letter is
 * upper-cased — the same casing the CLI uses for generated component names.
 * An app overrides a package form simply by providing a component with that name.
 */

export type FormResolution =
  | { kind: 'delete' }
  | { kind: 'component', name: string, generic?: boolean }
  | { kind: 'none' }

const pascal = (key: string) => key.charAt(0).toUpperCase() + key.slice(1)

export const canonicalFormName = (collection: string) => `${pascal(collection)}Form`
export const canonicalDetailName = (collection: string) => `${pascal(collection)}Detail`

/**
 * Explicit fallback chain. `isRegistered` reports whether a component name exists.
 *  view   → Lazy<Name>Detail → CroutonDetail → Lazy<Name>Form
 *  other  → Lazy<Name>Form
 *  none   → { kind: 'none' }
 */
export function resolveFormChain(
  collection: string | undefined,
  action: string | undefined,
  isRegistered: (name: string) => boolean
): FormResolution {
  if (!collection) return { kind: 'none' }
  if (action === 'delete') return { kind: 'delete' }

  if (action === 'view') {
    const detail = `Lazy${canonicalDetailName(collection)}`
    if (isRegistered(detail)) return { kind: 'component', name: detail }
    if (isRegistered('CroutonDetail')) return { kind: 'component', name: 'CroutonDetail', generic: true }
  }

  const form = `Lazy${canonicalFormName(collection)}`
  if (isRegistered(form)) return { kind: 'component', name: form }
  return { kind: 'none' }
}
