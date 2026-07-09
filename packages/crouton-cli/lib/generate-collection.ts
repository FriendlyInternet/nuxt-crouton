#!/usr/bin/env node
// generate-collection.ts — Complete collection generator with modular architecture

import fsp from 'node:fs/promises'
import path from 'node:path'
import { exec, execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { loadConfig } from 'c12'

// Import utilities
import { toCase, toSnakeCase } from './utils/helpers.ts'
import { loadTypeMapping, discoverManifests, getGeneratorDetectors, getGeneratorContributions } from './utils/manifest-bridge.ts'
import type { DetectionResult, DetectedField, FormEnhancement, ListEnhancement, GeneratorContribution } from '@fyit/crouton-core/shared/manifest'
import { detectRequiredDependencies, displayMissingDependencies, ensureLayersExtended } from './utils/module-detector.ts'
import { setupCroutonCssSource, displayManualCssSetupInstructions } from './utils/css-setup.ts'
import { syncFrameworkPackages, addToNuxtConfigExtends, addRuntimeConfig } from './utils/update-nuxt-config.ts'
import { addNamedSchemaExport } from './utils/update-schema-index.ts'
import { addToAppConfig, resolveAppConfigPath } from './utils/update-app-config.ts'
import { loadFields } from './utils/load-fields.ts'
import { validateConfig } from './utils/validate-config.ts'
import { updateLayerRootConfig, setupLayerI18n } from './utils/layer-config.ts'
import { exportI18nSchema } from './utils/i18n-schema.ts'

// Import generators
import { generateFormComponent } from './generators/form-component.ts'
import { generateListComponent } from './generators/list-component.ts'
import { generateComposable, generateRepeaterItemSchema } from './generators/composable.ts'
import { generateCollectionReadme } from './generators/collection-readme.ts'
import {
  generateGetEndpoint,
  generatePostEndpoint,
  generatePatchEndpoint,
  generateDeleteEndpoint,
  generateMoveEndpoint,
  generateReorderEndpoint
} from './generators/api-endpoints.ts'
import { generateQueries } from './generators/database-queries.ts'
import { generateSchema } from './generators/database-schema.ts'
import { generateTypes } from './generators/types.ts'
import { generateNuxtConfig } from './generators/nuxt-config.ts'
import { generateCollectionTest } from './generators/collection-test.ts'
import { generateApiTest } from './generators/api-test.ts'
import { generateRepeaterItemComponent } from './generators/repeater-item-component.ts'
import { generateFieldComponents } from './generators/field-components.ts'
import { generateSeedFile } from './generators/seed-data.ts'
import { generateSeedFixture } from './generators/collection-seed-fixture.ts'
import { generateCollectionTypesRegistry } from './generators/collection-types-registry.ts'
import { generateQueryRegistryFile } from './generators/query-registry.ts'

const execAsync = promisify(exec)

// ---------------------------------------------------------------------------
// Generation History
// ---------------------------------------------------------------------------

interface GenerationHistoryEntry {
  collection: string
  fields: string[]
  generator: string
  timestamp: string
  layer?: string
  gitSha?: string
}

function recordGenerationHistory(entry: Omit<GenerationHistoryEntry, 'gitSha'>): void {
  const historyPath = path.resolve(process.cwd(), '.crouton-generation-history.json')
  let history: GenerationHistoryEntry[] = []

  if (existsSync(historyPath)) {
    try {
      history = JSON.parse(readFileSync(historyPath, 'utf-8'))
    } catch {
      history = []
    }
  }

  let gitSha: string | undefined
  try {
    gitSha = execSync('git rev-parse --short HEAD', { stdio: 'pipe' }).toString().trim()
  } catch {
    // Not in a git repo or git not available
  }

  history.unshift({
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    gitSha,
  })

  // Keep last 100 entries
  writeFileSync(historyPath, JSON.stringify(history.slice(0, 100), null, 2))
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Field {
  name: string
  type: string
  meta: Record<string, any>
  refTarget?: string
  refScope?: string
  zod: string
  default: string
  tsType: string
}

interface WriteScaffoldOptions {
  layer: string
  collection: string
  fields: Field[]
  dialect: string
  autoRelations: boolean
  dryRun: boolean
  noDb: boolean
  force?: boolean
  noTranslations?: boolean
  config?: Record<string, any> | null
  collectionConfig?: Record<string, any> | null
  hierarchy?: boolean
  seed?: boolean
  seedCount?: number
  noTests?: boolean
}

interface RunConfigOptions {
  configPath?: string
  force?: boolean
  dryRun?: boolean
  only?: string
  noAutoMerge?: boolean
  noTests?: boolean
}

interface RunGenerateOptions {
  layer?: string
  collection?: string
  fieldsFile?: string
  dialect?: string
  autoRelations?: boolean
  dryRun?: boolean
  noDb?: boolean
  force?: boolean
  noTranslations?: boolean
  hierarchy?: boolean
  seed?: boolean
  seedCount?: number
  noTests?: boolean
}

// ---------------------------------------------------------------------------
// Manifest-driven detection and contribution helpers
// ---------------------------------------------------------------------------

/**
 * Compute detection results from manifest detectors.
 * Replaces all hardcoded package-specific detection in generators.
 */
function computeDetection(
  fields: Field[],
  collectionConfig: Record<string, any> | null,
  detectors: Map<string, any>,
  layerCamelCase: string,
): DetectionResult {
  const allNonIdFields = fields.filter(f => f.name !== 'id')

  const mapsDetector = detectors.get('crouton-maps')
  const assetsDetector = detectors.get('crouton-assets')
  const editorDetector = detectors.get('crouton-editor')
  const collabDetector = detectors.get('crouton-collab')

  // Maps: address fields + coordinate field
  const addressFields = (mapsDetector?.fieldNamePatterns
    ? allNonIdFields.filter((f: Field) =>
      mapsDetector.fieldNamePatterns.some((p: string) => f.name.toLowerCase().includes(p.toLowerCase()))
    )
    : []) as unknown as DetectedField[]

  const coordinateFields = (mapsDetector?.coordinatePatterns
    ? allNonIdFields.filter((f: Field) =>
      mapsDetector.coordinatePatterns.some((p: string) => f.name.toLowerCase().includes(p.toLowerCase()))
    )
    : []) as unknown as DetectedField[]

  // Prefer 'location' / 'coordinates' / 'coords' as the coordinate field
  const coordinateField: DetectedField | null = coordinateFields.find(
    f => f.name === 'location' || f.name === 'coordinates' || f.name === 'coords'
  ) || coordinateFields[0] || null

  const hasAddress = addressFields.length > 0 && coordinateField !== null

  // Assets: image/file types and asset refTargets
  const assetFields = (assetsDetector
    ? allNonIdFields.filter((f: Field) => {
        if (assetsDetector.fieldTypes?.includes(f.type)) return true
        if (f.refTarget && assetsDetector.refTargetPatterns?.some(
          (p: string) => (f.refTarget as string).toLowerCase().includes(p.toLowerCase())
        )) return true
        return false
      })
    : []) as unknown as DetectedField[]

  // Pre-compute resolvedCollection for refTarget asset fields (used by contribution)
  for (const f of assetFields) {
    if (f.refTarget && !f.resolvedCollection) {
      const refCases = toCase(f.refTarget as string)
      f.resolvedCollection = `${layerCamelCase}${refCases.pascalCasePlural}`
    }
  }

  // Editor: fields using Editor component patterns
  const editorFields = (editorDetector?.componentPatterns
    ? allNonIdFields.filter((f: Field) =>
        f.meta?.component && editorDetector.componentPatterns.some((p: string) =>
          (f.meta!.component as string).includes(p)
        )
      )
    : []) as unknown as DetectedField[]

  // Collab: collection config flag
  const collabEnabled: boolean = collabDetector?.collectionConfigFlag
    ? collectionConfig?.[collabDetector.collectionConfigFlag] === true
    : false

  return {
    addressFields,
    coordinateField,
    hasAddress,
    assetFields,
    editorFields,
    collabEnabled,
  }
}

interface MergedFormEnhancement {
  excludeFieldNames: string[]
  groupInjections: Record<string, string>
  fieldOverrides: Record<string, string>
  scriptAdditions: string[]
}

interface MergedListEnhancement {
  cellTemplates: Record<string, string>
  collectionProps: string[]
  scriptAdditions: string[]
}

/**
 * Run all form contributions and merge their enhancements.
 */
function runFormContributions(
  contributions: Array<{ packageId: string; contribution: GeneratorContribution }>,
  data: Record<string, any>,
  dialect: string,
): MergedFormEnhancement {
  const result: MergedFormEnhancement = {
    excludeFieldNames: [],
    groupInjections: {},
    fieldOverrides: {},
    scriptAdditions: [],
  }

  const ctx = {
    fields: data.fields as DetectedField[],
    collectionConfig: data.collectionConfig,
    dialect: dialect as 'sqlite' | 'pg',
    detected: data.detected as DetectionResult,
    layerCamelCase: data.layerCamelCase as string,
  }

  for (const { contribution } of contributions) {
    if (!contribution.enhanceForm) continue
    const enhancement = contribution.enhanceForm(ctx)
    if (!enhancement) continue

    if (enhancement.excludeFieldNames) {
      result.excludeFieldNames.push(...enhancement.excludeFieldNames)
    }
    if (enhancement.groupInjections) {
      Object.assign(result.groupInjections, enhancement.groupInjections)
    }
    if (enhancement.fieldOverrides) {
      Object.assign(result.fieldOverrides, enhancement.fieldOverrides)
    }
    if (enhancement.scriptCode) {
      result.scriptAdditions.push(enhancement.scriptCode)
    }
  }

  return result
}

/**
 * Run all list contributions and merge their enhancements.
 */
function runListContributions(
  contributions: Array<{ packageId: string; contribution: GeneratorContribution }>,
  data: Record<string, any>,
  translatableFields: string[],
): MergedListEnhancement {
  const result: MergedListEnhancement = {
    cellTemplates: {},
    collectionProps: [],
    scriptAdditions: [],
  }

  const ctx = {
    fields: data.fields as DetectedField[],
    collectionConfig: { ...data.collectionConfig, translatableFieldNames: translatableFields },
    detected: data.detected as DetectionResult,
  }

  for (const { contribution } of contributions) {
    if (!contribution.enhanceList) continue
    const enhancement = contribution.enhanceList(ctx)
    if (!enhancement) continue

    if (enhancement.cellTemplates) {
      Object.assign(result.cellTemplates, enhancement.cellTemplates)
    }
    if (enhancement.collectionProps) {
      result.collectionProps.push(enhancement.collectionProps)
    }
    if (enhancement.scriptCode) {
      result.scriptAdditions.push(enhancement.scriptCode)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// parseArgs() removed in Phase 5 — args now passed as options from citty entry point

// Build the schema export names for a collection (layer-prefixed)
function buildSchemaExportNames(collectionName: string, layer: string) {
  const cases = toCase(collectionName)
  const layerCamelCase = layer
    .split(/[-_]/)
    .map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return {
    exportName: `${layerCamelCase}${cases.pascalCasePlural}`,
    importPath: `../../layers/${layer}/collections/${cases.plural}/server/database/schema`,
    schemaIndexPath: path.resolve('server', 'db', 'schema.ts')
  }
}

// Create database table using Drizzle
async function createDatabaseTable(config: { name: string; layer: string; fields?: Field[]; force?: boolean }): Promise<boolean> {
  const { name, layer, force = false } = config
  const cases = toCase(name)

  try {
    // Verify the schema file exists
    const schemaPath = path.resolve('layers', layer, 'collections', cases.plural, 'server', 'database', 'schema.ts')

    try {
      await fsp.access(schemaPath)
    } catch {
      console.error(`✗ Schema file not found at ${schemaPath}`)
      return false
    }

    // First, update the schema index to include the new collection
    console.log(`↻ Updating schema index...`)
    const { exportName, importPath: schemaImportPath, schemaIndexPath } = buildSchemaExportNames(name, layer)
    const schemaResult = await addNamedSchemaExport(schemaIndexPath, exportName, schemaImportPath, force)
    const schemaUpdated = schemaResult.added || schemaResult.reason === 'already exported'

    if (!schemaUpdated) {
      if (schemaResult.reason?.startsWith('conflicting')) {
        console.error(`⚠️  Warning: ${schemaResult.reason}`)
        console.error(`   Use --force to override or choose a different name.`)
      }
      console.error(`✗ Schema index update failed due to conflicts`)
      console.error(`  Skipping database migration to avoid errors`)
      console.error(`  You can:`)
      console.error(`  1. Use --force to override the conflict`)
      console.error(`  2. Manually resolve the conflict in server/db/schema.ts`)
      console.error(`  3. Choose a different collection name`)
      return false
    }

    if (schemaResult.created) {
      console.log('✓ Created server/db/schema.ts with auth schema')
    }
    if (schemaResult.added) {
      console.log(`✓ Updated schema index with ${exportName} export`)
    } else {
      console.log(`✓ Schema index already contains ${exportName} export`)
    }

    // Run db:generate to sync with database (with timeout)
    console.log(`↻ Creating database migration...`)
    console.log(`! Running: npx nuxt db generate (30s timeout)`)

    try {
      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Command timed out after 30 seconds')), 30000)
      })

      // Race between the command and timeout
      const { stdout, stderr } = await Promise.race([
        execAsync('npx nuxt db generate'),
        timeoutPromise
      ])

      if (stderr && !stderr.includes('Warning')) {
        console.error(`! Drizzle warnings:`, stderr)
      }
      console.log(`✓ Database migration generated`)

      // Note: The migration has been generated but needs to be applied
      console.log(`! Migration generated. The table will be created when you restart the dev server.`)

      return true
    } catch (execError: any) {
      if (execError.message.includes('timed out')) {
        console.error(`✗ Database migration timed out after 30 seconds`)
        console.error(`  This usually means there's a conflict or error in the schema`)
        console.error(`  Check server/db/schema.ts for duplicate exports`)
      } else {
        console.error(`✗ Failed to run database migration:`, execError.message)
      }
      console.log(`! You can manually run: npx nuxt db generate`)
      return false
    }
  } catch (error: any) {
    console.error(`✗ Failed to create database table:`, error.message)
    console.log(`! You may need to create the table manually with: npx nuxt db generate`)
    return false
  }
}

// Build the Zod fields-schema body shared by the composable and the server
// endpoints — regular + translatable fields, the hierarchy parentId, and the
// translations record with its default-locale required-fields refinement.
function buildFieldsSchema(params: {
  fields: Field[]
  config: Record<string, any> | null
  hierarchy: HierarchyConfig
  cases: any
  layerCamelCase: string
}): string {
  const { fields, config, hierarchy, cases, layerCamelCase } = params
  const translatableFieldNames = config?.translations?.collections?.[cases.plural] || []
  const hierarchyFieldNames = hierarchy?.enabled ? ['parentId', 'path', 'depth', 'order'] : []
  const regularFieldsSchema = fields
    .filter(f => f.name !== 'id' && !translatableFieldNames.includes(f.name) && !hierarchyFieldNames.includes(f.name))
    .map((f) => {
      const isDependentField = (f.meta?.dependsOn && f.meta?.dependsOnCollection) || f.meta?.displayAs === 'slotButtonGroup'
      const hasRepeaterProperties = f.type === 'repeater' && (f.meta?.translatableProperties || f.meta?.properties)
      let baseZod = isDependentField ? 'z.array(z.string())' : f.zod
      // Dates arrive as ISO strings (forms/JSON) — coerce so validation accepts them.
      if (f.type === 'date') baseZod = 'z.coerce.date()'
      if (hasRepeaterProperties) {
        const { pascalCase: fieldPascalCase } = toCase(f.name)
        const itemSchemaName = `${layerCamelCase}${cases.pascalCasePlural}${fieldPascalCase}ItemSchema`
        baseZod = `z.array(${itemSchemaName})`
      }
      if (f.meta?.required) {
        if (isDependentField) {
          return `${f.name}: ${baseZod}.min(1, '${f.name} is required')`
        } else if (f.type === 'date') {
          // z.coerce.date() (no Zod-3 `required_error`, which is invalid in Zod 4)
          return `${f.name}: ${baseZod}`
        } else if (f.type === 'string' || f.type === 'text') {
          return `${f.name}: ${baseZod}.min(1, '${f.name} is required')`
        } else if (f.type === 'number' || f.type === 'decimal') {
          return `${f.name}: ${baseZod}`
        } else if (f.type === 'boolean') {
          return `${f.name}: ${baseZod}`
        } else if (f.type === 'json') {
          return `${f.name}: ${baseZod}`
        } else if (f.type === 'repeater') {
          return `${f.name}: ${baseZod}`
        } else {
          return `${f.name}: ${baseZod}`
        }
      } else {
        // json commonly arrives as null (empty config/metadata) — allow it.
        const suffix = (f.meta?.nullable || f.type === 'json' || f.type === 'date') ? '.nullish()' : '.optional()'
        return `${f.name}: ${baseZod}${suffix}`
      }
    })
  const translatableFieldsSchema = fields
    .filter(f => translatableFieldNames.includes(f.name))
    .map(f => `${f.name}: ${f.zod}.optional()`)
  let allFieldsSchema = [...regularFieldsSchema, ...translatableFieldsSchema].join(',\n  ')
  if (hierarchy?.enabled) {
    const hierarchySchemaField = `parentId: z.string().nullable().optional()`
    allFieldsSchema = allFieldsSchema ? `${allFieldsSchema},\n  ${hierarchySchemaField}` : hierarchySchemaField
  }
  if (translatableFieldNames.length > 0) {
    const translatableFields = fields.filter(f => translatableFieldNames.includes(f.name))
    const requiredTranslatableFields = translatableFields.filter(f => f.meta?.required)
    const translationsFieldSchema = translatableFields.map((f) => {
      if (f.meta?.required) {
        return `      ${f.name}: z.string().min(1, '${f.name.charAt(0).toUpperCase() + f.name.slice(1)} is required')`
      } else {
        return `      ${f.name}: z.string().optional()`
      }
    }).join(',\n')
    // Validate the app's default locale (not a hardcoded 'en') — single-language
    // apps (e.g. defaultLocale: 'nl') must validate that locale, not English.
    const defaultLocale = config?.defaultLocale || 'en'
    const requiredFieldsCheck = requiredTranslatableFields.length > 0
      ? `.refine(
    (translations) => translations.${defaultLocale} && ${requiredTranslatableFields.map(f => `translations.${defaultLocale}.${f.name}`).join(' && ')},
    { message: 'Translations for ${requiredTranslatableFields.map(f => f.name).join(', ')} (${defaultLocale}) are required' }
  )`
      : ''
    return `${allFieldsSchema},\n  translations: z.record(
    z.string(),
    z.object({
${translationsFieldSchema}
    })
  )${requiredFieldsCheck}`
  }
  return allFieldsSchema
}

// Build the default-values object body for the generated form state.
function buildFieldsDefault(params: {
  fields: Field[]
  config: Record<string, any> | null
  hierarchy: HierarchyConfig
  cases: any
}): string {
  const { fields, config, hierarchy, cases } = params
  const hierarchyDefaultNames = hierarchy?.enabled ? ['parentId', 'path', 'depth', 'order'] : []
  let fieldDefaults = fields.filter(f => f.name !== 'id' && !hierarchyDefaultNames.includes(f.name)).map((f) => {
    const isDependentField = (f.meta?.dependsOn && f.meta?.dependsOnCollection) || f.meta?.displayAs === 'slotButtonGroup'
    if (isDependentField) {
      return `${f.name}: null`
    }
    return `${f.name}: ${f.default}`
  }).join(',\n    ')
  if (hierarchy?.enabled) {
    fieldDefaults = fieldDefaults ? `${fieldDefaults},\n    parentId: null` : 'parentId: null'
  }
  const hasTranslations = config?.translations?.collections?.[cases.plural]?.length > 0
  return hasTranslations ? `${fieldDefaults},\n    translations: {}` : fieldDefaults
}

// Build the table-columns array body for the generated list component.
function buildFieldsColumns(fields: Field[], config: Record<string, any> | null, cases: any): string {
  const baseColumns = fields.map(f =>
    `{ accessorKey: '${f.name}', header: '${f.name.charAt(0).toUpperCase() + f.name.slice(1)}' }`
  ).join(',\n  ')
  const hasTranslations = config?.translations?.collections?.[cases.plural]?.length > 0
  const translationsColumn = hasTranslations
    ? ',\n  { accessorKey: \'translations\', header: \'Translations\' }'
    : ''
  return baseColumns + translationsColumn
}

// Build the TypeScript interface body for the generated types.ts, keeping the
// optional/null-ness of each property in sync with the Zod schema.
function buildFieldsTypes(params: {
  fields: Field[]
  config: Record<string, any> | null
  hierarchy: HierarchyConfig
  cases: any
}): string {
  const { fields, config, hierarchy, cases } = params
  const translatableFieldNames = config?.translations?.collections?.[cases.plural] || []
  const typeLines = fields.filter(f => f.name !== 'id').map((f) => {
    const isDependentField = (f.meta?.dependsOn && f.meta?.dependsOnCollection) || f.meta?.displayAs === 'slotButtonGroup'
    let tsType = isDependentField ? 'string[] | null' : f.tsType
    if (f.meta?.required) {
      // Required ⇒ the zod schema enforces a present, non-null value, so the
      // interface must not widen to null (some tsTypes, e.g. date, default to
      // `T | null`). Otherwise FormData/New<Type> reject the validated body.
      tsType = tsType.replace(/\s*\|\s*null\b/g, '')
    } else if ((f.meta?.nullable || f.type === 'json') && !tsType.includes('null')) {
      // Non-required json/nullable fields are `.nullish()` in the zod schema
      // (the body may be null) — the interface must allow null to match.
      tsType += ' | null'
    }
    // Translatable fields are validated as optional in the zod schema (the real
    // value lives in translations.<locale>; the root column is a cache/fallback) —
    // keep the interface optional to match, otherwise New<Type> rejects the body.
    const optional = !f.meta?.required || translatableFieldNames.includes(f.name)
    return `${f.name}${optional ? '?' : ''}: ${tsType}`
  })
  // Hierarchy system fields (parentId/path/depth/order) live in the DB schema and
  // are set by the generated POST endpoint, but aren't declared collection fields —
  // include them so New<Type> (used by create*) accepts them.
  if (hierarchy?.enabled) {
    typeLines.push(
      `${hierarchy.parentField || 'parentId'}?: string | null`,
      `${hierarchy.pathField || 'path'}?: string`,
      `${hierarchy.depthField || 'depth'}?: number`,
      `${hierarchy.orderField || 'order'}?: number`
    )
  }
  return typeLines.join('\n  ')
}

function buildGeneratorData(params: {
  layer: string
  collection: string
  fields: Field[]
  hierarchy: { enabled: boolean; parentField?: string; orderField?: string; pathField?: string; depthField?: string }
  sortable: { enabled: boolean; orderField?: string }
  collab: { enabled: boolean }
  config: Record<string, any> | null
  collectionConfig: Record<string, any> | null
}) {
  const { layer, collection, fields, hierarchy, sortable, collab, config, collectionConfig } = params
  const cases = toCase(collection)
  const layerPascalCase = layer
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  const layerCamelCase = layer
    .split(/[-_]/)
    .map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

  const fieldsSchema = buildFieldsSchema({ fields, config, hierarchy, cases, layerCamelCase })

  const fieldsDefault = buildFieldsDefault({ fields, config, hierarchy, cases })

  const fieldsColumns = buildFieldsColumns(fields, config, cases)

  const fieldsTypes = buildFieldsTypes({ fields, config, hierarchy, cases })

  // Repeater fields with properties reference a named item schema (e.g.
  // `...SlotItemSchema`) in fieldsSchema. The composable exports those, but
  // server endpoints (POST/PATCH) validate the same body and need the schema
  // defined locally — without this they'd reference an undefined symbol and
  // the app 500s on boot. Emit the definitions as plain `const` for the server.
  const repeaterItemSchemasCode = fields
    .filter(f => f.type === 'repeater' && (f.meta?.translatableProperties || f.meta?.properties))
    .map(f => generateRepeaterItemSchema(f, layerCamelCase, cases.pascalCasePlural).code.replace(/^export /, ''))
    .join('\n\n')

  return {
    ...cases,
    originalCollectionName: collection,
    layer,
    layerPascalCase,
    layerCamelCase,
    fields,
    fieldsSchema,
    repeaterItemSchemasCode,
    fieldsDefault,
    fieldsColumns,
    fieldsTypes,
    hierarchy,
    sortable,
    collab,
    collectionConfig,
    display: collectionConfig?.display || null,
    publishable: collectionConfig?.publishable || false,
    kind: collectionConfig?.kind || 'data'
  }
}

// ---------------------------------------------------------------------------
// writeScaffold helpers — one per scaffold step
// ---------------------------------------------------------------------------

interface GeneratedFile {
  path: string
  content: string
}

interface HierarchyConfig {
  enabled: boolean
  parentField?: string
  orderField?: string
  pathField?: string
  depthField?: string
}

interface SortableConfig {
  enabled: boolean
  orderField?: string
}

// Resolve the structural options (hierarchy / sortable / collab) from the
// collection config or CLI flag.
function resolveStructureConfig(collectionConfig: Record<string, any> | null, hierarchyFlag: boolean): { hierarchy: HierarchyConfig; sortable: SortableConfig; collab: { enabled: boolean } } {
  // Detect hierarchy configuration from collection config or CLI flag
  const hierarchy: HierarchyConfig = collectionConfig?.hierarchy === true || hierarchyFlag === true
    ? {
        enabled: true,
        parentField: 'parentId',
        orderField: 'order',
        pathField: 'path',
        depthField: 'depth'
      }
    : (typeof collectionConfig?.hierarchy === 'object'
        ? {
            enabled: true,
            parentField: collectionConfig.hierarchy.parentField || 'parentId',
            orderField: collectionConfig.hierarchy.orderField || 'order',
            pathField: collectionConfig.hierarchy.pathField || 'path',
            depthField: collectionConfig.hierarchy.depthField || 'depth'
          }
        : { enabled: false })

  // Detect sortable configuration (simpler than hierarchy, just needs order field for drag-and-drop)
  const sortable: SortableConfig = collectionConfig?.sortable === true
    ? {
        enabled: true,
        orderField: collectionConfig.orderField || 'order'
      }
    : (typeof collectionConfig?.sortable === 'object'
        ? {
            enabled: true,
            orderField: collectionConfig.sortable.orderField || 'order'
          }
        : { enabled: false })

  // Detect collab configuration (enables presence indicators in List.vue)
  const collab = collectionConfig?.collab === true
    ? { enabled: true }
    : { enabled: false }

  return { hierarchy, sortable, collab }
}

// Handle translation configuration.
// Priority: 1) field-level meta.translatable, 2) collection-level translatable, 3) config.translations.collections
// Returns the (possibly created or replaced) config object; when translatable
// fields are found, the existing config's translations map is updated in place
// so the caller's config object observes the merged field list.
function resolveTranslationConfig(params: {
  fields: Field[]
  config: Record<string, any> | null
  collectionConfig: Record<string, any> | null
  noTranslations: boolean
  plural: string
}): Record<string, any> | null {
  const { fields, collectionConfig, noTranslations, plural } = params
  let { config } = params

  if (!noTranslations) {
    // Check for field-level translatable markers (meta.translatable: true)
    const fieldLevelTranslatable = fields
      .filter(f => f.meta?.translatable === true)
      .map(f => f.name)

    // Check for collection-level translatable flag (auto-detect common patterns)
    let collectionLevelTranslatable = []
    if (collectionConfig?.translatable === true) {
      const autoDetectFieldNames = ['name', 'title', 'description', 'label',
        'placeholder', 'helpText', 'content', 'message',
        'remarkPrompt', 'terms', 'conditions', 'notes']
      collectionLevelTranslatable = fields
        .filter(f => autoDetectFieldNames.includes(f.name)
          && (f.type === 'string' || f.type === 'text' || f.type === 'richText'))
        .map(f => f.name)
    }

    // Get config-level translatable fields
    const configLevelTranslatable = config?.translations?.collections?.[plural] || []

    // Merge all sources (field-level takes precedence, then collection-level, then config-level)
    const allTranslatableFields = [...new Set([
      ...fieldLevelTranslatable,
      ...collectionLevelTranslatable,
      ...configLevelTranslatable
    ])]

    if (allTranslatableFields.length > 0) {
      // Ensure config object exists
      if (!config) {
        config = {}
      }
      if (!config.translations) {
        config.translations = { collections: {} }
      }
      if (!config.translations.collections) {
        config.translations.collections = {}
      }
      config.translations.collections[plural] = allTranslatableFields

      // Log the source of translatable fields
      if (fieldLevelTranslatable.length > 0) {
        console.log(`↻ Field-level translatable: ${fieldLevelTranslatable.join(', ')}`)
      }
      if (collectionLevelTranslatable.length > 0) {
        console.log(`↻ Auto-detected translatable (collection-level): ${collectionLevelTranslatable.join(', ')}`)
      }
      if (configLevelTranslatable.length > 0 && fieldLevelTranslatable.length === 0 && collectionLevelTranslatable.length === 0) {
        console.log(`↻ Config-level translatable: ${configLevelTranslatable.join(', ')}`)
      }
    }
  } else if (noTranslations && config) {
    // Override config to disable translations if flag is set
    config = {
      ...config,
      translations: { collections: {} } // Clear all translation configurations
    }
  }

  return config
}

// Check for required modules/dependencies; aborts (exit 1) when dependencies
// are missing and --force is not set.
async function ensureRequiredDependencies(config: Record<string, any> | null, noTranslations: boolean, force: boolean): Promise<void> {
  console.log('↻ Checking for required dependencies...')
  const dependencies = await detectRequiredDependencies({
    ...config,
    noTranslations
  })

  if (dependencies.missing.length > 0) {
    const shouldContinue = displayMissingDependencies(dependencies)
    if (!shouldContinue && !force) {
      console.error('⚠️  Aborting: Missing required dependencies')
      console.error('   Use --force to generate anyway (may result in broken code)')
      process.exit(1)
    }
    if (force) {
      console.warn('⚠️  Continuing with --force despite missing dependencies')
    }
  } else {
    console.log('✓ All required dependencies found')
    // Ensure layers are extended in nuxt.config
    await ensureLayersExtended(dependencies.layers)
  }
}

// Manifest-driven detection + contributions: compute detection results, run the
// relevant packages' contribution functions, and attach the merged form/list
// enhancements to the generator data. Returns the (possibly updated)
// collectionConfig — a package contribution can auto-detect the form component.
async function applyManifestEnhancements(params: {
  data: Record<string, any>
  fields: Field[]
  config: Record<string, any> | null
  collectionConfig: Record<string, any> | null
  dialect: string
  collection: string
}): Promise<Record<string, any> | null> {
  const { data, fields, config, dialect, collection } = params
  let { collectionConfig } = params
  const { layerCamelCase } = data

  // Discover manifests (cached after first call) and compute detection results
  const manifests = await discoverManifests()
  const detectors = await getGeneratorDetectors(manifests)
  data.detected = computeDetection(fields, collectionConfig, detectors, layerCamelCase)

  // Run contribution functions and attach enhancement results to data
  // Include: core packages, explicitly enabled features, AND packages whose detector matched fields
  const allContributions = await getGeneratorContributions(manifests)
  const enabledFeatures = new Set(Object.keys(config?.features || {}))
  const corePackages = new Set(['crouton-core', 'crouton-auth', 'crouton-admin', 'crouton-i18n', 'crouton-bookings', 'crouton-pages'])

  // Auto-include packages that detected matching fields in this collection's schema
  const detected = data.detected as DetectionResult
  const detectedPackages = new Set<string>()
  if (detected.editorFields?.length) detectedPackages.add('crouton-editor')
  if (detected.assetFields?.length) detectedPackages.add('crouton-assets')
  if (detected.hasAddress) detectedPackages.add('crouton-maps')
  if (detected.collabEnabled) detectedPackages.add('crouton-collab')

  const contributions = allContributions.filter(({ packageId }) =>
    corePackages.has(packageId)
    || enabledFeatures.has(packageId.replace(/^crouton-/, ''))
    || detectedPackages.has(packageId)
  )
  // Auto-detect formComponent from package contributions (when not explicitly configured).
  // Scope to `contributions` (core + enabled features + detector-matched), NOT
  // `allContributions` — otherwise a package the app doesn't use (e.g. crouton-sales
  // reserving "location"/"product"/"category"/"printer") forces its bespoke form on
  // an unrelated collection and skips Form.vue generation (#558).
  if (!collectionConfig?.formComponent) {
    const formComponentCtx = { collectionName: collection, fields, detected }
    for (const { contribution } of contributions) {
      const result = contribution.getFormComponent?.(formComponentCtx)
      if (result) {
        collectionConfig = { ...collectionConfig, formComponent: result }
        data.collectionConfig = collectionConfig
        console.log(`✓ Auto-detected form component: ${result}`)
        break
      }
    }
  }

  const translatableFieldNames = config?.translations?.collections?.[toCase(collection).plural] || []
  data.formEnhancements = runFormContributions(contributions, data, dialect)
  data.listEnhancements = runListContributions(contributions, data, translatableFieldNames)

  return collectionConfig
}

// Print the dry-run plan (what would be generated) without writing anything.
function printDryRunPlan(params: {
  base: string
  layer: string
  cases: any
  layerPascalCase: string
  hierarchy: HierarchyConfig
  collectionConfig: Record<string, any> | null
  fields: Field[]
  seed: boolean
  seedCount: number
  noTests: boolean
  noDb: boolean
}): void {
  const { base, layer, cases, layerPascalCase, hierarchy, collectionConfig, fields, seed, seedCount, noTests, noDb } = params
  const apiPath = `${layer}-${cases.plural}`
  console.log('DRY RUN - Would generate:')
  if (hierarchy.enabled) {
    console.log(`\n🌳 HIERARCHY ENABLED - Additional files will be generated:`)
    console.log(`   • Database fields: parentId, path, depth, order`)
    console.log(`   • Tree queries: getTreeData(), updatePosition(), reorderSiblings()`)
    console.log(`   • API endpoints: [id]/move.patch.ts, reorder.patch.ts`)
    console.log(`   • Form: Parent picker component\n`)
  }
  if (!collectionConfig?.formComponent) {
    console.log(`• ${base}/app/components/Form.vue`)
  } else {
    console.log(`• Form.vue skipped (using ${collectionConfig.formComponent})`)
  }
  console.log(`• ${base}/app/components/List.vue`)

  // Show repeater components
  const repeaterFields = fields.filter(f => f.type === 'repeater')
  const repeaterComponents = new Set()
  for (const field of repeaterFields) {
    const componentName = field.meta?.repeaterComponent
    if (componentName && !repeaterComponents.has(componentName)) {
      repeaterComponents.add(componentName)
      console.log(`• ${base}/app/components/${componentName}.vue [PLACEHOLDER]`)
    }
  }

  console.log(`• ${base}/app/composables/use${layerPascalCase}${cases.pascalCasePlural}.ts`)
  console.log(`• ${base}/server/api/teams/[id]/${apiPath}/index.get.ts`)
  console.log(`• ${base}/server/api/teams/[id]/${apiPath}/index.post.ts`)
  console.log(`• ${base}/server/api/teams/[id]/${apiPath}/[${cases.camelCase}Id].patch.ts`)
  console.log(`• ${base}/server/api/teams/[id]/${apiPath}/[${cases.camelCase}Id].delete.ts`)
  if (hierarchy.enabled) {
    console.log(`• ${base}/server/api/teams/[id]/${apiPath}/[${cases.camelCase}Id]/move.patch.ts`)
    console.log(`• ${base}/server/api/teams/[id]/${apiPath}/reorder.patch.ts`)
  }
  console.log(`• ${base}/server/database/queries.ts`)
  console.log(`• ${base}/server/database/schema.ts`)
  if (seed) {
    console.log(`• ${base}/server/database/seed.ts (${seedCount} records)`)
  }
  console.log(`• ${base}/types.ts`)
  if (!noTests) {
    console.log(`• ${base}/${layerPascalCase}${cases.pascalCasePlural}.test.ts (schema smoke)`)
    console.log(`• ${base}/${layerPascalCase}${cases.pascalCasePlural}.api.test.ts (route handlers)`)
  }
  console.log(`• ${base}/nuxt.config.ts`)
  console.log(`• layers/${layer}/nuxt.config.ts (layer root config)`)
  console.log(`• nuxt.config.ts (root config - add layer to extends)`)
  if (!noDb) {
    console.log(`• Would update server/db/schema.ts`)
    console.log(`• Would generate database migration`)
  }

  if (repeaterComponents.size > 0) {
    console.log(`\n• Would generate ${repeaterComponents.size} placeholder repeater component(s):`)
    repeaterComponents.forEach((name) => {
      console.log(`   - ${name}.vue`)
    })
  }
}

// Resolve the collection's API path segment.
// For system collections, use simplified naming without layer prefix.
function resolveApiPath(layer: string, collection: string, cases: any): string {
  if (layer.startsWith('crouton-')) {
    // System collection: use crouton-<collection_name> format
    // e.g., crouton-events + collectionEvents -> crouton-collection-events
    return toSnakeCase(`crouton_${collection}`).replace(/_/g, '-')
  }
  // Use layer-prefixed API path
  return `${layer}-${cases.plural}`
}

// Create the collection's directory structure.
async function createCollectionDirs(base: string, apiPath: string, hierarchy: HierarchyConfig, cases: any): Promise<void> {
  const dirs = [
    path.join(base, 'app', 'components'),
    path.join(base, 'app', 'composables'),
    path.join(base, 'server', 'api', 'teams', '[id]', apiPath),
    path.join(base, 'server', 'database')
  ]

  // Add subdirectory for move endpoint when hierarchy is enabled
  if (hierarchy.enabled) {
    dirs.push(path.join(base, 'server', 'api', 'teams', '[id]', apiPath, `[${cases.camelCase}Id]`))
  }

  for (const dir of dirs) {
    await fsp.mkdir(dir, { recursive: true })
  }

  console.log('✓ Directory structure created')
}

// Map every configured collection name to its layer (used by the queries
// generator to resolve cross-collection references).
function buildCollectionLayerMap(config: Record<string, any> | null): Map<string, string> {
  const map = new Map<string, string>()
  if (config?.targets) {
    for (const t of config.targets) {
      for (const c of t.collections) {
        map.set(c.toLowerCase(), t.layer)
      }
    }
  }
  return map
}

// Build the core file set every collection gets: components, composable, CRUD
// endpoints (+ hierarchy/sortable endpoints), queries, schema, types, the layer
// nuxt.config and README.
function buildCoreScaffoldFiles(params: {
  base: string
  apiPath: string
  data: Record<string, any>
  config: Record<string, any> | null
  collectionConfig: Record<string, any> | null
  dialect: string
  layer: string
  cases: any
  layerPascalCase: string
  hierarchy: HierarchyConfig
  sortable: SortableConfig
}): GeneratedFile[] {
  const { base, apiPath, data, config, collectionConfig, dialect, layer, cases, layerPascalCase, hierarchy, sortable } = params

  // All endpoints now use @crouton/auth for team-based authentication
  const files: GeneratedFile[] = [
    // Only generate Form.vue if no custom formComponent specified
    ...(collectionConfig?.formComponent ? [] : [{
      path: path.join(base, 'app', 'components', '_Form.vue'),
      content: generateFormComponent(data, config)
    }]),
    {
      path: path.join(base, 'app', 'components', 'List.vue'),
      content: generateListComponent(data, config)
    },
    {
      path: path.join(base, 'app', 'composables', `use${layerPascalCase}${cases.pascalCasePlural}.ts`),
      content: generateComposable(data, config)
    },
    {
      path: path.join(base, 'server', 'api', 'teams', '[id]', apiPath, 'index.get.ts'),
      content: generateGetEndpoint(data, config)
    },
    {
      path: path.join(base, 'server', 'api', 'teams', '[id]', apiPath, 'index.post.ts'),
      content: generatePostEndpoint(data, config)
    },
    {
      path: path.join(base, 'server', 'api', 'teams', '[id]', apiPath, `[${cases.camelCase}Id].patch.ts`),
      content: generatePatchEndpoint(data, config)
    },
    {
      path: path.join(base, 'server', 'api', 'teams', '[id]', apiPath, `[${cases.camelCase}Id].delete.ts`),
      content: generateDeleteEndpoint(data, config)
    },
    {
      path: path.join(base, 'server', 'database', 'queries.ts'),
      content: generateQueries(data, config, layer, buildCollectionLayerMap(config))
    },
    {
      path: path.join(base, 'server', 'database', 'schema.ts'),
      content: generateSchema(data, dialect, config)
    },
    {
      path: path.join(base, 'types.ts'),
      content: generateTypes(data, config)
    },
    {
      path: path.join(base, 'nuxt.config.ts'),
      content: generateNuxtConfig(data)
    },
    {
      path: path.join(base, 'README.md'),
      content: generateCollectionReadme(data, config)
    }
  ]

  // Add hierarchy endpoint files when hierarchy is enabled
  if (hierarchy.enabled) {
    files.push(
      {
        path: path.join(base, 'server', 'api', 'teams', '[id]', apiPath, `[${cases.camelCase}Id]`, 'move.patch.ts'),
        content: generateMoveEndpoint(data, config)
      },
      {
        path: path.join(base, 'server', 'api', 'teams', '[id]', apiPath, 'reorder.patch.ts'),
        content: generateReorderEndpoint(data, config)
      }
    )
  } else if (sortable.enabled) {
    // Add reorder endpoint only for sortable collections (no move endpoint needed for simple sorting)
    files.push({
      path: path.join(base, 'server', 'api', 'teams', '[id]', apiPath, 'reorder.patch.ts'),
      content: generateReorderEndpoint(data, config)
    })
  }

  return files
}

// Detect repeater fields and generate their field components (Input / Select /
// CardMini). These are the source fields that other collections will depend on.
// Creates each field's component folder as a side effect.
async function buildRepeaterComponentFiles(base: string, fields: Field[], data: Record<string, any>): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = []
  const repeaterFields = fields.filter(f => f.type === 'repeater')
  const generatedFieldComponents = new Set()

  for (const field of repeaterFields) {
    if (!generatedFieldComponents.has(field.name)) {
      generatedFieldComponents.add(field.name)

      // Generate folder name in PascalCase (e.g., 'slots' -> 'Slot')
      const fieldCases = toCase(field.name)
      const fieldFolderName = fieldCases.pascalCase

      // Create Field folder directory
      const fieldFolderPath = path.join(base, 'app', 'components', fieldFolderName)
      await fsp.mkdir(fieldFolderPath, { recursive: true })

      // Generate all three field components (pass full field object for translatableProperties support)
      const { input, select, cardMini } = generateFieldComponents(field, data)

      files.push({
        path: path.join(fieldFolderPath, 'Input.vue'),
        content: input
      })
      files.push({
        path: path.join(fieldFolderPath, 'Select.vue'),
        content: select
      })
      files.push({
        path: path.join(fieldFolderPath, 'CardMini.vue'),
        content: cardMini
      })
    }
  }

  return files
}

// Build the seed artifacts: the optional drizzle-seed seed.ts (--seed) and the
// always-emitted editable seed.json fixture (#298).
function buildSeedFiles(params: {
  base: string
  data: Record<string, any>
  config: Record<string, any> | null
  seed: boolean
  seedCount: number
}): GeneratedFile[] {
  const { base, data, config, seed, seedCount } = params
  const files: GeneratedFile[] = []

  // Generate seed file if --seed flag is enabled
  if (seed) {
    files.push({
      path: path.join(base, 'server', 'database', 'seed.ts'),
      content: generateSeedFile(data, {
        seedCount,
        teamId: config?.seed?.defaultTeamId || 'seed-team'
      })
    })
    console.log(`  Generating seed.ts (${seedCount} records)`)
  }

  // Always emit an editable seed.json fixture with a few auto-derived sample
  // rows, so a freshly deployed app's public surfaces aren't empty (#298). The
  // app seed runner (crouton-seed) loads it; edit it to replace the samples with
  // real content. Skipped for hierarchy collections (returns null).
  const seedFixture = generateSeedFixture(data)
  if (seedFixture) {
    files.push({
      path: path.join(base, 'seed.json'),
      content: `${JSON.stringify(seedFixture, null, 2)}\n`,
    })
    console.log(`  Generating seed.json (${seedFixture.rows.length} sample rows)`)
  }

  return files
}

// Build the per-collection tests — the schema-smoke test (#785) and the API
// route handler test (#791). Caller gates on --no-tests.
function buildCollectionTestFiles(params: {
  base: string
  data: Record<string, any>
  config: Record<string, any> | null
  cases: any
  layerPascalCase: string
}): GeneratedFile[] {
  const { base, data, config, cases, layerPascalCase } = params
  const files: GeneratedFile[] = []

  // Emit a schema-smoke test next to the collection (#785) — on by default,
  // suppressed by --no-tests. Runtime-free (zod only): asserts the generated
  // Zod schema accepts a valid record and rejects an invalid one. The e2e
  // fixture smoke owns boot + CRUD; this is the unit-level complement.
  files.push({
    path: path.join(base, `${layerPascalCase}${cases.pascalCasePlural}.test.ts`),
    content: generateCollectionTest(data, config),
  })
  console.log(`  Generating ${layerPascalCase}${cases.pascalCasePlural}.test.ts (schema smoke)`)

  // Emit the API route handler test (#791) — the depth deferred from #788.
  // Drives the generated handlers with mocked team-auth + queries and a fake
  // H3 event to cover team-scoping (unauth → rejected; queries called with the
  // resolved team id) and error paths (invalid body → rejected, missing id →
  // 400, not-found → 404). Same --no-tests gate.
  files.push({
    path: path.join(base, `${layerPascalCase}${cases.pascalCasePlural}.api.test.ts`),
    content: generateApiTest(data, config),
  })
  console.log(`  Generating ${layerPascalCase}${cases.pascalCasePlural}.api.test.ts (route handlers)`)

  return files
}

// Update the layer root nuxt.config (extend the new collection, wire i18n when
// translations are enabled) and add the layer to the root nuxt.config extends.
async function updateLayerAndRootConfigs(params: {
  layer: string
  collection: string
  config: Record<string, any> | null
  cases: any
}): Promise<void> {
  const { layer, collection, config, cases } = params

  // Check if we're using translations
  const hasTranslations = config?.translations?.collections?.[cases.plural]?.length > 0

  // Extract locale codes from config (default: en, nl, fr for backward compat)
  const localeCodes: string[] = config?.locales?.length
    ? config.locales.map((l: any) => typeof l === 'string' ? l : l.code)
    : ['en']

  // Update layer root nuxt.config.ts to extend the new collection (and translations layer if needed)
  await updateLayerRootConfig(layer, collection, hasTranslations, localeCodes)

  // Create i18n locale files when translations are enabled
  if (hasTranslations) {
    await setupLayerI18n(layer, collection, localeCodes)
  }

  // Update root nuxt.config.ts to extend the layer
  const rootConfigPath = path.resolve('nuxt.config.ts')
  const nuxtResult = await addToNuxtConfigExtends(rootConfigPath, `./layers/${layer}`)
  if (nuxtResult.added) {
    console.log(`✓ Updated root nuxt.config.ts to extend layer '${layer}'`)
  } else if (nuxtResult.reason === 'already in config') {
    console.log(`✓ Root nuxt.config.ts already extends layer '${layer}'`)
  } else {
    console.error(`! Could not update root nuxt.config.ts: ${nuxtResult.reason}`)
    console.log(`  Please manually add './layers/${layer}' to the extends array`)
  }
}

// Register the collection in the app.config crouton collections registry.
async function registerCollectionInAppConfig(params: {
  layer: string
  cases: any
  layerPascalCase: string
  layerCamelCase: string
}): Promise<void> {
  const { layer, cases, layerPascalCase, layerCamelCase } = params
  const collectionKey = `${layerCamelCase}${cases.pascalCasePlural}`
  const configExportName = `${layerCamelCase}${cases.pascalCasePlural}Config`
  const registryPath = await resolveAppConfigPath()
  const composablePath = path.resolve('layers', layer, 'collections', cases.plural, 'app', 'composables', `use${layerPascalCase}${cases.pascalCasePlural}.ts`)
  const rel = path.relative(path.dirname(registryPath), composablePath).replace(/\\/g, '/')
  const importSource = (rel.startsWith('.') ? rel : `./${rel}`).replace(/(\.ts|\.mts|\.cts|\.js|\.mjs|\.cjs)$/, '')
  const registryResult = await addToAppConfig(registryPath, collectionKey, configExportName, importSource)
  if (registryResult.created) {
    console.log(`↻ Creating app.config.ts with crouton collections`)
    console.log(`✓ Created app.config.ts with "${collectionKey}" entry`)
  } else if (registryResult.added) {
    console.log(`✓ Updated app.config.ts with "${collectionKey}" entry`)
  } else if (registryResult.reason === 'already registered') {
    console.log(`✓ Collection "${collectionKey}" already in registry`)
  } else {
    console.error(`Failed to update registry: ${registryResult.reason}`)
  }
}

async function writeScaffold({ layer, collection, fields, dialect, autoRelations, dryRun, noDb, force = false, noTranslations = false, config = null, collectionConfig = null, hierarchy: hierarchyFlag = false, seed = false, seedCount = 25, noTests = false }: WriteScaffoldOptions): Promise<void> {
  const cases = toCase(collection)
  const base = path.resolve('layers', layer, 'collections', cases.plural)

  // Detect structural options (hierarchy / sortable / collab)
  const { hierarchy, sortable, collab } = resolveStructureConfig(collectionConfig, hierarchyFlag)

  // Handle translation configuration
  config = resolveTranslationConfig({ fields, config, collectionConfig, noTranslations, plural: cases.plural })

  // Check for required modules/dependencies
  await ensureRequiredDependencies(config, noTranslations, force)

  // Prepare data for all generators
  // Typed as Record<string, any> so contribution results can be attached dynamically
  const data: Record<string, any> = buildGeneratorData({ layer, collection, fields, hierarchy, sortable, collab, config, collectionConfig })
  const { layerPascalCase, layerCamelCase } = data

  // Manifest-driven detection + contributions (may auto-detect the form component)
  collectionConfig = await applyManifestEnhancements({ data, fields, config, collectionConfig, dialect, collection })

  if (dryRun) {
    printDryRunPlan({ base, layer, cases, layerPascalCase, hierarchy, collectionConfig, fields, seed, seedCount, noTests, noDb })
    return
  }

  // Create directories
  const apiPath = resolveApiPath(layer, collection, cases)
  await createCollectionDirs(base, apiPath, hierarchy, cases)

  // Generate all files using modules
  const files: GeneratedFile[] = [
    ...buildCoreScaffoldFiles({ base, apiPath, data, config, collectionConfig, dialect, layer, cases, layerPascalCase, hierarchy, sortable }),
    ...await buildRepeaterComponentFiles(base, fields, data),
    ...buildSeedFiles({ base, data, config, seed, seedCount }),
    ...(noTests ? [] : buildCollectionTestFiles({ base, data, config, cases, layerPascalCase }))
  ]

  // Write all files
  for (const file of files) {
    await fsp.writeFile(file.path, file.content, 'utf8')
    console.log(`  ✓ ${path.relative(base, file.path)}`)
  }

  // Note: team-auth utility is now provided by @fyit/crouton package
  // No need to generate it per-layer

  // Update the layer root + root nuxt.config (and i18n locale files when needed)
  await updateLayerAndRootConfigs({ layer, collection, config, cases })

  // Create database table if requested
  if (!noDb) {
    await createDatabaseTable({ name: collection, layer, fields, force })

    // Always export i18n schema since crouton-i18n is bundled with @fyit/crouton
    console.log(`↻ Ensuring translations_ui table...`)
    await exportI18nSchema(force)
  }

  // Update collection registry
  await registerCollectionInAppConfig({ layer, cases, layerPascalCase, layerCamelCase })

  // Record generation history for DevTools Generators tab
  if (!dryRun) {
    try {
      recordGenerationHistory({
        collection: cases.plural,
        fields: fields.filter(f => f.name !== 'id').map(f => f.name),
        generator: 'crouton-cli',
        timestamp: new Date().toISOString(),
        layer,
      })
    } catch {
      // Non-fatal — history recording failure should not block generation
    }
  }

  console.log(`\n✓ Successfully generated collection '${cases.plural}' in layer '${layer}'`)
}

interface PostGenerationOptions {
  allCollections: Array<{ name: string; layer: string; fields: Field[] }>
  config: Record<string, any>
  dryRun: boolean
  noDb: boolean
  force: boolean
}

// Batch database setup: update the schema index for every generated collection,
// ensure the i18n schema, and run the database migration once.
async function runBatchDatabaseSetup(allCollections: Array<{ name: string; layer: string; fields: Field[] }>, force: boolean): Promise<void> {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  DATABASE SETUP`)
  console.log(`${'═'.repeat(60)}\n`)
  console.log(`Updating schema index for ${allCollections.length} collections...`)

  // Update schema index for each collection
  for (const col of allCollections) {
    const { exportName: colExportName, importPath: colImportPath, schemaIndexPath: colSchemaIndexPath } = buildSchemaExportNames(col.name, col.layer)
    const colSchemaResult = await addNamedSchemaExport(colSchemaIndexPath, colExportName, colImportPath, force)
    if (!colSchemaResult.added && colSchemaResult.reason !== 'already exported') {
      console.error(`  ✗ Failed to update schema index for ${col.name}: ${colSchemaResult.reason}`)
    }
  }

  // Always export i18n schema since crouton-i18n is bundled with @fyit/crouton
  // Note: exportI18nSchema() already calls registerTranslationsUiCollection() internally
  console.log(`\n↻ Ensuring translations_ui table...`)
  await exportI18nSchema(force)

  // Run database migration once for all collections
  console.log(`\nRunning database migration...`)
  console.log(`Command: npx nuxt db generate (30s timeout)`)

  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Command timed out after 30 seconds')), 30000)
    })

    const { stdout, stderr } = await Promise.race([
      execAsync('npx nuxt db generate'),
      timeoutPromise
    ])

    if (stderr && !stderr.includes('Warning')) {
      console.error(`⚠ Warnings:`, stderr)
    }
    console.log(`\n✓ Database migration generated successfully`)
  } catch (execError: any) {
    if (execError.message.includes('timed out')) {
      console.error(`\n✗ Database migration timed out after 30 seconds`)
      console.error(`  Check server/db/schema.ts for conflicts`)
    } else {
      console.error(`\n✗ Failed to run database migration:`, execError.message)
    }
    console.log(`\nManual command: npx nuxt db generate\n`)
  }
}

// Setup the CSS @source directive for Tailwind.
async function setupTailwindCss(): Promise<void> {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  TAILWIND CSS SETUP`)
  console.log(`${'═'.repeat(60)}\n`)

  const cssResult = await setupCroutonCssSource(process.cwd())

  if (cssResult.success) {
    if (cssResult.action === 'created') {
      console.log(`✓ Created CSS file with @source directive`)
    } else if (cssResult.action === 'updated') {
      console.log(`✓ Added @source directive to existing CSS`)
    } else {
      console.log(`✓ CSS @source directive already configured`)
    }
  } else {
    console.log(`\n⚠️  Could not automatically setup CSS @source directive`)
    displayManualCssSetupInstructions()
  }
}

// Generate the type registry (type-safe CRUD composables) and the server-side
// query registry (lazy-loaded query lookups). Shared by the config batch
// post-generation and the single-collection runGenerate.
async function generateRegistryFiles(): Promise<void> {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  TYPE REGISTRY`)
  console.log(`${'═'.repeat(60)}\n`)

  try {
    const registryResult = await generateCollectionTypesRegistry(process.cwd())
    console.log(`✓ Generated type registry with ${registryResult.collectionsCount} collection(s)`)
    console.log(`  → ${registryResult.outputPath}`)
  } catch (error: any) {
    console.log(`⚠ Could not generate type registry: ${error.message}`)
  }

  // Generate server-side query registry for lazy-loaded query lookups
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  QUERY REGISTRY`)
  console.log(`${'═'.repeat(60)}\n`)

  try {
    const queryRegistryResult = await generateQueryRegistryFile(process.cwd())
    console.log(`✓ Generated query registry with ${queryRegistryResult.collectionsCount} collection(s)`)
    console.log(`  → ${queryRegistryResult.outputPath}`)
  } catch (error: any) {
    console.log(`⚠ Could not generate query registry: ${error.message}`)
  }
}

