/**
 * Composable for fetching and managing Notion database schema
 *
 * Handles fetching database schema from Notion API and managing the result state.
 * Used for auto-generating field mappings and property type detection.
 *
 * @example
 * ```ts
 * const { fetchNotionSchema, schema, loading, error } = useTriageNotionSchema()
 *
 * await fetchNotionSchema({
 *   databaseId: 'abc123',
 *   notionToken: 'secret_xyz'
 * })
 *
 * if (schema.value) {
 *   console.log('Properties:', schema.value.properties)
 *   console.log('Database title:', schema.value.databaseTitle)
 * }
 * ```
 */

export interface NotionProperty {
  name: string
  type: string
  options?: Array<{ name: string; color?: string }>
}

export interface NotionSchema {
  databaseTitle: string
  properties: Record<string, NotionProperty>
}

export interface FetchSchemaOptions {
  databaseId: string
  notionToken?: string
  teamId: string
  /** Connected account ID (alternative to notionToken) */
  accountId?: string
}

export function useTriageNotionSchema() {
  const fetchParams = ref<FetchSchemaOptions | null>(null)

  const { data: schema, status, error: fetchError, execute, clear } = useAsyncData<NotionSchema | null>(
    `triage-notion-schema-${useId()}`,
    async () => {
      const opts = fetchParams.value
      if (!opts?.databaseId || (!opts.notionToken && !opts.accountId) || !opts.teamId) {
        throw new Error('Please provide Notion Database ID, a token or connected account, and Team ID')
      }

      const queryParams: Record<string, string> = {}
      if (opts.accountId) queryParams.accountId = opts.accountId
      else if (opts.notionToken) queryParams.notionToken = opts.notionToken

      const response = await $fetch<any>(
        `/api/crouton-triage/teams/${opts.teamId}/notion/schema/${opts.databaseId}`,
        { query: queryParams },
      )

      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch schema')
      }

      return response as NotionSchema
    },
    { immediate: false },
  )

  const loading = computed(() => status.value === 'pending')
  const error = computed(() => {
    if (!fetchError.value) return null
    const err = fetchError.value as any
    return err.data?.statusMessage || err.message || 'Failed to fetch schema'
  })

  /**
   * Fetch Notion database schema
   */
  async function fetchNotionSchema(options: FetchSchemaOptions): Promise<NotionSchema | null> {
    fetchParams.value = options
    await execute()
    return schema.value ?? null
  }

  /**
   * Clear schema and error state
   */
  function clearSchema() {
    clear()
    fetchParams.value = null
  }

  return {
    /** Fetch Notion database schema */
    fetchNotionSchema,
    /** Clear schema state */
    clearSchema,
    /** Fetched schema result */
    schema,
    /** Whether schema is currently being fetched */
    loading,
    /** Error message if schema fetch failed */
    error,
  }
}
