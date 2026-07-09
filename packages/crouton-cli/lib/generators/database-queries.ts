// Generator for database queries
import { toKebabCase, pascal } from '../utils/helpers.ts'

// Shared context for the tree-query template builders below
interface TreeQueryContext {
  tableName: string
  prefixedPascalCase: string
  prefixedPascalCasePlural: string
  camelCasePlural: string
  parentField: string
  pathField: string
  depthField: string
  orderField: string
}

// Section banner + the TreeItem interface shared by the tree query templates
function buildTreeQueriesHeader(ctx: TreeQueryContext): string {
  return `

// Tree hierarchy queries (auto-generated when hierarchy: true)
// Type: ${ctx.prefixedPascalCase} with hierarchy fields

interface TreeItem {
  id: string
  ${ctx.pathField}: string
  ${ctx.depthField}: number
  ${ctx.orderField}: number
  [key: string]: any
}`
}

// getTreeData* — fetch the whole team-scoped tree ordered by path + order
function buildTreeGetDataQuery(ctx: TreeQueryContext): string {
  return `

export async function getTreeData${ctx.prefixedPascalCasePlural}(teamId: string) {
  const db = useDB()

  const ${ctx.camelCasePlural} = await (db as any)
    .select()
    .from(tables.${ctx.tableName})
    .where(eq(tables.${ctx.tableName}.teamId, teamId))
    .orderBy(tables.${ctx.tableName}.${ctx.pathField}, tables.${ctx.tableName}.${ctx.orderField})

  return ${ctx.camelCasePlural} as TreeItem[]
}`
}

// updatePosition* — move a node to a new parent/order, recomputing path + depth
// for the node and all of its descendants
function buildTreeUpdatePositionQuery(ctx: TreeQueryContext): string {
  return `

export async function updatePosition${ctx.prefixedPascalCase}(
  teamId: string,
  id: string,
  newParentId: string | null,
  newOrder: number
) {
  const db = useDB()

  // Get the current item to find its path
  const [current] = await (db as any)
    .select()
    .from(tables.${ctx.tableName})
    .where(
      and(
        eq(tables.${ctx.tableName}.id, id),
        eq(tables.${ctx.tableName}.teamId, teamId)
      )
    ) as TreeItem[]

  if (!current) {
    throw createError({
      status: 404,
      statusText: '${ctx.prefixedPascalCase} not found'
    })
  }

  // Calculate new path and depth
  let newPath: string
  let newDepth: number

  if (newParentId) {
    const [parent] = await (db as any)
      .select()
      .from(tables.${ctx.tableName})
      .where(
        and(
          eq(tables.${ctx.tableName}.id, newParentId),
          eq(tables.${ctx.tableName}.teamId, teamId)
        )
      ) as TreeItem[]

    if (!parent) {
      throw createError({
        status: 400,
        statusText: 'Parent ${ctx.prefixedPascalCase} not found'
      })
    }

    // Prevent moving item to its own descendant
    if (parent.${ctx.pathField}.startsWith(current.${ctx.pathField})) {
      throw createError({
        status: 400,
        statusText: 'Cannot move item to its own descendant'
      })
    }

    newPath = \`\${parent.${ctx.pathField}}\${id}/\`
    newDepth = parent.${ctx.depthField} + 1
  } else {
    newPath = \`/\${id}/\`
    newDepth = 0
  }

  const oldPath = current.${ctx.pathField}

  // Update the item itself
  const [updated] = await (db as any)
    .update(tables.${ctx.tableName})
    .set({
      ${ctx.parentField}: newParentId,
      ${ctx.pathField}: newPath,
      ${ctx.depthField}: newDepth,
      ${ctx.orderField}: newOrder
    })
    .where(
      and(
        eq(tables.${ctx.tableName}.id, id),
        eq(tables.${ctx.tableName}.teamId, teamId)
      )
    )
    .returning()

  // Update all descendants' paths if the path changed
  if (oldPath !== newPath) {
    // Get all descendants
    const descendants = await (db as any)
      .select()
      .from(tables.${ctx.tableName})
      .where(
        and(
          eq(tables.${ctx.tableName}.teamId, teamId),
          sql\`\${tables.${ctx.tableName}.${ctx.pathField}} LIKE \${oldPath + '%'} AND \${tables.${ctx.tableName}.id} != \${id}\`
        )
      ) as TreeItem[]

    // Update each descendant's path and depth
    for (const descendant of descendants) {
      const descendantNewPath = descendant.${ctx.pathField}.replace(oldPath, newPath)
      const depthDiff = newDepth - current.${ctx.depthField}

      await (db as any)
        .update(tables.${ctx.tableName})
        .set({
          ${ctx.pathField}: descendantNewPath,
          ${ctx.depthField}: descendant.${ctx.depthField} + depthDiff
        })
        .where(eq(tables.${ctx.tableName}.id, descendant.id))
    }
  }

  return updated
}`
}

