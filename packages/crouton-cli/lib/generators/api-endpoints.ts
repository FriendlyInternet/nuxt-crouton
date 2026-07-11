// API endpoint generators using @crouton/auth for team authentication

export function generateGetEndpoint(data: Record<string, any>, config: Record<string, any> | null = null): string {
  const { pascalCase, pascalCasePlural, layerPascalCase, plural, singular, layer } = data
  const prefixedPascalCase = `${layerPascalCase}${pascalCase}`
  const prefixedPascalCasePlural = `${layerPascalCase}${pascalCasePlural}`

  // Check if this collection has translations
  const hasTranslations = config?.translations?.collections?.[plural] || config?.translations?.collections?.[singular]

  // Foreign-key fields that can scope the list (e.g. ?eventId=...). Keeps the
  // non-paginated call byte-identical for FK-less collections.
  const filterFields = (data.fields || []).filter((f: Record<string, any>) => f.refTarget).map((f: Record<string, any>) => f.name)
  const fkInner = filterFields.map((f: string) => `${f}: query.${f} ? String(query.${f}) : undefined`).join(', ')
  const nonPagCall = filterFields.length
    ? `getAll${prefixedPascalCasePlural}(team.id, { ${fkInner} })`
    : `getAll${prefixedPascalCasePlural}(team.id)`
  const pagArgInner = filterFields.length
    ? `${fkInner}, limit: pageSize, offset: (page - 1) * pageSize`
    : `limit: pageSize, offset: (page - 1) * pageSize`
  const pagCall = `getAll${prefixedPascalCasePlural}(team.id, { ${pagArgInner} })`

  const queriesPath = '../../../../database/queries'

  return `// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { getAll${prefixedPascalCasePlural}, get${prefixedPascalCasePlural}ByIds } from '${queriesPath}'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const query = getQuery(event)${hasTranslations
    ? `
  // Accept locale for future translation handling
  const locale = String(query.locale || 'en')`
    : ''}

  const dbTimer = timing.start('db')
  if (query.ids) {
    const ids = String(query.ids).split(',')
    const result = await get${prefixedPascalCasePlural}ByIds(team.id, ids)
    dbTimer.end()
    return result
  }

  // Opt-in pagination: ?page=1&pageSize=10 → { items, total, page, pageSize }
  if (query.page !== undefined) {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 10))
    const { items, total } = await ${pagCall}
    dbTimer.end()
    return { items, total, page, pageSize }
  }

  const result = await ${nonPagCall}
  dbTimer.end()
  return result
})`
}

