export interface McpCollectionConfig {
  key: string
  name: string
  layer: string
  apiPath: string
  columns?: Array<{ accessorKey: string; header: string }>
  defaultValues?: Record<string, unknown>
  sortable?: { enabled: boolean; orderField: string }
}

/**
 * Get all registered Crouton collections from app config.
 * useAppConfig() is auto-imported by Nitro at runtime.
 */
export function getMcpCollections(): McpCollectionConfig[] {
  // useAppConfig is auto-imported by Nitro
  const appConfig = useAppConfig() as { croutonCollections?: Record<string, unknown> }
  const collections = appConfig.croutonCollections || {}

  return Object.entries(collections).map(([key, config]) => {
    const configObj = (typeof config === 'object' && config !== null ? config : {}) as Partial<McpCollectionConfig>
    return {
      key,
      ...configObj,
      name: configObj.name || key
    } as McpCollectionConfig
  })
}

/**
 * Find a specific collection by name (key or display name)
 */
export function getMcpCollectionByName(name: string): McpCollectionConfig | undefined {
  const collections = getMcpCollections()
  return collections.find(c => c.key === name || c.name === name)
}

/**
 * Build the API path for a collection endpoint
 */
export function getCollectionApiPath(collection: McpCollectionConfig, teamId: string): string {
  return `/api/teams/${teamId}/${collection.apiPath}`
}

/**
 * Map a McpCollectionConfig to the standard MCP-facing format
 * used by both the list-collections tool and collections-registry resource.
 */
export function mapCollectionToMcpFormat(c: McpCollectionConfig) {
  return {
    name: c.name,
    key: c.key,
    layer: c.layer,
    apiPath: c.apiPath,
    fields: c.columns?.map(col => ({
      key: col.accessorKey,
      label: col.header
    })) || [],
    defaultValues: c.defaultValues || {},
    sortable: c.sortable?.enabled || false
  }
}
