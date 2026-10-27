/**
 * Manifest Loader
 *
 * Discovers and loads crouton.manifest.ts files from all packages.
 * Builds a unified field type registry with alias expansion.
 *
 * Used by: CLI generators, MCP server, crouton-core Nuxt module hook
 */

import { createJiti } from 'jiti'
import { resolve, join, dirname } from 'pathe'
import { readPackageJSON } from 'pkg-types'
import type {
  CroutonManifest,
  FieldTypeDefinition,
  ManifestDetects,
  DetectionResult,
  DetectedField,
  GeneratorContribution,
} from '@fyit/crouton-core/shared/manifest'
import { existsSync, readdirSync } from 'node:fs'

// Re-export types for consumers
export type { CroutonManifest, FieldTypeDefinition, ManifestDetects, DetectionResult, DetectedField, GeneratorContribution }

/** AI-facing summary of what a package provides */
export interface ModuleAIContext {
  collections?: Array<{ name: string, description: string, schema?: Record<string, unknown> }>
  composables?: string[]
  components?: string[]
}

/** Module registry entry shape (backward compat with module-registry.json) */
export interface ModuleRegistryEntry {
  alias: string
  package: string
  description: string
  hasSchema: boolean
  bundled: boolean
  aiHint: string | null
  dependencies: string[]
  category: 'core' | 'addon' | 'miniapp'
  layer?: { name: string; reason?: string }
  extensionPoints?: Array<{ collection: string; allowedFields: string[]; description: string }>
  configuration?: Record<string, { type: string; label: string; description?: string; default: unknown }>
  ai?: ModuleAIContext
}

// Cache to avoid repeated filesystem scanning
let _manifestCache: CroutonManifest[] | null = null
let _cacheRootDir: string | null = null
// Parallel contribution cache — populated alongside manifest cache
let _contributionCache: Map<string, GeneratorContribution> | null = null

/**
 * Discover and load all crouton.manifest.ts files.
 *
 * Discovery order:
 * 1. packages/crouton-* /crouton.manifest.ts (monorepo dev)
 * 2. node_modules/@fyit/crouton-* /crouton.manifest.ts (installed deps)
 */
export async function discoverManifests(rootDir?: string): Promise<CroutonManifest[]> {
  const cwd = rootDir || process.cwd()

  // Return cache if same rootDir
  if (_manifestCache && _cacheRootDir === cwd) {
    return _manifestCache
  }

  const manifests: CroutonManifest[] = []
  const seen = new Set<string>()
  const contributionCache = new Map<string, GeneratorContribution>()

  const jiti = createJiti(cwd, {
    interopDefault: true,
  })

  /** Load manifest + optional generatorContribution from a module */
  function captureModule(mod: any, manifestPath: string): void {
    const manifest: CroutonManifest = (mod as any).default || mod
    if (manifest?.id && !seen.has(manifest.id)) {
      seen.add(manifest.id)
      manifests.push(manifest)
      // Capture generatorContribution named export if present
      const contribution = (mod as any).generatorContribution
      if (contribution && typeof contribution === 'object') {
        contributionCache.set(manifest.id, contribution as GeneratorContribution)
      }
    }
  }

  // Strategy 1: Monorepo packages/ directory
  const packagesDir = await findPackagesDir(cwd)
  if (packagesDir) {
    const dirs = readdirSync(packagesDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('crouton-'))
      .map(d => join(packagesDir, d.name))

    for (const dir of dirs) {
      const manifestPath = join(dir, 'crouton.manifest.ts')
      if (existsSync(manifestPath)) {
        try {
          const mod = await jiti.import(manifestPath)
          captureModule(mod, manifestPath)
        } catch (err) {
          // Skip manifests that fail to load (e.g., missing schema JSON imports)
          if (process.env.DEBUG) {
            console.warn(`[manifest-loader] Failed to load ${manifestPath}:`, err)
          }
        }
      }
    }
  }

  // Strategy 2: node_modules/@fyit/crouton-*
  const nodeModulesDir = join(cwd, 'node_modules', '@fyit')
  if (existsSync(nodeModulesDir)) {
    const dirs = readdirSync(nodeModulesDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('crouton-'))
      .map(d => join(nodeModulesDir, d.name))

    for (const dir of dirs) {
      const manifestPath = join(dir, 'crouton.manifest.ts')
      if (existsSync(manifestPath)) {
        try {
          const mod = await jiti.import(manifestPath)
          captureModule(mod, manifestPath)
        } catch {
          // Skip silently — installed packages may not have all deps
        }
      }
    }
  }

  assertUniqueLayerNames(manifests)

  _manifestCache = manifests
  _cacheRootDir = cwd
  _contributionCache = contributionCache
  return manifests
}

/**
 * Fail when two packages declare the same layer name. Form/component names are
 * derived from the layer, so a shared name would let one package silently
 * override the other (package-over-package override is unsupported, #2280).
 */