// reorderSiblings* — sequential per-row order updates (hierarchy variant)
function buildTreeReorderSiblingsQuery(ctx: TreeQueryContext): string {
  return `

export async function reorderSiblings${ctx.prefixedPascalCasePlural}(
  teamId: string,
  updates: { id: string; ${ctx.orderField}: number }[]
) {
  const db = useDB()

  const results = []

  for (const update of updates) {
    const [updated] = await (db as any)
      .update(tables.${ctx.tableName})
      .set({ ${ctx.orderField}: update.${ctx.orderField} })
      .where(
        and(
          eq(tables.${ctx.tableName}.id, update.id),
          eq(tables.${ctx.tableName}.teamId, teamId)
        )
      )
      .returning()

    if (updated) {
      results.push(updated)
    }
  }

  return results
}`
}

// Helper to generate tree-specific queries when hierarchy is enabled
function generateTreeQueries(data: Record<string, any>, tableName: string, prefixedPascalCase: string, prefixedPascalCasePlural: string, camelCasePlural: string): string {
  const hierarchy = data.hierarchy
  if (!hierarchy || !hierarchy.enabled) {
    return ''
  }

  // Get field names with defaults
  const ctx: TreeQueryContext = {
    tableName,
    prefixedPascalCase,
    prefixedPascalCasePlural,
    camelCasePlural,
    parentField: hierarchy.parentField || 'parentId',
    pathField: hierarchy.pathField || 'path',
    depthField: hierarchy.depthField || 'depth',
    orderField: hierarchy.orderField || 'order'
  }

  // Note: Type assertions (as any) are used throughout to handle drizzle-orm version mismatches
  // that can occur in monorepo setups. This is a pragmatic solution that allows the generated
  // code to work across different drizzle-orm versions.

  return buildTreeQueriesHeader(ctx)
    + buildTreeGetDataQuery(ctx)
    + buildTreeUpdatePositionQuery(ctx)
    + buildTreeReorderSiblingsQuery(ctx)
}

// Helper to generate reorder-only queries when sortable is enabled (without full hierarchy)
function generateSortableQueries(data: Record<string, any>, tableName: string, prefixedPascalCasePlural: string): string {
  const sortable = data.sortable
  if (!sortable || !sortable.enabled) {
    return ''
  }

  const orderField = sortable.orderField || 'order'

  return `

// Sortable reorder queries (auto-generated when sortable: true)

export async function reorderSiblings${prefixedPascalCasePlural}(
  teamId: string,
  updates: { id: string; ${orderField}: number }[]
) {
  const db = useDB()

  const results = await Promise.all(
    updates.map(({ id, ${orderField} }) =>
      (db as any)
        .update(tables.${tableName})
        .set({ ${orderField} })
        .where(
          and(
            eq(tables.${tableName}.id, id),
            eq(tables.${tableName}.teamId, teamId)
          )
        )
        .returning()
    )
  )

  return { success: true, updated: results.flat().length }
}`
}

// Helper to detect JSON/repeater fields that need post-query parsing
// These fields are stored as JSON strings in SQLite but need to be parsed arrays/objects
function detectJsonFields(data: Record<string, any>): { fieldName: string; fieldType: string; defaultValue: string }[] {
  const jsonFields = []

  if (data.fields) {
    data.fields.forEach((field) => {
      if (field.type === 'repeater' || field.type === 'json') {
        jsonFields.push({
          fieldName: field.name,
          fieldType: field.type,
          // repeater fields should default to [], json fields to null
          defaultValue: field.type === 'repeater' ? '[]' : 'null'
        })
      }
    })
  }

  return jsonFields
}