export function generatePostEndpoint(data: Record<string, any>, config: Record<string, any> | null = null): string {
  const { singular, pascalCase, pascalCasePlural, layerPascalCase, layer, plural, fields } = data
  const prefixedPascalCase = `${layerPascalCase}${pascalCase}`
  const prefixedPascalCasePlural = `${layerPascalCase}${pascalCasePlural}`

  const queriesPath = '../../../../database/queries'

  // Check if hierarchy is enabled
  const hasHierarchy = data.hierarchy?.enabled === true
  const useMetadata = config?.flags?.useMetadata ?? true

  // Get hierarchy field names
  const parentField = data.hierarchy?.parentField || 'parentId'
  const pathField = data.hierarchy?.pathField || 'path'
  const depthField = data.hierarchy?.depthField || 'depth'

  // Check if schema has a userId field (uploader tracking — auto-populated from auth)
  const hasUserIdField = fields.some(f => f.name === 'userId')

  // Check if there are any date fields
  const dateFields = fields.filter(f => f.type === 'date')
  const hasDateFields = dateFields.length > 0

  // Generate date conversion code if needed
  const dateConversions = hasDateFields
    ? dateFields.map(field =>
      `  // Convert date string to Date object
  if (dataWithoutId.${field.name}) {
    dataWithoutId.${field.name} = new Date(dataWithoutId.${field.name})
  }`
    ).join('\n') + '\n'
    : ''

  // Generate imports based on hierarchy needs
  const imports = hasHierarchy
    ? `import { create${prefixedPascalCase}, get${prefixedPascalCasePlural}ByIds } from '${queriesPath}'
import { nanoid } from 'nanoid'`
    : `import { create${prefixedPascalCase} } from '${queriesPath}'`

  // Generate hierarchy path calculation code if needed
  const hierarchyCalc = hasHierarchy
    ? `
  // Generate ID upfront for correct path calculation
  const recordId = nanoid()

  // Calculate path based on parentId
  let ${pathField} = \`/\${recordId}/\`
  let ${depthField} = 0

  if (dataWithoutId.${parentField}) {
    const [parent] = await get${prefixedPascalCasePlural}ByIds(team.id, [dataWithoutId.${parentField}])
    if (parent) {
      ${pathField} = \`\${parent.${pathField}}\${recordId}/\`
      ${depthField} = (parent.${depthField} || 0) + 1
    }
  }
`
    : ''

  // Generate metadata fields for create call
  const metadataFields = useMetadata ? `\n    createdBy: user.id,\n    updatedBy: user.id` : ''

  // Generate the create call based on hierarchy
  const createCall = hasHierarchy
    ? `const result = await create${prefixedPascalCase}({
    ...dataWithoutId,
    id: recordId,
    ${pathField},
    ${depthField},
    teamId: team.id,${hasUserIdField ? '\n    userId: user.id,' : ''}
    owner: user.id,${metadataFields}
  })`
    : `const result = await create${prefixedPascalCase}({
    ...dataWithoutId,
    teamId: team.id,${hasUserIdField ? '\n    userId: user.id,' : ''}
    owner: user.id,${metadataFields}
  })`

  // Repeater fields reference a named item schema in fieldsSchema; define it
  // locally so the server validation doesn't reference an undefined symbol.
  const itemSchemasPrefix = data.repeaterItemSchemasCode ? `${data.repeaterItemSchemasCode}\n\n` : ''

  return `// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
${imports}
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

${itemSchemasPrefix}const bodySchema = z.object({
  ${data.serverFieldsSchema ?? data.fieldsSchema}
}).strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)

  // body is the validated payload (id is not part of the schema)${hasHierarchy ? ' — we generate the id for path calculation' : ' — the database generates the id'}
  const dataWithoutId = body
${hierarchyCalc}
${dateConversions}  const dbTimer = timing.start('db')
  ${createCall}
  dbTimer.end()
  return result
})`
}