// Deterministic default layout (#709): arrange the generated collections into
// a viable `layout_configs` tree the POC boots with (seeded by crouton-seed).
async function composeDefaultLayoutStep(allCollections: Array<{ name: string; layer: string; fields: Field[] }>, config: Record<string, any>): Promise<void> {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  DEFAULT LAYOUT`)
  console.log(`${'═'.repeat(60)}\n`)

  try {
    const { writeDefaultLayout } = await import('./compose-layout.ts')
    const layoutResult = await writeDefaultLayout({
      allCollections,
      features: config.features,
      cwd: process.cwd(),
    })
    if (layoutResult.written) {
      console.log(`✓ Composed default layout (${layoutResult.pattern}${layoutResult.viable ? ', viable' : ', NOT viable — review minWidths'})`)
      console.log(`  → ${layoutResult.path}`)
    } else {
      console.log(`⚠ Skipped default layout (${layoutResult.reason})`)
    }
  } catch (error: any) {
    console.log(`⚠ Could not compose default layout: ${error.message}`)
  }
}

async function runPostGeneration(opts: PostGenerationOptions): Promise<void> {
  const { allCollections, config, dryRun, noDb, force } = opts

  // Update schema index for all collections and run migration once (unless disabled)
  if (!noDb && !dryRun && allCollections.length > 0) {
    await runBatchDatabaseSetup(allCollections, force)
  }

  // Setup CSS @source directive for Tailwind
  await setupTailwindCss()

  // Generate the type/query registries and the default layout
  if (!dryRun) {
    await generateRegistryFiles()
    await composeDefaultLayoutStep(allCollections, config)
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ALL DONE!`)
  console.log(`${'═'.repeat(60)}\n`)
  console.log(`Next step: Restart your Nuxt dev server\n`)
}

