import type { CroutonPageType } from '@fyit/crouton-core/app/types/app'

/**
 * Aggregated page type with app context.
 */
export interface AggregatedPageType extends CroutonPageType {
  /** The app ID this page type belongs to */
  appId: string
  /** The app name for display */
  appName: string
  /** Full unique identifier: 'appId:pageTypeId' */
  fullId: string
}

/**
 * Composable for aggregating all page types from registered apps.
 *
 * Page types are pre-built page templates/components that apps provide.
 * Admins can create pages of these types in the page management UI.
 *
 * Also derives page types from publishable collections (collections with
 * `publishable: true` in their config). These use CroutonCollectionPageRenderer
 * as the component and link to the collection via the `collection` field.
 *
 * @example
 * ```typescript
 * const { pageTypes, getPageType } = usePageTypes()
 *
 * // Get all available page types
 * console.log(pageTypes.value)
 *
 * // Get a specific page type by full ID
 * const calendarType = getPageType('bookings:calendar')
 * ```
 */
export function usePageTypes() {
  const { appsList } = useCroutonApps()
  const collections = useCollections()
  const { t } = useT()

  /**
   * All page types from all registered apps, flattened into a single array.
   * Each page type is augmented with app context (appId, appName, fullId).
   * Also includes auto-derived page types from publishable collections.
   */
  const pageTypes = computed<AggregatedPageType[]>(() => {
    const types: AggregatedPageType[] = []

    // Aggregate page types from all apps
    for (const app of appsList.value) {
      if (!app.pageTypes) continue

      for (const pageType of app.pageTypes) {
        types.push({
          ...pageType,
          appId: app.id,
          appName: app.name,
          fullId: `${app.id}:${pageType.id}`
        })
      }
    }

    // Derive page types from publishable collections
    for (const [collectionName, config] of Object.entries(collections.configs)) {
      if (!config?.publishable) continue

      const layer = config.layer || 'app'
      const displayName = config.displayName || config.name || collectionName
      // Convert camelCase collection name to a readable, capitalized label
      // (e.g. "shopBikes" -> "Shop Bikes", "mainItems" -> "Main Items").
      const spaced = displayName.replace(/([A-Z])/g, ' $1').trim()
      const singularName = spaced.charAt(0).toUpperCase() + spaced.slice(1)
      const fullId = `${layer}:${collectionName}-detail`

      // Skip if a manually registered page type already exists with this ID
      if (types.some(existing => existing.fullId === fullId)) continue

      // A publishable collection may describe its derived page type via a
      // `pageType` config block (name/description/icon/category) — the same
      // shape packages register. Each is optional and falls back gracefully:
      // icon → the collection's admin icon → generic file; description → a
      // generic i18n key (kept as a RAW key so the consumer's t() resolves it,
      // matching how package-registered descriptions flow).
      const pageTypeMeta = (config.pageType ?? {}) as {
        name?: string
        description?: string
        icon?: string
        category?: string
      }

      types.push({
        id: `${collectionName}-detail`,
        name: pageTypeMeta.name || t('pages.pageTypes.collectionDerived.name', { name: singularName }),
        description: pageTypeMeta.description || 'pages.pageTypes.collectionDerived.description',
        component: 'CroutonPagesCollectionPageRenderer',
        icon: pageTypeMeta.icon || config.adminNav?.icon || 'i-lucide-file-text',
        category: pageTypeMeta.category || 'collections',
        collection: collectionName,
        appId: layer,
        appName: layer.charAt(0).toUpperCase() + layer.slice(1),
        fullId
      })
    }

    return types
  })

  /**
   * Get a page type by its full ID ('appId:pageTypeId').
   */
  function getPageType(fullId: string): AggregatedPageType | undefined {
    return pageTypes.value.find(t => t.fullId === fullId)
  }

  return {
    pageTypes,
    getPageType
  }
}
