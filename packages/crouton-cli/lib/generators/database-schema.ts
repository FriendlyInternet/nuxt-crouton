// Generator for Drizzle schema
import { SYSTEM_FIELD_GROUPS, metadataFields as systemMetadataFields, hierarchyFields as systemHierarchyFields } from '../utils/system-fields.ts'
import { toSnakeCase, toLayerCamelCase } from '../utils/helpers.ts'

// SQLite only — the pg dialect was removed (#2735); callers reject anything else up front.
export function generateSchema(data: Record<string, any>, _dialect: string, config: Record<string, any> | null = null): string {
  const { plural, layer, layerPascalCase, singular, hierarchy, pascalCasePlural } = data

  // Get original collection name from data (before toCase processing)
  // For system collections, we need to preserve the original camelCase
  const originalCollectionName = data.originalCollectionName || plural
  // Use layer-prefixed name for the export to avoid conflicts
  // Convert layer to camelCase to ensure valid JavaScript identifier
  const layerCamelCase = toLayerCamelCase(layer)
  // Use pascalCasePlural which properly handles hyphens (e.g., email-templates -> EmailTemplates)
  const exportName = `${layerCamelCase}${pascalCasePlural}`

  // Check if this collection needs translations
  const needsTranslations = config?.translations?.collections?.[plural] || config?.translations?.collections?.[singular]
  const translatableFields = needsTranslations || []

  // Build translations field if needed
  let translationsField = ''
  let translationsImport = ''
  let translationsComment = ''

  if (needsTranslations) {
    // Build TypeScript type for translations
    const typeFields = translatableFields.map(f => `      ${f}?: string`).join('\n')
    translationsField = `  // Note: No indexes on translations - measure performance first\n  // Add indexes only if queries exceed 50ms with real data\n  translations: jsonColumn('translations').$type<{\n    [locale: string]: {\n${typeFields}\n    }\n  }>()`

    translationsComment = `\n// Note: This collection has translatable fields: ${translatableFields.join(', ')}\n// Translations are stored in a JSON field without indexes for performance baseline`
  }

  // Reserved (auto-generated) column names — one list, system-fields.ts
  const TEAM_FIELDS = SYSTEM_FIELD_GROUPS.team

  // Hierarchy fields (use custom names from config or defaults)
  const HIERARCHY_FIELDS = systemHierarchyFields(hierarchy)

  // Sortable field (only when not using hierarchy, since hierarchy already includes order).
  // data.sortable may be a boolean (`true`) or the object `{ enabled }` depending on caller —
  // read both. Previously this checked the object's truthiness, so a non-sortable collection
  // (`{ enabled: false }`) still got a spurious `order` column.
  const sortable = data.sortable === true || data.sortable?.enabled === true
  const SORTABLE_FIELDS = (sortable && !hierarchy?.enabled) ? ['order'] : []

  // Conditional field generation based on config flags
  // Team fields are always required (all generated endpoints use @crouton/auth)
  // Build list of reserved fields to filter out based on config
  const reservedFields = [
    ...SYSTEM_FIELD_GROUPS.id,
    ...systemMetadataFields(),
    ...TEAM_FIELDS, // Always included - required for @crouton/auth
    ...HIERARCHY_FIELDS,
    ...SORTABLE_FIELDS
  ]

  // Collect fields with unique constraint for composite team-scoped indexes
  const uniqueFields: string[] = data.fields
    .filter(field => !reservedFields.includes(field.name) && field.meta?.unique)
    .map(field => field.name)

  const schemaFields = data.fields
    .filter(field => !reservedFields.includes(field.name))
    .map((field) => {
      const nullable = field.meta?.required ? '.notNull()' : ''

      // Check if this is a dependent field (should be stored as JSON array)
      const isDependentField = field.meta?.dependsOn || field.meta?.displayAs === 'slotButtonGroup'

      if (field.type === 'boolean') {
        const boolDefault = field.meta?.default === true ? 'true' : 'false'
        return `  ${field.name}: integer('${field.name}', { mode: 'boolean' })${nullable}.$default(() => ${boolDefault})`
      } else if (field.type === 'number' || field.type === 'decimal') {
        return `  ${field.name}: ${field.type === 'decimal' ? 'real' : 'integer'}('${field.name}')${nullable}`
      } else if (field.type === 'date') {
        return `  ${field.name}: integer('${field.name}', { mode: 'timestamp' })${nullable}.$default(() => new Date())`
      } else if (field.type === 'json' || field.type === 'repeater' || field.type === 'array' || isDependentField) {
      // Use [] for arrays/repeaters/dependent fields, {} for json objects
        const defaultValue = (field.type === 'array' || field.type === 'repeater' || isDependentField) ? 'null' : '{}'
        // Use customType to handle NULL values gracefully in LEFT JOINs
        return `  ${field.name}: jsonColumn('${field.name}')${nullable}.$default(() => (${defaultValue}))`
      } else {
        return `  ${field.name}: text('${field.name}')${nullable}`
      }
    }).join(',\n')

  const imports = `import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, real, customType${uniqueFields.length > 0 ? ', uniqueIndex' : ''} } from 'drizzle-orm/sqlite-core'

// Custom JSON column that handles NULL values gracefully during LEFT JOINs
const jsonColumn = customType<any>({
  dataType() {
    return 'text'
  },
  fromDriver(value: unknown): any {
    if (value === null || value === undefined || value === '') {
      return null
    }
    try {
      return JSON.parse(value as string)
    } catch {
      return null
    }
  },
  toDriver(value: any): string {
    return JSON.stringify(value)
  },
})`

  const tableFn = 'sqliteTable'

  const idField = `  id: text('id').primaryKey().$default(() => nanoid())`

  // Convert table name to snake_case for database
  // For system collections (layer starts with 'crouton-'), use simplified naming
  let snakeCaseTableName
  if (layer.startsWith('crouton-')) {
    // System collection: use crouton_<collection_name> format
    // e.g., crouton-events + collectionEvents -> crouton_collection_events
    // Use original collection name to preserve camelCase for proper snake_case conversion
    const collectionWithCapital = originalCollectionName.charAt(0).toUpperCase() + originalCollectionName.slice(1)
    snakeCaseTableName = toSnakeCase(`crouton${collectionWithCapital}`)
  } else {
    // Regular collection: use layer_collection format
    snakeCaseTableName = toSnakeCase(`${layer}_${plural}`)
  }

  // Team fields are always included (required for @crouton/auth)
  const teamFields = `
  teamId: text('teamId').notNull(),
  owner: text('owner').notNull()`

  // Build hierarchy fields conditionally (parentId, path, depth, order)
  let hierarchyFields = ''
  if (hierarchy?.enabled) {
    const parentField = hierarchy.parentField || 'parentId'
    const pathField = hierarchy.pathField || 'path'
    const depthField = hierarchy.depthField || 'depth'
    const orderField = hierarchy.orderField || 'order'

    hierarchyFields = `
  // Hierarchy fields for tree structure
  ${parentField}: text('${parentField}'),
  ${pathField}: text('${pathField}').notNull().$default(() => '/'),
  ${depthField}: integer('${depthField}').notNull().$default(() => 0),
  ${orderField}: integer('${orderField}').notNull().$default(() => 0)`
  }

  // Build sortable field conditionally (only when sortable is true and hierarchy is not enabled)
  let sortableFields = ''
  if (sortable && !hierarchy?.enabled) {
    sortableFields = `
  order: integer('order').notNull().$default(() => 0)`
  }

  const metadataFields = `
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()`

  // Build the complete field list with proper comma handling
  const allFields = [
    idField,
    teamFields,
    hierarchyFields,
    sortableFields,
    schemaFields,
    translationsField,
    metadataFields
  ].filter(Boolean).join(',\n')

  // Generate composite unique indexes for team-scoped uniqueness
  let uniqueIndexBlock = ''
  if (uniqueFields.length > 0) {
    const indexes = uniqueFields.map(fieldName => {
      const indexName = `${snakeCaseTableName}_team_${toSnakeCase(fieldName)}_idx`
      return `  uniqueIndex('${indexName}').on(table.teamId, table.${fieldName})`
    }).join(',\n')
    uniqueIndexBlock = `, (table) => [\n${indexes}\n]`
  }

  return `${imports}${translationsComment}

export const ${exportName} = ${tableFn}('${snakeCaseTableName}', {
${allFields}
}${uniqueIndexBlock})`
}