// ---------------------------------------------------------------------------
// runConfig helpers — one per config-run stage
// ---------------------------------------------------------------------------

// Load the crouton config via c12, resolve the config directory, and fold the
// CLI flags / --only filter into it. Exits when no config file is found.
async function loadAndPrepareConfig(options: RunConfigOptions): Promise<Record<string, any>> {
  // Resolve configPath to absolute so c12 can locate it and _configDir is always correct
  const resolvedConfigPath = options.configPath
    ? path.resolve(process.cwd(), options.configPath)
    : undefined
  const configCwd = resolvedConfigPath ? path.dirname(resolvedConfigPath) : process.cwd()

  const { config } = await loadConfig({
    name: 'crouton',
    cwd: configCwd,
    configFile: resolvedConfigPath || undefined,
    defaults: {
      dialect: 'sqlite',
      features: {},
      flags: {}
    }
  })

  if (!config || (Object.keys(config).length === 0)) {
    console.error(`\n❌ Config file not found\n`)
    process.exit(1)
  }

  // Store config file directory for downstream path resolution (fieldsFile in collections)
  // Always derived from the resolved config path, not process.cwd()
  config._configDir = resolvedConfigPath
    ? path.dirname(resolvedConfigPath)
    : (config._configFile ? path.dirname(config._configFile) : process.cwd())

  // Merge CLI flags into config.flags (CLI flags override config file)
  if (!config.flags) config.flags = {}
  if (options.force) config.flags.force = true
  if (options.dryRun) config.flags.dryRun = true
  if (options.noTests) config.flags.noTests = true

  // Single-collection filter
  const onlyCollection = options.only || null
  if (onlyCollection) {
    console.log(`\n📌 Generating only: ${onlyCollection}\n`)
  }
  config._onlyCollection = onlyCollection

  return config
}