// Helper to detect reference fields that need LEFT JOINs or post-query processing
function detectReferenceFields(data: Record<string, any>, config: Record<string, any> | null): { singleReferences: Record<string, any>[]; arrayReferences: Record<string, any>[] } {
  const singleReferences = [] // For leftJoin
  const arrayReferences = [] // For post-query processing

  // Check custom fields for refTarget
  if (data.fields) {
    data.fields.forEach((field) => {
      if (field.refTarget) {
        const isExternal = field.refScope === 'external' || field.refScope === 'adapter'
        const refData = {
          fieldName: field.name,
          targetCollection: field.refTarget,
          isExternal: isExternal,
          isUserReference: isExternal && field.refTarget === 'users'
        }

        // Separate single references from array references
        if (field.type === 'array') {
          arrayReferences.push(refData)
        } else {
          singleReferences.push(refData)
        }
      }
    })
  }

  // Add standard team/metadata user references
  // These are always single references
  // Team fields are always required (all generated endpoints use @crouton/auth)
  const useMetadata = config?.flags?.useMetadata ?? true

  // owner is always included (required for @crouton/auth)
  singleReferences.push({
    fieldName: 'owner',
    targetCollection: 'users',
    isExternal: true,
    isUserReference: true
  })

  if (useMetadata) {
    singleReferences.push({
      fieldName: 'createdBy',
      targetCollection: 'users',
      isExternal: true,
      isUserReference: true
    })
    singleReferences.push({
      fieldName: 'updatedBy',
      targetCollection: 'users',
      isExternal: true,
      isUserReference: true
    })
  }

  return { singleReferences, arrayReferences }
}

