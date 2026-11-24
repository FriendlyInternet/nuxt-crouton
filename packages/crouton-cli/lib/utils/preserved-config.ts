// preserved-config.ts — Read a reviewed `crouton.config.js` that `crouton init`
// scaffolds into (#1233) and work out what the app needs from it (#4377):
// the packages its field types call for (from each manifest's `detects.fieldTypes`)
// and whether any collection seeds (so `drizzle-seed` must be a devDependency).
import { resolve } from 'node:path'
import { access, readFile } from 'node:fs/promises'
import { loadCroutonConfig } from '../doctor.ts'
import { findModuleKey, loadModules } from '../module-registry.ts'
import { discoverManifests, getGeneratorDetectors } from './manifest-loader.ts'

export interface PreservedConfigInfo {
  /** Feature keys (e.g. `assets`) whose package detects a field type the schemas use. */
  detectedFeatures: string[]
  /** Some collection sets `seed` — the generated `server/database/seed.ts` imports drizzle-seed. */
  needsDrizzleSeed: boolean
}

const EMPTY: PreservedConfigInfo = { detectedFeatures: [], needsDrizzleSeed: false }

/** Field types in a schema file — both the array (`{ fields: [...] }`) and keyed formats. */
async function readFieldTypes(file: string): Promise<string[]> {
  try {
    const obj = JSON.parse(await readFile(file, 'utf8'))
    const defs: unknown[] = Array.isArray(obj?.fields) ? obj.fields : Object.values(obj ?? {})
    return defs
      .map(d => (d && typeof d === 'object' ? (d as { type?: unknown }).type : undefined))
      .filter((t): t is string => typeof t === 'string')
  } catch {
    return []
  }
}

/**
 * Inspect `<appDir>/crouton.config.js` if present. Missing or unreadable files
 * yield the empty result, so a bare scaffold never fails on this.
 */
export async function inspectPreservedConfig(appDir: string): Promise<PreservedConfigInfo> {
  const collections = await loadCollections(appDir)
  if (collections.length === 0) return EMPTY
  const usedTypes = await collectFieldTypes(appDir, collections)
  return {
    detectedFeatures: await featuresForTypes(usedTypes),
    needsDrizzleSeed: collections.some(c => !!c?.seed)
  }
}

/** The preserved config's `collections[]`, or [] when there is no readable config. */
async function loadCollections(appDir: string): Promise<Array<Record<string, any>>> {
  const hasConfig = await access(resolve(appDir, 'crouton.config.js')).then(() => true).catch(() => false)
  if (!hasConfig) return []
  const config = await loadCroutonConfig(appDir)
  return Array.isArray(config?.collections) ? config!.collections : []
}

/** Every field type used across the collections' schema files. */
async function collectFieldTypes(appDir: string, collections: Array<Record<string, any>>): Promise<Set<string>> {
  const files = collections.map(c => c?.fieldsFile).filter((f): f is string => typeof f === 'string')
  const lists = await Promise.all(files.map(f => readFieldTypes(resolve(appDir, f))))
  return new Set(lists.flat())
}

/** Feature keys whose manifest `detects.fieldTypes` matches a used type. */
async function featuresForTypes(usedTypes: Set<string>): Promise<string[]> {
  if (usedTypes.size === 0) return []
  const [manifests, modules] = await Promise.all([discoverManifests(), loadModules()])
  const keys = [...getGeneratorDetectors(manifests)]
    .filter(([, detects]) => detects.fieldTypes?.some(t => usedTypes.has(t)))
    .map(([id]) => findModuleKey(id, modules))
    .filter((k): k is string => !!k)
  return [...new Set(keys)]
}