// Sync framework packages in the root nuxt.config extends for enabled features.
async function syncFeaturePackages(config: Record<string, any>): Promise<void> {
  if (!config.features) return

  console.log('\n' + '═'.repeat(60))
  console.log('  FRAMEWORK PACKAGES')
  console.log('═'.repeat(60) + '\n')
  console.log('↻ Syncing framework packages...')
  const nuxtConfigPath = path.resolve('nuxt.config.ts')
  const result = await syncFrameworkPackages(nuxtConfigPath, config.features)
  if (result.synced) {
    console.log(`✓ Synced ${result.packages.length} framework packages to extends`)
    result.packages.forEach(pkg => console.log(`  • ${pkg}`))
  } else {
    console.log(`⚠ Could not sync framework packages: ${result.reason}`)
  }
}

// Persist prompted feature configs: runtimeConfig into nuxt.config.ts and the
// feature's config object back into crouton.config.js.
async function persistPromptedConfigs(
  promptedConfigs: import('./utils/manifest-merge.ts').PromptedConfig[],
  config: Record<string, any>
): Promise<void> {
  const nuxtConfigPath = path.resolve('nuxt.config.ts')

  for (const pc of promptedConfigs) {
    // Write runtimeConfig to nuxt.config.ts
    if (pc.runtimeConfig) {
      const rtResult = await addRuntimeConfig(nuxtConfigPath, pc.runtimeConfig.server, pc.runtimeConfig.public)
      if (rtResult.added) {
        console.log(`  ✓ Added runtimeConfig for ${pc.featureKey}`)
      }
    }
  }

  // Persist feature config back to crouton.config.js
  const configFilePath = config._configDir
    ? path.resolve(config._configDir, 'crouton.config.js')
    : path.resolve('crouton.config.js')

  try {
    const { readFile, writeFile } = await import('node:fs/promises')
    const configContent = await readFile(configFilePath, 'utf-8')
    let updated = configContent

    for (const pc of promptedConfigs) {
      // Replace `featureKey: true` with the config object
      // Match patterns like `bookings: true` (with optional trailing comma)
      const boolPattern = new RegExp(`(${pc.featureKey}\\s*:\\s*)true`, 'g')
      const configStr = JSON.stringify(pc.configObject, null, 2)
        .replace(/\n/g, '\n    ') // indent to match config file nesting
      updated = updated.replace(boolPattern, `$1${configStr}`)
    }

    if (updated !== configContent) {
      await writeFile(configFilePath, updated, 'utf-8')
      console.log(`  ✓ Updated ${path.basename(configFilePath)} with feature configs`)
    }
  } catch {
    // Config file may not exist or not be writable — non-fatal
  }
}

