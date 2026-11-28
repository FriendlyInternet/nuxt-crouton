/**
 * The page types `create_page` accepts (#4193) — a plain function of app config,
 * so it is testable without Nitro.
 */
type AppEntry = { id: string, pageTypes?: Array<{ id: string }> } | undefined
type CollectionEntry = { publishable?: boolean, layer?: string } | undefined

export interface PageTypeAppConfig {
  croutonApps?: Record<string, AppEntry>
  croutonCollections?: Record<string, CollectionEntry>
}

/** `appId:typeId` for each of one app's page types. */
function appPageTypes(app: AppEntry): string[] {
  return (app?.pageTypes ?? []).map(pt => `${app!.id}:${pt.id}`)
}

/** `layer:collection-detail` for a publishable collection, else nothing. */
function collectionPageType([name, cfg]: [string, CollectionEntry]): string[] {
  return cfg?.publishable ? [`${cfg.layer || 'app'}:${name}-detail`] : []
}

/**
 * The registered page type ids, built the way the admin's picker builds them
 * (crouton-pages `usePageTypes`): `appId:typeId` for every app's pageTypes, plus
 * `layer:collection-detail` for every publishable collection.
 */
export function registeredPageTypes(config: PageTypeAppConfig): string[] {
  const fromApps = Object.values(config.croutonApps ?? {}).flatMap(appPageTypes)
  const fromCollections = Object.entries(config.croutonCollections ?? {}).flatMap(collectionPageType)
  return [...new Set([...fromApps, ...fromCollections])]
}
