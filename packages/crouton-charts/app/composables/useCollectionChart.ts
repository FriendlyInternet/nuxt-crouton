import { useDebounceFn } from '@vueuse/core'
import type { MaybeRef } from 'vue'

export interface ChartCategory {
  name: string
  color: string
}

export interface UseCollectionChartOptions {
  xField?: string
  yFields?: string[]
  limit?: number
  /** Direct API path override. Supports {teamId} placeholder. Bypasses collection registry. */
  apiPath?: string
  /** Extra query params merged into the fetch (e.g. { eventId } to scope an aggregation endpoint). */
  query?: Record<string, string | number>
}

export function useCollectionChart(
  collectionKey: MaybeRef<string>,
  options?: MaybeRef<UseCollectionChartOptions>
) {
  const { getConfig } = useCollections()
  const { teamId } = useTeamContext()
  // Theme-derived series colors (reactive to theme + dark mode); reads the
  // categories computed below so a theme change recolors the chart live.
  const { colorAt } = useChartPalette()

  const chartData = ref<Record<string, unknown>[]>([])
  const pending = ref(false)
  const error = ref<unknown>(null)
  const detectedYFields = ref<string[]>([])

  const resolvedCollection = computed(() => toValue(collectionKey))
  const resolvedOptions = computed(() => toValue(options) ?? {})

  const collectionConfig = computed(() => {
    // Skip collection lookup when apiPath is provided directly
    if (resolvedOptions.value.apiPath) return null
    const key = resolvedCollection.value
    if (!key) return null
    return getConfig(key)
  })

  const resolvedXField = computed(() => {
    if (resolvedOptions.value.xField) return resolvedOptions.value.xField
    // Fall back to display.title field from collection config
    return (collectionConfig.value as any)?.display?.title || 'id'
  })

  async function fetchAndTransform() {
    const collKey = resolvedCollection.value
    const directApiPath = resolvedOptions.value.apiPath

    // Need either a direct apiPath or a valid collection + config
    if (!directApiPath && (!collKey || !collectionConfig.value)) {
      chartData.value = []
      return
    }

    const config = collectionConfig.value as any
    const rawApiPath = directApiPath
      || config?.apiPath
      || `/api/teams/${toValue(teamId)}/${collKey}`
    // Interpolate {teamId} placeholder for preset-style paths
    const apiPath = rawApiPath.replace('{teamId}', String(toValue(teamId)))
    const limit = resolvedOptions.value.limit || 100

    pending.value = true
    error.value = null

    try {
      const response = await $fetch<{ items: Record<string, unknown>[] }>(apiPath, {
        query: { pageSize: limit, ...resolvedOptions.value.query }
      })

      const items = response?.items || []
      if (!items.length) {
        chartData.value = []
        detectedYFields.value = []
        return
      }

      // Auto-detect numeric fields from first row if yFields not provided
      const configuredYFields = resolvedOptions.value.yFields
      let activeYFields: string[]

      if (configuredYFields && configuredYFields.length > 0) {
        activeYFields = configuredYFields
      } else {
        const skipFields = ['id', 'teamId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']
        const firstRow = items[0] ?? {}
        activeYFields = Object.keys(firstRow).filter(key => {
          if (skipFields.includes(key)) return false
          if (key === resolvedXField.value) return false
          const val = firstRow[key]
          return typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val)) && val.trim() !== '')
        })
        detectedYFields.value = activeYFields
      }

      // Transform: map each row to { [xField]: value, ...yFields }
      const xField = resolvedXField.value
      chartData.value = items.map(row => {
        const point: Record<string, unknown> = {
          [xField]: row[xField]
        }
        for (const field of activeYFields) {
          const val = row[field]
          point[field] = typeof val === 'number' ? val : (val !== undefined && val !== null ? Number(val) : 0)
        }
        return point
      })
    } catch (err) {
      console.error('[useCollectionChart] Failed to fetch collection data:', err)
      error.value = err
      chartData.value = []
    } finally {
      pending.value = false
    }
  }

  const categories = computed<ChartCategory[]>(() => {
    const configuredYFields = resolvedOptions.value.yFields
    const fields = (configuredYFields && configuredYFields.length > 0)
      ? configuredYFields
      : detectedYFields.value

    return fields.map((field, index) => ({
      name: field,
      color: colorAt(index, fields.length)
    }))
  })

  const debouncedFetch = useDebounceFn(() => fetchAndTransform(), 300)

  watch(
    [resolvedCollection, resolvedOptions],
    () => debouncedFetch(),
    { immediate: true, deep: true }
  )

  function refresh() {
    return fetchAndTransform()
  }

  return {
    chartData,
    categories,
    pending,
    error,
    refresh,
    detectedYFields
  }
}