// Convert a layer name to camelCase to ensure a valid JavaScript identifier
// (e.g. my-app_core -> myAppCore)
function toLayerCamelCase(layer: string): string {
  return layer
    .split(/[-_]/)
    .map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

// Generate imports for referenced schemas (external, cross-layer, or same-layer)
function buildSchemaImports(
  singleReferences: Record<string, any>[],
  arrayReferences: Record<string, any>[],
  currentLayer: string,
  collectionLayerMap: Map<string, string>
): string {
  let schemaImports = ''
  const allReferences = [...singleReferences, ...arrayReferences]
  const uniqueCollections = [...new Set(allReferences.map(r => r.targetCollection))]

  uniqueCollections.forEach((collection) => {
    // Get any reference to this collection to check if external
    const ref = allReferences.find(r => r.targetCollection === collection)

    if (ref && ref.isExternal) {
      // External reference - import from main project schema
      // Note: Better Auth exports 'user' (singular), so map 'users' -> 'user'
      // NuxtHub v0.10+ expects schema at server/db/schema.ts
      const schemaExportName = collection === 'users' ? 'user' : collection
      schemaImports += `import { ${schemaExportName} } from '~~/server/db/schema'
`
    } else {
      // Local or cross-layer collection
      const targetLayer = collectionLayerMap.get(collection.toLowerCase())
      if (targetLayer && targetLayer !== currentLayer) {
        // Cross-layer: escape 5 levels up from .../database/ to layers/, then descend into target layer
        schemaImports += `import * as ${collection}Schema from '../../../../../${targetLayer}/collections/${collection.toLowerCase()}/server/database/schema'
`
      } else {
        // Same-layer sibling (or unknown — fall back to existing behavior)
        schemaImports += `import * as ${collection}Schema from '../../../${collection.toLowerCase()}/server/database/schema'
`
      }
    }
  })

  return schemaImports
}

// Build SELECT clause with joins (only for single references)
function buildSelectJoins(
  singleReferences: Record<string, any>[],
  tableName: string,
  getTargetLayerCamelCase: (collectionName: string) => string
): { selectClause: string; leftJoins: string; aliasDefinitions: string } {
  let selectClause = ''
  let leftJoins = ''
  let aliasDefinitions = ''

  if (singleReferences.length > 0) {
    // Build select fields
    const selectFields = [`...tables.${tableName}`]

    // Track how many times we join each table to create unique aliases
    const tableJoinCounts = {}
    const userAliases = []

    singleReferences.forEach((ref) => {
      const collectionIdentifier = ref.targetCollection

      // For external refs, use table name as-is (no layer prefix)
      // For local refs, add the layer prefix with PascalCase collection name
      // e.g., app + emailTemplates -> appEmailTemplates
      const refTableName = ref.isExternal
        ? collectionIdentifier
        : `${getTargetLayerCamelCase(collectionIdentifier)}${pascal(collectionIdentifier)}`

      if (ref.isUserReference) {
        // Special user reference handling
        const aliasName = `${ref.fieldName}User`
        userAliases.push({ fieldName: ref.fieldName, aliasName })

        // Note: Better Auth user table uses 'image' not 'avatarUrl'
        selectFields.push(`${ref.fieldName}User: {
        id: ${aliasName}.id,
        name: ${aliasName}.name,
        email: ${aliasName}.email,
        image: ${aliasName}.image
      }`)
        leftJoins += `
    .leftJoin(${aliasName}, eq(tables.${tableName}.${ref.fieldName}, ${aliasName}.id))`
      } else if (ref.isExternal) {
        // External non-user reference - direct table import
        selectFields.push(`${ref.fieldName}Data: ${collectionIdentifier}`)
        leftJoins += `
    .leftJoin(${collectionIdentifier}, eq(tables.${tableName}.${ref.fieldName}, ${collectionIdentifier}.id))`
      } else {
        // Local layer reference - namespaced import
        selectFields.push(`${ref.fieldName}Data: ${collectionIdentifier}Schema.${refTableName}`)
        leftJoins += `
    .leftJoin(${collectionIdentifier}Schema.${refTableName}, eq(tables.${tableName}.${ref.fieldName}, ${collectionIdentifier}Schema.${refTableName}.id))`
      }
    })

    // Generate alias definitions for user references
    // Note: Better Auth exports 'user' (singular), not 'users'
    // Type assertion needed due to drizzle-orm type strictness with re-exported tables
    if (userAliases.length > 0) {
      const aliasDefs = userAliases.map(({ aliasName }) =>
        `  const ${aliasName} = alias(user as any, '${aliasName}')`
      ).join('\n')
      aliasDefinitions = `\n${aliasDefs}\n`
    }

    selectClause = `{
      ${selectFields.join(',\n      ')}
    }`
  }

  return { selectClause, leftJoins, aliasDefinitions }
}

// Generate post-query processing code for JSON fields (repeater, json types)
// These fields come back as strings from SQLite and need to be parsed
function buildJsonFieldProcessing(
  jsonFields: { fieldName: string; fieldType: string; defaultValue: string }[],
  camelCasePlural: string
): string {
  let jsonFieldProcessing = ''
  if (jsonFields.length > 0) {
    const fieldParsers = jsonFields.map(field => `
      // Parse ${field.fieldName} from JSON string
      if (typeof item.${field.fieldName} === 'string') {
        try {
          item.${field.fieldName} = JSON.parse(item.${field.fieldName})
        } catch (e) {
          console.error('Error parsing ${field.fieldName}:', e)
          item.${field.fieldName} = ${field.defaultValue}
        }
      }
      if (item.${field.fieldName} === null || item.${field.fieldName} === undefined) {
        item.${field.fieldName} = ${field.defaultValue}
      }`).join('')

    jsonFieldProcessing = `
  // Post-query processing for JSON fields (repeater/json types)
  ${camelCasePlural}.forEach((item: any) => {${fieldParsers}
  })
`
  }
  return jsonFieldProcessing
}

// Generate post-query processing code for array references
function buildArrayRefProcessing(
  arrayReferences: Record<string, any>[],
  camelCasePlural: string,
  getTargetLayerCamelCase: (collectionName: string) => string
): string {
  let postQueryProcessing = ''
  if (arrayReferences.length > 0) {
    // Group array references by target collection for efficient querying
    const refsByCollection = {}
    arrayReferences.forEach((ref) => {
      const collection = ref.targetCollection
      if (!refsByCollection[collection]) {
        refsByCollection[collection] = []
      }
      refsByCollection[collection].push(ref)
    })

    // Generate processing code for each target collection
    const processingBlocks = []
    Object.entries(refsByCollection).forEach(([collection, refs]) => {
      const ref = refsByCollection[collection][0] // Get reference metadata
      const collectionIdentifier = collection
      const tableReference = ref.isExternal
        ? collectionIdentifier
        : `${collectionIdentifier}Schema.${getTargetLayerCamelCase(collectionIdentifier)}${pascal(collectionIdentifier)}`

      // Use consistent PascalCase variable naming
      const collectionVarName = pascal(collectionIdentifier)

      // Build the ID collection logic for all fields referencing this collection
      const idCollectionCode = refs.map(ref => `
    ${camelCasePlural}.forEach(item => {
        if (item.${ref.fieldName}) {
          try {
            const ids = typeof item.${ref.fieldName} === 'string'
              ? JSON.parse(item.${ref.fieldName})
              : item.${ref.fieldName}
            if (Array.isArray(ids)) {
              ids.forEach(id => all${collectionVarName}Ids.add(id))
            }
          } catch (e) {
            // Handle parsing errors gracefully
            console.error('Error parsing ${ref.fieldName}:', e)
          }
        }
      })`).join('')

      // Build the mapping logic for all fields
      const mappingCode = refs.map(ref => `
        item.${ref.fieldName}Data = []
        if (item.${ref.fieldName}) {
          try {
            const ids = typeof item.${ref.fieldName} === 'string'
              ? JSON.parse(item.${ref.fieldName})
              : item.${ref.fieldName}
            if (Array.isArray(ids)) {
              item.${ref.fieldName}Data = related${collectionVarName}.filter(r => ids.includes(r.id))
            }
          } catch (e) {
            console.error('Error mapping ${ref.fieldName}:', e)
          }
        }`).join('')

      processingBlocks.push(`
    // Post-process array references to ${collection}
    const all${collectionVarName}Ids = new Set()${idCollectionCode}

    if (all${collectionVarName}Ids.size > 0) {
      const related${collectionVarName} = await db
        .select()
        .from(${tableReference})
        .where(inArray(${tableReference}.id, Array.from(all${collectionVarName}Ids)))

      ${camelCasePlural}.forEach(item => {${mappingCode}
      })
    }`)
    })

    postQueryProcessing = `
  // Post-query processing for array references
  if (${camelCasePlural}.length > 0) {${processingBlocks.join('')}
  }
`
  }
  return postQueryProcessing
}

// getAll* options bag: optional FK filters (e.g. ?eventId=) + optional limit/offset
// pagination. When `limit` is provided the function returns { items, total }
// (total via a parallel count(*)); otherwise it returns the bare array — so
// existing non-paginated callers are unaffected (enforced by the overloads).
function buildGetAllOpts(filterFields: string[], tableName: string): { overload1Opts: string; overload2Opts: string; implOpts: string; filterConditions: string } {
  const fkTypeFields = filterFields.map(f => `${f}?: string`).join('; ')
  return {
    overload1Opts: `opts?: {${fkTypeFields ? ` ${fkTypeFields} ` : ''}}`,
    overload2Opts: `opts: {${fkTypeFields ? ` ${fkTypeFields};` : ''} limit: number; offset?: number }`,
    implOpts: `opts: {${fkTypeFields ? ` ${fkTypeFields};` : ''} limit?: number; offset?: number } = {}`,
    filterConditions: filterFields
      .map(f => `\n  if (opts.${f}) conditions.push(eq(tables.${tableName}.${f}, opts.${f}))`)
      .join('')
  }
}

// Shared context for the CRUD query template builders below
interface QueryTemplateContext {
  tableName: string
  prefixedPascalCase: string
  prefixedPascalCasePlural: string
  camelCase: string
  camelCasePlural: string
  useMetadata: boolean
  typesPath: string
  ascImport: string
  schemaImports: string
  aliasDefinitions: string
  selectExpr: string
  leftJoins: string
  orderByClause: string
  jsonFieldProcessing: string
  postQueryProcessing: string
  overload1Opts: string
  overload2Opts: string
  implOpts: string
  filterConditions: string
}

// Imports + schema imports header of the generated queries file
function buildFileHeader(ctx: QueryTemplateContext): string {
  // `sql` is always needed now — getAll* runs a count(*) for pagination totals.
  const sqlImport = ', sql'
  return `// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and${ctx.useMetadata ? ', desc' : ''}${ctx.ascImport}, inArray${sqlImport} } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { ${ctx.prefixedPascalCase}, New${ctx.prefixedPascalCase} } from '${ctx.typesPath}'
${ctx.schemaImports}`
}

// getAll* — team-scoped list with FK filters, joins, post-processing, and the
// opt-in pagination overloads ({ items, total } when `limit` is passed)
function buildGetAllQuery(ctx: QueryTemplateContext): string {
  return `
// Overload order matters: the paginated signature (required \`limit\`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAll${ctx.prefixedPascalCasePlural}(teamId: string, ${ctx.overload2Opts}): Promise<{ items: any[]; total: number }>
export async function getAll${ctx.prefixedPascalCasePlural}(teamId: string, ${ctx.overload1Opts}): Promise<any[]>
export async function getAll${ctx.prefixedPascalCasePlural}(teamId: string, ${ctx.implOpts}) {
  const db = useDB()
${ctx.aliasDefinitions}  const conditions = [eq(tables.${ctx.tableName}.teamId, teamId)]${ctx.filterConditions}
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select(${ctx.selectExpr})
    .from(tables.${ctx.tableName})${ctx.leftJoins}
    .where(whereExpr)${ctx.orderByClause ? `
    .orderBy(${ctx.orderByClause})` : ''}

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const ${ctx.camelCasePlural} = await listQuery
${ctx.jsonFieldProcessing}${ctx.postQueryProcessing}
  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql\`count(*)\` })
      .from(tables.${ctx.tableName})
      .where(whereExpr)
    return { items: ${ctx.camelCasePlural}, total: Number(countRow?.count ?? 0) }
  }

  return ${ctx.camelCasePlural}
}`
}

// get*ByIds — team-scoped bulk fetch by id list (same joins/post-processing)
function buildGetByIdsQuery(ctx: QueryTemplateContext): string {
  return `

export async function get${ctx.prefixedPascalCasePlural}ByIds(teamId: string, ${ctx.camelCase}Ids: string[]) {
  const db = useDB()
${ctx.aliasDefinitions}
  const ${ctx.camelCasePlural} = await (db as any)
    .select(${ctx.selectExpr})
    .from(tables.${ctx.tableName})${ctx.leftJoins}
    .where(
      and(
        eq(tables.${ctx.tableName}.teamId, teamId),
        inArray(tables.${ctx.tableName}.id, ${ctx.camelCase}Ids)
      )
    )${ctx.orderByClause ? `
    .orderBy(${ctx.orderByClause})` : ''}
${ctx.jsonFieldProcessing}${ctx.postQueryProcessing}
  return ${ctx.camelCasePlural}
}`
}

// create* — plain insert returning the created row
function buildCreateQuery(ctx: QueryTemplateContext): string {
  return `

export async function create${ctx.prefixedPascalCase}(data: New${ctx.prefixedPascalCase}) {
  const db = useDB()

  const [${ctx.camelCase}] = await (db as any)
    .insert(tables.${ctx.tableName})
    .values(data)
    .returning()

  return ${ctx.camelCase}
}`
}

// update* — team-scoped update with owner check (admins bypass) + 404 guard
function buildUpdateQuery(ctx: QueryTemplateContext): string {
  return `

export async function update${ctx.prefixedPascalCase}(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<${ctx.prefixedPascalCase}>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.${ctx.tableName}.id, recordId),
    eq(tables.${ctx.tableName}.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.${ctx.tableName}.owner, userId))
  }

  const [${ctx.camelCase}] = await (db as any)
    .update(tables.${ctx.tableName})
    .set({
      ...updates,${ctx.useMetadata ? `
      updatedBy: userId` : ''}
    })
    .where(and(...conditions))
    .returning()

  if (!${ctx.camelCase}) {
    throw createError({
      status: 404,
      statusText: '${ctx.prefixedPascalCase} not found or unauthorized'
    })
  }

  return ${ctx.camelCase}
}`
}

// delete* — team-scoped delete with owner check (admins bypass) + 404 guard
function buildDeleteQuery(ctx: QueryTemplateContext): string {
  return `

export async function delete${ctx.prefixedPascalCase}(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.${ctx.tableName}.id, recordId),
    eq(tables.${ctx.tableName}.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.${ctx.tableName}.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.${ctx.tableName})
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: '${ctx.prefixedPascalCase} not found or unauthorized'
    })
  }

  return { success: true }
}`
}

export function generateQueries(data: Record<string, any>, config: Record<string, any> | null = null, currentLayer: string = '', collectionLayerMap: Map<string, string> = new Map()): string {
  const { singular, camelCase, camelCasePlural, plural, pascalCase, pascalCasePlural, layer, layerPascalCase } = data
  // Use layer-prefixed table name to match schema export
  // Convert layer to camelCase to ensure valid JavaScript identifier
  const layerCamelCase = toLayerCamelCase(layer)

  // Resolve target layer camelCase for a collection — uses collectionLayerMap so cross-layer
  // refs (e.g. contacts in people layer) produce the correct table name (peopleContacts, not
  // projectsContacts). Falls back to current layer for unresolved collections.
  const getTargetLayerCamelCase = (collectionName: string): string => {
    const targetLayer = collectionLayerMap.get(collectionName.toLowerCase())
    if (!targetLayer) return layerCamelCase
    return toLayerCamelCase(targetLayer)
  }
  // Use pascalCasePlural which properly handles hyphens (e.g., email-templates -> EmailTemplates)
  const tableName = `${layerCamelCase}${pascalCasePlural}`
  const prefixedPascalCase = `${layerPascalCase}${pascalCase}`
  const prefixedPascalCasePlural = `${layerPascalCase}${pascalCasePlural}`
  const typesPath = '../../types'

  // Detect reference fields for LEFT JOINs and post-query processing
  const { singleReferences, arrayReferences } = detectReferenceFields(data, config)

  // Foreign-key fields usable to scope getAll* (e.g. ?eventId=...). Excludes the
  // owner/createdBy/updatedBy user refs — only real FK columns (eventId, categoryId, …).
  const filterFields = singleReferences.filter(r => !r.isUserReference).map(r => r.fieldName)

  const schemaImports = buildSchemaImports(singleReferences, arrayReferences, currentLayer, collectionLayerMap)
  const { selectClause, leftJoins, aliasDefinitions } = buildSelectJoins(singleReferences, tableName, getTargetLayerCamelCase)

  // Post-query processing for JSON/repeater fields and array references
  const jsonFieldProcessing = buildJsonFieldProcessing(detectJsonFields(data), camelCasePlural)
  const postQueryProcessing = buildArrayRefProcessing(arrayReferences, camelCasePlural, getTargetLayerCamelCase)

  // Check if hierarchy or sortable is enabled for import modifications
  const hasHierarchy = data.hierarchy && data.hierarchy.enabled
  const hasSortable = data.sortable && data.sortable.enabled
  const useMetadata = config?.flags?.useMetadata ?? true
  const ascImport = (hasHierarchy || hasSortable) ? ', asc' : ''
  const orderField = hasSortable ? (data.sortable.orderField || 'order') : 'order'
  const orderByClause = hasSortable
    ? (useMetadata
        ? `asc(tables.${tableName}.${orderField}), desc(tables.${tableName}.createdAt)`
        : `asc(tables.${tableName}.${orderField})`)
    : (useMetadata
        ? `desc(tables.${tableName}.createdAt)`
        : '')

  // Generate tree queries if hierarchy is enabled
  const treeQueries = generateTreeQueries(data, tableName, prefixedPascalCase, prefixedPascalCasePlural, camelCasePlural)

  // Generate sortable queries if sortable is enabled but hierarchy is not
  // (hierarchy already includes reorderSiblings, so we skip to avoid duplicate exports)
  const sortableQueries = hasHierarchy ? '' : generateSortableQueries(data, tableName, prefixedPascalCasePlural)

  const { overload1Opts, overload2Opts, implOpts, filterConditions } = buildGetAllOpts(filterFields, tableName)

  const ctx: QueryTemplateContext = {
    tableName,
    prefixedPascalCase,
    prefixedPascalCasePlural,
    camelCase,
    camelCasePlural,
    useMetadata,
    typesPath,
    ascImport,
    schemaImports,
    aliasDefinitions,
    selectExpr: selectClause ? `${selectClause} as any` : '()',
    leftJoins,
    orderByClause,
    jsonFieldProcessing,
    postQueryProcessing,
    overload1Opts,
    overload2Opts,
    implOpts,
    filterConditions
  }

  return buildFileHeader(ctx)
    + buildGetAllQuery(ctx)
    + buildGetByIdsQuery(ctx)
    + buildCreateQuery(ctx)
    + buildUpdateQuery(ctx)
    + buildDeleteQuery(ctx)
    + treeQueries
    + sortableQueries
}