// Auto-merge package manifest collections for enabled features
// (may prompt interactively for manifest configuration options).
async function autoMergeFeatureCollections(config: Record<string, any>, options: RunConfigOptions): Promise<void> {
  if (!config.features || options.noAutoMerge) return

  const { mergeManifestCollections } = await import('./utils/manifest-merge.ts')
  const mergeResult = await mergeManifestCollections(config)
  const promptedConfigs: import('./utils/manifest-merge.ts').PromptedConfig[] = mergeResult.promptedConfigs

  if (mergeResult.merged > 0) {
    console.log('\n' + '═'.repeat(60))
    console.log('  PACKAGE COLLECTIONS (auto-merged)')
    console.log('═'.repeat(60))
    mergeResult.collections.forEach(c =>
      console.log(`  + ${c.layer}/${c.name} (from @fyit/crouton-${c.feature})`)
    )
    if (mergeResult.skipped.length > 0) {
      console.log(`\n  Already in config: ${mergeResult.skipped.join(', ')}`)
    }
  }

  // Persist prompted configs: update nuxt.config.ts runtimeConfig + crouton.config.js
  if (promptedConfigs.length > 0 && !options.dryRun) {
    await persistPromptedConfigs(promptedConfigs, config)
  }
}

// Generate one collection entry from the enhanced config format. Returns the
// entry to track for the batch db:generate, or null when the collection has no
// fields file.
async function generateConfigEntry(params: {
  layer: string
  collectionName: string
  collectionConfig: Record<string, any> | undefined
  config: Record<string, any>
  typeMapping: any
}): Promise<{ name: string; layer: string; fields: Field[] } | null> {
  const { layer, collectionName, collectionConfig, config, typeMapping } = params

  if (!collectionConfig?.fieldsFile) {
    console.error(`Error: No fields file found for collection '${collectionName}'`)
    return null
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Generating ${layer}/${collectionName}`)
  console.log(`${'─'.repeat(60)}`)
  console.log(`Schema: ${collectionConfig.fieldsFile}`)
  if (collectionConfig.hierarchy) {
    console.log(`Hierarchy: enabled`)
  }

  // Resolve fieldsFile path relative to config directory if needed
  const resolvedFieldsFile = config._configDir && !path.isAbsolute(collectionConfig.fieldsFile)
    ? path.resolve(config._configDir, collectionConfig.fieldsFile)
    : collectionConfig.fieldsFile
  const fields = await loadFields(resolvedFieldsFile, typeMapping)

  // Check if this collection has translations
  // Generate files but skip database creation (we'll do it in batch at the end)
  // Determine seed settings from collection config or global config
  const collectionSeed = collectionConfig?.seed === true
    ? { count: config?.seed?.defaultCount || 25 }
    : typeof collectionConfig?.seed === 'object'
      ? collectionConfig.seed
      : null

  await writeScaffold({
    layer,
    collection: collectionName,
    fields,
    dialect: config.dialect || 'pg',
    autoRelations: config.flags?.autoRelations || false,
    dryRun: config.flags?.dryRun || false,
    noDb: true, // Skip individual db:generate
    force: config.flags?.force || false,
    noTranslations: config.flags?.noTranslations || false,
    config: config,
    collectionConfig: collectionConfig, // Pass individual collection config for hierarchy detection
    seed: !!collectionSeed,
    seedCount: collectionSeed?.count || config?.seed?.defaultCount || 25,
    noTests: config.flags?.noTests || collectionConfig?.tests === false || false
  })

  return { name: collectionName, layer, fields }
}

// Enhanced config format (collections[] + targets[]): generate every configured
// collection, then run the batch post-generation steps.
async function runEnhancedConfigFormat(config: Record<string, any>, typeMapping: any): Promise<void> {
  if (!config.targets || !config.collections) {
    console.error('Error: Invalid config file - missing targets or collections')
    process.exit(1)
  }

  // Create a map of collection names to their full config (including fieldsFile, hierarchy, etc.)
  const collectionConfigMap: Record<string, any> = {}
  for (const col of config.collections) {
    collectionConfigMap[col.name] = col
  }

  // Track all collections for batch db:generate
  const allCollections: Array<{ name: string; layer: string; fields: Field[] }> = []

  // Process each target
  for (const target of config.targets) {
    for (const collectionName of target.collections) {
      // Skip if --only flag is set and this isn't the target collection
      if (config._onlyCollection && collectionName !== config._onlyCollection) {
        continue
      }

      const generated = await generateConfigEntry({
        layer: target.layer,
        collectionName,
        collectionConfig: collectionConfigMap[collectionName],
        config,
        typeMapping
      })
      if (generated) {
        allCollections.push(generated)
      }
    }
  }

  await runPostGeneration({
    allCollections,
    config,
    dryRun: config.flags?.dryRun || false,
    noDb: config.flags?.noDb || false,
    force: config.flags?.force || false,
  })
}

// Original simple config format (schemaPath + targets[]): every target collection
// shares the one schema; then run the batch post-generation steps.
async function runSimpleConfigFormat(config: Record<string, any>, typeMapping: any): Promise<void> {
  const fields = await loadFields(config.schemaPath, typeMapping)

  // Track all collections for batch db:generate
  const allCollections: Array<{ name: string; layer: string; fields: Field[] }> = []

  // Process each target
  for (const target of config.targets) {
    for (const collection of target.collections) {
      console.log(`\nGenerating collection '${collection}' in layer '${target.layer}'...`)

      // Check for global seed settings (this code path doesn't have per-collection config)
      const globalSeed = config?.seed?.enabled === true || config?.flags?.seed === true

      await writeScaffold({
        layer: target.layer,
        collection,
        fields,
        dialect: config.dialect || 'pg',
        autoRelations: config.flags?.autoRelations || false,
        dryRun: config.flags?.dryRun || false,
        noDb: true, // Skip individual db:generate
        force: config.flags?.force || false,
        noTranslations: config.flags?.noTranslations || false,
        config: config,
        seed: globalSeed,
        seedCount: config?.seed?.defaultCount || 25,
        noTests: config.flags?.noTests || false
      })

      allCollections.push({ name: collection, layer: target.layer, fields })
    }
  }

  await runPostGeneration({
    allCollections,
    config,
    dryRun: config.flags?.dryRun || false,
    noDb: config.flags?.noDb || false,
    force: config.flags?.force || false,
  })
}

/**
 * Run config-based generation.
 */
export async function runConfig(options: RunConfigOptions = {}): Promise<void> {
  try {
    const typeMapping = await loadTypeMapping()

    // Load the config file and fold CLI flags / the --only filter into it
    const config = await loadAndPrepareConfig(options)

    // Validate configuration before proceeding
    const validation = await validateConfig(config)

    if (!validation.valid) {
      console.error('\n⛔ Cannot proceed with generation due to validation errors\n')
      process.exit(1)
    }

    // Sync framework packages based on features config
    await syncFeaturePackages(config)

    // Auto-merge package manifest collections for enabled features
    await autoMergeFeatureCollections(config, options)

    // Handle both config formats
    if (config.collections && config.targets) {
      // Enhanced config format with collections array
      await runEnhancedConfigFormat(config, typeMapping)
    } else if (config.targets && config.schemaPath) {
      // Original simple config format
      await runSimpleConfigFormat(config, typeMapping)
    } else {
      console.error('Error: Invalid config file')
      console.error('Config must have either:')
      console.error('  1. collections[] and targets[] (enhanced format)')
      console.error('  2. schemaPath and targets[] (simple format)')
      process.exit(1)
    }
  } catch (error: any) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

// Validate the single-collection CLI arguments: the schema file exists, the
// cwd is writable, and (unless --force) required dependencies are present.
async function validateGenerateArgs(args: Record<string, any>): Promise<void> {
  console.log('\n📋 Validating CLI arguments...\n')

  // Check schema file exists
  const schemaPath = path.resolve(args.fieldsFile)
  try {
    await fsp.access(schemaPath)
    console.log(`✓ Schema file found: ${args.fieldsFile}`)
  } catch {
    console.error(`\n❌ Schema file not found: ${args.fieldsFile}\n`)
    process.exit(1)
  }

  // Check for write permissions
  try {
    await fsp.access(process.cwd(), fsp.constants.W_OK)
    console.log(`✓ Write permissions verified`)
  } catch {
    console.error(`\n❌ No write permissions in current directory\n`)
    process.exit(1)
  }

  // Check dependencies unless force flag
  if (!args.force) {
    const dependencies = await detectRequiredDependencies()

    if (dependencies.missing.length > 0) {
      console.log('\n⚠️  Missing dependencies detected:')
      displayMissingDependencies(dependencies)

      if (!args.force) {
        console.log('\nUse --force to skip this check or run:')
        console.log('  crouton install\n')
      }
    }
  }
}

/**
 * Run single-collection generation with explicit args.
 */
export async function runGenerate(options: RunGenerateOptions = {}): Promise<void> {
  try {
    const typeMapping = await loadTypeMapping()
    const args = {
      layer: options.layer,
      collection: options.collection,
      fieldsFile: options.fieldsFile,
      dialect: options.dialect || 'sqlite',
      autoRelations: options.autoRelations || false,
      dryRun: options.dryRun || false,
      noDb: options.noDb || false,
      force: options.force || false,
      noTranslations: options.noTranslations || false,
      hierarchy: options.hierarchy || false,
      seed: options.seed || false,
      seedCount: options.seedCount || 25,
      noTests: options.noTests || false
    }

    // Validate CLI arguments
    await validateGenerateArgs(args)

    console.log(`\n📦 Will generate:`)
    console.log(`  Layer: ${args.layer}`)
    console.log(`  Collection: ${args.collection}`)
    console.log(`  Dialect: ${args.dialect}`)

    if (args.dryRun) {
      console.log('\n🔍 DRY RUN MODE - No files will be created')
    }

    console.log('\n' + '─'.repeat(60) + '\n')

    // Load and validate the schema content
    let fields
    try {
      fields = await loadFields(args.fieldsFile, typeMapping)
      console.log(`✓ Loaded ${fields.length} fields from schema`)
    } catch (error: any) {
      console.error(`\n❌ Error loading schema: ${error.message}\n`)
      process.exit(1)
    }

    // Proceed with generation
    await writeScaffold({ ...args, fields })

    // Generate the type + query registries for type-safe CRUD composables
    if (!args.dryRun) {
      await generateRegistryFiles()

      // Print .env hints for prompted configurations
      if (promptedConfigs.length > 0) {
        const allHints = promptedConfigs.flatMap(pc => pc.envHints || [])
        if (allHints.length > 0) {
          console.log(`\n${'═'.repeat(60)}`)
          console.log(`  ENVIRONMENT VARIABLES`)
          console.log(`${'═'.repeat(60)}\n`)
          console.log(`Add these to your .env file:\n`)
          allHints.forEach(hint => console.log(`   ${hint}`))
          console.log('')
        }
      }

      console.log(`\n${'═'.repeat(60)}`)
      console.log(`  ALL DONE!`)
      console.log(`${'═'.repeat(60)}\n`)
      console.log(`Next step: Restart your Nuxt dev server\n`)
    }
  } catch (error: any) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}
