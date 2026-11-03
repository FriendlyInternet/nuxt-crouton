import { ref } from 'vue'
import type { Ref } from 'vue'

/**
 * Field definition for import column mapping
 */
export interface ImportField {
  key: string
  label: string
  required: boolean
  type: string
}

/**
 * Column-to-field mapping
 */
export interface ImportColumnMapping {
  csvColumn: string
  fieldKey: string | null
}

/**
 * Row validation result
 */
export interface ImportRowValidation {
  rowIndex: number
  valid: boolean
  errors: Record<string, string>
  data: Record<string, any>
}

/**
 * Preview result after parsing and mapping
 */
export interface ImportPreviewResult {
  rows: Record<string, any>[]
  csvColumns: string[]
  mappings: ImportColumnMapping[]
  validationResults: ImportRowValidation[]
  validCount: number
  invalidCount: number
}

/**
 * Final import result
 */
export interface ImportResult {
  success: boolean
  created: number
  failed: number
  errors: { rowIndex: number; error: string }[]
}

/**
 * Return type for useCollectionImport
 */
export interface UseCollectionImportReturn {
  /** Parse a CSV or JSON file */
  parseFile: (file: File) => Promise<{ rows: Record<string, any>[]; columns: string[] }>
  /** Get importable fields for the collection */
  getCollectionFields: () => ImportField[]
  /** Auto-map CSV columns to collection fields */
  autoMapColumns: (csvColumns: string[], fields: ImportField[]) => ImportColumnMapping[]
  /** Validate rows against mapped fields */
  validateRows: (rows: Record<string, any>[], mappings: ImportColumnMapping[], fields: ImportField[]) => ImportRowValidation[]
  /** Execute the import (POST rows in batches) */
  executeImport: (validRows: Record<string, any>[]) => Promise<ImportResult>
  /** Whether an import is in progress */
  isImporting: Ref<boolean>
  /** Import progress (0-100) */
  progress: Ref<number>
}

const BATCH_SIZE = 20

/**
 * Normalize a string to camelCase for column matching.
 * Handles "Source Type", "source_type", "source-type" → "sourceType"
 */
function toCamelCase(str: string): string {
  return str
    .trim()
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, c => c.toLowerCase())
}

/**
 * Collection import composable
 *
 * Provides CSV and JSON import capabilities for collection data.
 * Mirrors the export composable pattern. Parses files client-side,
 * auto-maps columns, validates rows, and POSTs in batches to the
 * existing collection endpoint.
 *
 * @example
 * ```typescript
 * const { parseFile, autoMapColumns, validateRows, executeImport } = useCollectionImport('bookings')
 *
 * // 1. Parse the file
 * const { rows, columns } = await parseFile(file)
 *
 * // 2. Get fields and auto-map
 * const fields = getCollectionFields()
 * const mappings = autoMapColumns(columns, fields)
 *
 * // 3. Validate
 * const results = validateRows(rows, mappings, fields)
 *
 * // 4. Import valid rows
 * const validRows = results.filter(r => r.valid).map(r => r.data)
 * const result = await executeImport(validRows)
 * ```
 */
