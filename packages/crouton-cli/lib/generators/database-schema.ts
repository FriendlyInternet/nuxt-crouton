// Generator for Drizzle schema
import { SYSTEM_FIELD_GROUPS, metadataFields as systemMetadataFields, hierarchyFields as systemHierarchyFields } from '../utils/system-fields.ts'
import { toSnakeCase } from '../utils/helpers.ts'

// Date columns get no implicit default: nullable dates (publishedAt, deletedAt) must stay null
// unless meta.default asks for a value ('now' → new Date(), anything else → that literal).
function dateDefault(field: Record<string, any>): string {
  const def = field.meta?.default
  if (def === undefined || def === null || def === '') return ''
  if (def === 'now') return '.$default(() => new Date())'
  return `.$default(() => new Date(${JSON.stringify(def)}))`
}

export function generateSchema(data: Record<string, any>, dialect: string, config: Record<string, any> | null = null): string {
  const { plural, layer, layerPascalCase, singular, hierarchy, pascalCasePlural } = data

  // Get original collection name from data (before toCase processing)
  // For system collections, we need to preserve the original camelCase
  const originalCollectionName = data.originalCollectionName || plural
  // Use layer-prefixed name for the export to avoid conflicts
  // Convert layer to camelCase to ensure valid JavaScript identifier
  const layerCamelCase = layer
    .split(/[-_]/)
    .map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  // Use pascalCasePlural which properly handles hyphens (e.g., email-templates -> EmailTemplates)
  const exportName = `${layerCamelCase}${pascalCasePlural}`

  // Check if this collection needs translations
  const needsTranslations = config?.translations?.collections?.[plural] || config?.translations?.collections?.[singular]
  const translatableFields = needsTranslations || []

  // Build translations field if needed
  let translationsField = ''
  let translationsImport = ''
  let translationsComment = ''

  if (needsTranslations && dialect === 'sqlite') {
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
  const useMetadata = config?.flags?.useMetadata ?? true

  // Build list of reserved fields to filter out based on config
  const reservedFields = [
    ...SYSTEM_FIELD_GROUPS.id,
    ...systemMetadataFields(useMetadata),
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
      // unique is handled via composite (teamId, field) index, not per-column .unique()
      const unique = ''

      // Check if this is a dependent field (should be stored as JSON array)
      const isDependentField = field.meta?.dependsOn || field.meta?.displayAs === 'slotButtonGroup'

      if (dialect === 'sqlite') {
      // SQLite specific schema
        if (field.type === 'boolean') {
          const boolDefault = field.meta?.default === true ? 'true' : 'false'
          return `  ${field.name}: integer('${field.name}', { mode: 'boolean' })${nullable}${unique}.$default(() => ${boolDefault})`
        } else if (field.type === 'number' || field.type === 'decimal') {
          return `  ${field.name}: ${field.type === 'decimal' ? 'real' : 'integer'}('${field.name}')${nullable}${unique}`
        } else if (field.type === 'date') {
          return `  ${field.name}: integer('${field.name}', { mode: 'timestamp' })${nullable}${unique}${dateDefault(field)}`
        } else if (field.type === 'json' || field.type === 'repeater' || field.type === 'array' || isDependentField) {
        // Use [] for arrays/repeaters/dependent fields, {} for json objects
          const defaultValue = (field.type === 'array' || field.type === 'repeater' || isDependentField) ? 'null' : '{}'
          // Use customType to handle NULL values gracefully in LEFT JOINs
          return `  ${field.name}: jsonColumn('${field.name}')${nullable}${unique}.$default(() => (${defaultValue}))`
        } else {
          return `  ${field.name}: text('${field.name}')${nullable}${unique}`
        }
      } else {
      // PostgreSQL specific schema
        if (field.type === 'boolean') {
          const boolDefault = field.meta?.default === true ? 'true' : 'false'
          return `  ${field.name}: boolean('${field.name}')${nullable}${unique}.$default(() => ${boolDefault})`
        } else if (field.type === 'number') {
          return `  ${field.name}: integer('${field.name}')${nullable}${unique}`
        } else if (field.type === 'decimal') {
          return `  ${field.name}: numeric('${field.name}')${nullable}${unique}`
        } else if (field.type === 'date') {
          return `  ${field.name}: timestamp('${field.name}', { withTimezone: true })${nullable}${unique}${dateDefault(field)}`
        } else if (field.type === 'json' || field.type === 'repeater' || field.type === 'array' || isDependentField) {
        // Use [] for arrays/repeaters/dependent fields, {} for json objects
          const defaultValue = (field.type === 'array' || field.type === 'repeater' || isDependentField) ? 'null' : '{}'
          return `  ${field.name}: jsonb('${field.name}')${nullable}${unique}.$default(() => (${defaultValue}))`
        } else if (field.type === 'text') {
          return `  ${field.name}: text('${field.name}')${nullable}${unique}`
        } else {
          const maxLength = field.meta?.maxLength
          if (maxLength) {
            return `  ${field.name}: varchar('${field.name}', { length: ${maxLength} })${nullable}${unique}`
          }
          return `  ${field.name}: text('${field.name}')${nullable}${unique}`
        }
      }
    }).join(',\n')

  const imports = dialect === 'sqlite'
    ? `import { nanoid } from 'nanoid'
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
    : `import { pgTable, varchar, text, integer, numeric, boolean, timestamp, jsonb, uuid${uniqueFields.length > 0 ? ', uniqueIndex' : ''} } from 'drizzle-orm/pg-core'`

  const tableFn = dialect === 'sqlite' ? 'sqliteTable' : 'pgTable'

  const idField = dialect === 'sqlite'
    ? `  id: text('id').primaryKey().$default(() => nanoid())`
    : `  id: uuid('id').primaryKey().defaultRandom()`

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

    if (dialect === 'sqlite') {
      hierarchyFields = `
  // Hierarchy fields for tree structure
  ${parentField}: text('${parentField}'),
  ${pathField}: text('${pathField}').notNull().$default(() => '/'),
  ${depthField}: integer('${depthField}').notNull().$default(() => 0),
  ${orderField}: integer('${orderField}').notNull().$default(() => 0)`
    } else {
      // PostgreSQL
      hierarchyFields = `
  // Hierarchy fields for tree structure
  ${parentField}: text('${parentField}'),
  ${pathField}: text('${pathField}').notNull().default('/'),
  ${depthField}: integer('${depthField}').notNull().default(0),
  ${orderField}: integer('${orderField}').notNull().default(0)`
    }
  }

  // Build sortable field conditionally (only when sortable is true and hierarchy is not enabled)
  let sortableFields = ''
  if (sortable && !hierarchy?.enabled) {
    if (dialect === 'sqlite') {
      sortableFields = `
  order: integer('order').notNull().$default(() => 0)`
    } else {
      // PostgreSQL
      sortableFields = `
  order: integer('order').notNull().default(0)`
    }
  }

  // Build metadata fields conditionally
  const metadataFields = useMetadata
    ? `
  createdAt: ${dialect === 'sqlite' ? 'integer(\'createdAt\', { mode: \'timestamp\' })' : 'timestamp(\'createdAt\', { withTimezone: true })'}.notNull().$default(() => new Date()),
  updatedAt: ${dialect === 'sqlite' ? 'integer(\'updatedAt\', { mode: \'timestamp\' })' : 'timestamp(\'updatedAt\', { withTimezone: true })'}.notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()`
    : ''

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