export function assertUniqueLayerNames(manifests: CroutonManifest[]): void {
  const owners = new Map<string, string>()
  for (const m of manifests) {
    const name = m.layer?.name
    if (!name) continue
    const first = owners.get(name)
    if (first && first !== m.id) {
      throw new Error(
        `[manifest-loader] Layer name "${name}" is claimed by both "${first}" and "${m.id}". Layer names must be unique across packages.`,
      )
    }
    owners.set(name, m.id)
  }
}

/**
 * Clear the manifest cache (useful for tests or after config changes)
 */
export function clearManifestCache(): void {
  _manifestCache = null
  _cacheRootDir = null
  _contributionCache = null
}

/**
 * Build a flat field type registry from all manifests.
 * Aliases are expanded — both 'number' and 'integer' keys exist.
 */
export function getFieldTypeRegistry(
  manifests: CroutonManifest[],
): Record<string, FieldTypeDefinition> {
  const registry: Record<string, FieldTypeDefinition> = {}

  for (const manifest of manifests) {
    if (!manifest.fieldTypes) continue
    for (const [name, def] of Object.entries(manifest.fieldTypes)) {
      // Canonical type
      registry[name] = def

      // Expand aliases
      if (def.aliases) {
        for (const alias of def.aliases) {
          registry[alias] = def
        }
      }
    }
  }

  return registry
}

/**
 * Get the list of valid canonical field type names (no aliases).
 */
export function getCanonicalFieldTypes(
  manifests: CroutonManifest[],
): string[] {
  const types: string[] = []
  for (const manifest of manifests) {
    if (!manifest.fieldTypes) continue
    types.push(...Object.keys(manifest.fieldTypes))
  }
  return types
}

/**
 * Get all auto-generated fields merged from all manifests.
 */
export function getAutoGeneratedFields(
  manifests: CroutonManifest[],
): string[] {
  const fields = new Set<string>()
  for (const manifest of manifests) {
    if (manifest.autoGeneratedFields) {
      for (const f of manifest.autoGeneratedFields) {
        fields.add(f)
      }
    }
  }
  return [...fields]
}

/**
 * Get all reserved field names merged from all manifests.
 */
export function getReservedFieldNames(
  manifests: CroutonManifest[],
): string[] {
  const names = new Set<string>()
  for (const manifest of manifests) {
    if (manifest.reservedFieldNames) {
      for (const n of manifest.reservedFieldNames) {
        names.add(n)
      }
    }
  }
  return [...names]
}

/**
 * Get all reserved collection names merged from all manifests.
 */
export function getReservedCollectionNames(
  manifests: CroutonManifest[],
): string[] {
  const names = new Set<string>()
  for (const manifest of manifests) {
    if (manifest.reservedCollectionNames) {
      for (const n of manifest.reservedCollectionNames) {
        names.add(n)
      }
    }
  }
  return [...names]
}

/**
 * Build a module registry from manifests (backward compat shape).
 */
export function getModuleRegistry(
  manifests: CroutonManifest[],
): ModuleRegistryEntry[] {
  return manifests.map((m) => {
    const alias = m.id.replace(/^crouton-/, '')

    // Build AI-facing context from manifest data
    const hasAIData = m.collections?.length || m.provides?.composables?.length || m.provides?.components?.length
    const ai: ModuleAIContext | undefined = hasAIData
      ? {
          collections: m.collections?.filter(c => !c.optional).map(c => ({ name: c.name, description: c.description, schema: c.schema })),
          composables: m.provides?.composables,
          components: m.provides?.components?.map(c => c.name),
        }
      : undefined

    return {
      alias,
      package: `@fyit/${m.id}`,
      description: m.description,
      hasSchema: (m.collections?.length ?? 0) > 0,
      bundled: m.bundled ?? false,
      aiHint: m.aiHint ?? null,
      dependencies: m.dependencies ?? [],
      category: m.category,
      layer: m.layer ? { name: m.layer.name, reason: m.layer.reason } : undefined,
      extensionPoints: m.extensionPoints,
      configuration: m.configuration,
      ai,
    }
  })
}

/**
 * Get module registry as a Record keyed by alias (matches old JSON shape).
 */
export function getModuleRegistryMap(
  manifests: CroutonManifest[],
): Record<string, ModuleRegistryEntry> {
  const map: Record<string, ModuleRegistryEntry> = {}
  for (const entry of getModuleRegistry(manifests)) {
    map[entry.alias] = entry
  }
  return map
}

/**
 * Build a type mapping compatible with helpers.ts typeMapping shape.
 * Used by generate-collection.mjs during code generation.
 */