export function generatePatchEndpoint(data: Record<string, any>, config: Record<string, any> | null = null): string {
  const { singular, camelCase, pascalCase, pascalCasePlural, layerPascalCase, fields, plural, layer } = data
  const prefixedPascalCase = `${layerPascalCase}${pascalCase}`
  const prefixedPascalCasePlural = `${layerPascalCase}${pascalCasePlural}`

  // Check if this collection has translations
  const hasTranslations = config?.translations?.collections?.[plural] || config?.translations?.collections?.[singular]

  // System fields that should not be in PATCH body — they are managed by the server
  const systemFields = new Set(['id', 'teamId', 'owner', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'path', 'depth'])

  // Generate field selection for update with date conversion (exclude id and system fields)
  const patchableFields = fields.filter((f) => !systemFields.has(f.name))
  let fieldSelection = patchableFields.map((field) => {
    if (field.type === 'date') {
      return `    ${field.name}: body.${field.name} ? new Date(body.${field.name}) : body.${field.name}`
    }
    return `    ${field.name}: body.${field.name}`
  }).join(',\n')

  // Add translations field if needed
  if (hasTranslations) {
    fieldSelection += ',\n    translations: body.translations'
  }

  // Add imports based on translation needs
  const queriesPath = '../../../../database/queries'
  const imports = hasTranslations
    ? `import { update${prefixedPascalCase}, get${prefixedPascalCasePlural}ByIds } from '${queriesPath}'`
    : `import { update${prefixedPascalCase} } from '${queriesPath}'`

  // Repeater fields reference a named item schema in fieldsSchema; define it
  // locally so the server validation doesn't reference an undefined symbol.
  const itemSchemasPrefix = data.repeaterItemSchemasCode ? `${data.repeaterItemSchemasCode}\n\n` : ''

  return `// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
${imports}
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

${itemSchemasPrefix}const bodySchema = z.object({
  ${data.serverFieldsSchema ?? data.fieldsSchema}${hasTranslations ? ',\n  // Transient hint: which locale the translation patch targets (not a column)\n  locale: z.string().optional()' : ''}
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { ${camelCase}Id } = getRouterParams(event)
  if (!${camelCase}Id) {
    throw createError({ status: 400, statusText: 'Missing ${singular} ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)${hasTranslations
    ? `

  // Handle translation updates properly
  if (body.translations && body.locale) {
    const [existing] = await get${prefixedPascalCasePlural}ByIds(team.id, [${camelCase}Id]) as any[]
    if (existing) {
      body.translations = {
        ...existing.translations,
        [body.locale]: {
          ...existing.translations?.[body.locale],
          ...body.translations[body.locale]
        }
      }
    }
  }`
    : ''}

  // Only include fields that were actually sent in the request
  const updates: Record<string, any> = {}
  for (const [key, value] of Object.entries(body)) {${hasTranslations ? `
    if (key === 'locale') continue // transient translation hint, not a column` : ''}
    if (value !== undefined) {
      updates[key] = value
    }
  }

  const dbTimer = timing.start('db')
  const result = await update${prefixedPascalCase}(${camelCase}Id, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})`
}

export function generateDeleteEndpoint(data: Record<string, any>, config: Record<string, any> | null = null): string {
  const { singular, camelCase, pascalCase, layerPascalCase, layer, plural } = data
  const prefixedPascalCase = `${layerPascalCase}${pascalCase}`

  const queriesPath = '../../../../database/queries'

  return `// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { delete${prefixedPascalCase} } from '${queriesPath}'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { ${camelCase}Id } = getRouterParams(event)
  if (!${camelCase}Id) {
    throw createError({ status: 400, statusText: 'Missing ${singular} ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const dbTimer = timing.start('db')
  const result = await delete${prefixedPascalCase}(${camelCase}Id, team.id, user.id, { role: membership.role })
  dbTimer.end()
  return result
})`
}

// Generate move endpoint for hierarchy-enabled collections
// Creates [id]/move.patch.ts - moves an item to a new parent and position
export function generateMoveEndpoint(data: Record<string, any>, config: Record<string, any> | null = null): string {
  const { singular, camelCase, pascalCase, layerPascalCase } = data
  const prefixedPascalCase = `${layerPascalCase}${pascalCase}`

  const queriesPath = '../../../../../database/queries'

  return `// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updatePosition${prefixedPascalCase} } from '${queriesPath}'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { ${camelCase}Id } = getRouterParams(event)
  if (!${camelCase}Id) {
    throw createError({ status: 400, statusText: 'Missing ${singular} ID' })
  }

  const authTimer = timing.start('auth')
  const { team } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody(event)

  // Validate input
  if (body.order === undefined || typeof body.order !== 'number') {
    throw createError({ status: 400, statusText: 'order is required and must be a number' })
  }

  // parentId can be null (move to root) or a valid ID
  const parentId = body.parentId ?? null

  const dbTimer = timing.start('db')
  const result = await updatePosition${prefixedPascalCase}(team.id, ${camelCase}Id, parentId, body.order)
  dbTimer.end()
  return result
})`
}

// Generate reorder endpoint for hierarchy-enabled or sortable collections
// Creates reorder.patch.ts - bulk updates order for siblings within same parent
export function generateReorderEndpoint(data: Record<string, any>, config: Record<string, any> | null = null): string {
  const { pascalCase, pascalCasePlural, layerPascalCase } = data
  const prefixedPascalCasePlural = `${layerPascalCase}${pascalCasePlural}`

  // Get the order field name from hierarchy config, default to 'order'
  const hierarchy = data.hierarchy || {}
  const orderField = hierarchy.orderField || 'order'

  const queriesPath = '../../../../database/queries'

  return `// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { reorderSiblings${prefixedPascalCasePlural} } from '${queriesPath}'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody(event)

  // Validate input - expect array of { id, ${orderField} }
  if (!Array.isArray(body.updates)) {
    throw createError({ status: 400, statusText: 'updates must be an array' })
  }

  for (const update of body.updates) {
    if (!update.id || typeof update.${orderField} !== 'number') {
      throw createError({
        status: 400,
        statusText: 'Each update must have id and ${orderField} (number)'
      })
    }
  }

  const dbTimer = timing.start('db')
  const result = await reorderSiblings${prefixedPascalCasePlural}(team.id, body.updates)
  dbTimer.end()
  return result
})`
}