export function useCollectionImport(collection: string): UseCollectionImportReturn {
  const isImporting = ref(false)
  const progress = ref(0)
  const route = useRoute()
  const notify = useNotify()
  const { t } = useT()
  const collections = useCollections()
  const { getTeamId } = useTeamContext()

  const config = collections.getConfig(collection)
  const apiPath = config?.apiPath || collection

  /**
   * Get the API base path (same pattern as useCollectionMutation)
   */
  function getApiBasePath(): string {
    if (route.path.includes('/super-admin/')) {
      return `/api/super-admin/${apiPath}`
    }

    const teamId = getTeamId()
    if (!teamId) {
      throw new Error('Team context not available')
    }

    return `/api/teams/${teamId}/${apiPath}`
  }

  /**
   * Parse a CSV or JSON file into rows
   */
  async function parseFile(file: File): Promise<{ rows: Record<string, any>[]; columns: string[] }> {
    const extension = file.name.split('.').pop()?.toLowerCase()

    if (extension === 'json') {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { rows, columns }
    }

    if (!import.meta.client) {
      throw new Error('parseFile is client-only')
    }
    // Default: CSV — guarded by import.meta.client so Nuxt strips this branch
    // (and the papaparse dynamic import) from the SSR/Nitro bundle
    const { default: Papa } = await import('papaparse')
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        complete: (results) => {
          const columns = results.meta.fields || []
          resolve({ rows: results.data as Record<string, any>[], columns })
        },
        error: (error: Error) => {
          reject(error)
        }
      })
    })
  }

  /**
   * Extract importable fields from the collection config.
   * Falls back to basic key list if no schema info is available.
   */
  function getCollectionFields(): ImportField[] {
    if (!config) return []

    // Check if collection config has a schema definition
    const schema = (config as any).schema
    if (schema && typeof schema === 'object' && schema.shape) {
      return Object.entries(schema.shape).map(([key, zodField]: [string, any]) => ({
        key,
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim(),
        required: !zodField?.isOptional?.(),
        type: zodField?._def?.typeName || 'string'
      }))
    }

    // Fallback: use fields from config if available
    const fields = (config as any).fields
    if (Array.isArray(fields)) {
      return fields.map((f: any) => ({
        key: typeof f === 'string' ? f : f.key,
        label: typeof f === 'string'
          ? f.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()
          : (f.label || f.key),
        required: typeof f === 'object' ? !!f.required : false,
        type: typeof f === 'object' ? (f.type || 'string') : 'string'
      }))
    }

    return []
  }

  /**
   * Auto-map CSV column headers to collection fields by normalizing to camelCase
   */
  function autoMapColumns(csvColumns: string[], fields: ImportField[]): ImportColumnMapping[] {
    const fieldIndex = new Map<string, string>()
    for (const field of fields) {
      fieldIndex.set(toCamelCase(field.key), field.key)
      fieldIndex.set(field.key.toLowerCase(), field.key)
    }

    return csvColumns.map((col) => {
      const normalized = toCamelCase(col)
      const match = fieldIndex.get(normalized) || fieldIndex.get(col.toLowerCase()) || null
      return { csvColumn: col, fieldKey: match }
    })
  }

  /**
   * Validate rows using the current mappings.
   * Maps CSV columns to field keys and checks for required fields.
   */
  function validateRows(
    rows: Record<string, any>[],
    mappings: ImportColumnMapping[],
    fields: ImportField[]
  ): ImportRowValidation[] {
    const requiredFields = new Set(fields.filter(f => f.required).map(f => f.key))

    return rows.map((row, rowIndex) => {
      const mappedData: Record<string, any> = {}
      const errors: Record<string, string> = {}

      // Map columns to field keys
      for (const mapping of mappings) {
        if (mapping.fieldKey) {
          const value = row[mapping.csvColumn]
          if (value !== null && value !== undefined && value !== '') {
            mappedData[mapping.fieldKey] = value
          }
        }
      }

      // Check required fields
      for (const reqField of requiredFields) {
        if (mappedData[reqField] === undefined || mappedData[reqField] === null || mappedData[reqField] === '') {
          errors[reqField] = t('import.requiredFieldMissing')
        }
      }

      return {
        rowIndex,
        valid: Object.keys(errors).length === 0,
        errors,
        data: mappedData
      }
    })
  }

  /**
   * Execute the import by POSTing rows in batches to the collection endpoint
   */
  async function executeImport(validRows: Record<string, any>[]): Promise<ImportResult> {
    isImporting.value = true
    progress.value = 0

    const result: ImportResult = {
      success: true,
      created: 0,
      failed: 0,
      errors: []
    }

    try {
      const baseUrl = getApiBasePath()
      const totalRows = validRows.length

      // Process in batches
      for (let i = 0; i < totalRows; i += BATCH_SIZE) {
        const batch = validRows.slice(i, i + BATCH_SIZE)

        const batchResults = await Promise.allSettled(
          batch.map((row, batchIndex) =>
            $fetch(baseUrl, {
              method: 'POST',
              body: row,
              credentials: 'include'
            }).then(() => ({ rowIndex: i + batchIndex }))
          )
        )

        for (const batchResult of batchResults) {
          if (batchResult.status === 'fulfilled') {
            result.created++
          } else {
            result.failed++
            result.errors.push({
              rowIndex: i,
              error: batchResult.reason?.data?.message || batchResult.reason?.message || t('mutations.creationFailed')
            })
          }
        }

        progress.value = Math.round(((i + batch.length) / totalRows) * 100)
      }

      // Invalidate collection cache (same pattern as useCollectionMutation)
      const nuxtApp = useNuxtApp()
      const prefix = `collection:${collection}:`
      const allKeys = Object.keys(nuxtApp.payload.data)
      const matchingKeys = allKeys.filter(key => key.startsWith(prefix))
      await Promise.all(matchingKeys.map(key => refreshNuxtData(key)))

      result.success = result.failed === 0

      if (result.failed > 0) {
        notify.warning(t('import.complete'), { description: t('import.completeWithErrors', { created: result.created, failed: result.failed }) })
      } else {
        notify.success(t('import.complete'), { description: t('import.completeSuccess', { created: result.created }) })
      }

      return result
    } catch (error: any) {
      notify.error(t('import.failed'), { description: error.message || t('import.unexpected') })
      throw error
    } finally {
      isImporting.value = false
      progress.value = 0
    }
  }

  return {
    parseFile,
    getCollectionFields,
    autoMapColumns,
    validateRows,
    executeImport,
    isImporting,
    progress
  }
}