export function getTypeMapping(
  manifests: CroutonManifest[],
): Record<string, { db: string; drizzle: string; zod: string; default: string; tsType: string; canonical: string; component?: string }> {
  const mapping: Record<string, { db: string; drizzle: string; zod: string; default: string; tsType: string; canonical: string; component?: string }> = {}

  for (const manifest of manifests) {
    if (!manifest.fieldTypes) continue
    for (const [name, def] of Object.entries(manifest.fieldTypes)) {
      // `canonical` lets callers resolve an alias (e.g. `datetime`) back to its
      // canonical type (`date`). Without it, downstream generators that branch on
      // `field.type === 'date'` silently miss alias-typed fields — emitting a raw
      // UInput + text column instead of CroutonCalendar + a timestamp column (#285).
      const entry = {
        db: def.db,
        drizzle: def.drizzle,
        zod: def.zod,
        default: def.defaultValue,
        tsType: def.tsType,
        canonical: name,
        // The form control the manifest declares for this type. Carried onto
        // every field by loadFields so generators render it instead of keeping
        // a private type→component switch (#2286).
        component: def.component,
      }
      mapping[name] = entry
      if (def.aliases) {
        for (const alias of def.aliases) {
          mapping[alias] = { ...entry, canonical: name }
        }
      }
    }
  }

  return mapping
}

// ---------------------------------------------------------------------------
// Generator detection helpers (Phase 1)
// ---------------------------------------------------------------------------

/**
 * Build a map of packageId → ManifestDetects for all manifests that declare `detects`.
 */
export function getGeneratorDetectors(
  manifests: CroutonManifest[],
): Map<string, ManifestDetects> {
  const detectors = new Map<string, ManifestDetects>()
  for (const m of manifests) {
    if (m.detects) {
      detectors.set(m.id, m.detects)
    }
  }
  return detectors
}

/**
 * Test whether a given set of fields + collectionConfig satisfies a package's detector.
 * Returns true if ANY of the detector's conditions match.
 */
export function matchesDetector(
  fields: Array<{ name: string; type: string; meta?: Record<string, unknown>; refTarget?: string }>,
  collectionConfig: Record<string, unknown> | null,
  detector: ManifestDetects,
): boolean {
  if (detector.fieldNamePatterns?.length) {
    if (fields.some(f =>
      detector.fieldNamePatterns!.some(p => f.name.toLowerCase().includes(p.toLowerCase())),
    )) {
      return true
    }
  }
  if (detector.coordinatePatterns?.length) {
    if (fields.some(f =>
      detector.coordinatePatterns!.some(p => f.name.toLowerCase().includes(p.toLowerCase())),
    )) {
      return true
    }
  }
  if (detector.fieldTypes?.length) {
    if (fields.some(f => detector.fieldTypes!.includes(f.type))) {
      return true
    }
  }
  if (detector.refTargetPatterns?.length) {
    if (fields.some(f =>
      f.refTarget && detector.refTargetPatterns!.some(p =>
        f.refTarget!.toLowerCase().includes(p.toLowerCase()),
      ),
    )) {
      return true
    }
  }
  if (detector.componentPatterns?.length) {
    if (fields.some(f =>
      f.meta?.component && detector.componentPatterns!.some(p =>
        (f.meta!.component as string).includes(p),
      ),
    )) {
      return true
    }
  }
  if (detector.collectionConfigFlag) {
    if (collectionConfig?.[detector.collectionConfigFlag] === true) {
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Generator contribution helpers (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Get all generator contributions from the loaded manifests.
 * Requires discoverManifests() to have been called first.
 */
export function getGeneratorContributions(
  manifests: CroutonManifest[],
): Array<{ packageId: string; contribution: GeneratorContribution }> {
  if (!_contributionCache) return []
  const result: Array<{ packageId: string; contribution: GeneratorContribution }> = []
  for (const m of manifests) {
    const contribution = _contributionCache.get(m.id)
    if (contribution) {
      result.push({ packageId: m.id, contribution })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from cwd to find the monorepo packages/ directory.
 * Looks for pnpm-workspace.yaml as the root marker.
 */
export async function findPackagesDir(startDir: string): Promise<string | null> {
  let dir = resolve(startDir)
  const root = dirname(dir) === dir ? dir : '/' // filesystem root

  while (dir !== root) {
    const workspacePath = join(dir, 'pnpm-workspace.yaml')
    const packagesPath = join(dir, 'packages')

    if (existsSync(workspacePath) && existsSync(packagesPath)) {
      return packagesPath
    }

    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return null
}

// ── Convenience helpers (discover + compute in one call) ──────────
// Moved here from the deleted manifest-bridge.ts (#2290): every caller is .ts,
// so the jiti hop (and its second manifest cache) bought nothing.

export async function loadTypeMapping(rootDir?: string) {
  return getTypeMapping(await discoverManifests(rootDir))
}

export async function loadModuleRegistryMap(rootDir?: string) {
  return getModuleRegistryMap(await discoverManifests(rootDir))
}

export async function loadModuleRegistry(rootDir?: string) {
  return getModuleRegistry(await discoverManifests(rootDir))
}
