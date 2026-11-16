/**
 * Translated singular name of a collection for UI labels ("Lieu" for bookingsLocations).
 *
 * Packages name their collections in i18n next to the admin-nav title key: when
 * `croutonCollections.<name>.adminNav.label` is `<ns>.collections.<x>.title`, the
 * singular lives at `<ns>.collections.<x>.singular`. Without that key it falls back to
 * the English name derived from the collection id ("Location"), as before.
 */
export function useCollectionLabel() {
  const { t, hasTranslation } = useT()
  const appConfig = useAppConfig() as { croutonCollections?: Record<string, { adminNav?: { label?: string } }> }
  const { collectionWithCapitalSingular } = useFormatCollections()

  function singular(collection: string | null | undefined): string {
    if (!collection) return ''
    const navLabel = appConfig.croutonCollections?.[collection]?.adminNav?.label
    if (navLabel && navLabel.endsWith('.title')) {
      const key = navLabel.replace(/\.title$/, '.singular')
      if (hasTranslation(key)) return t(key)
    }
    return collectionWithCapitalSingular(collection)
  }

  return { singular }
}
