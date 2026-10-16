/**
 * Auto-merge package manifest collections into CLI generation config.
 *
 * For every package the app EXTENDS (#2286 — `extends` is the only package
 * on-switch; `extendedPackages` comes from resolveExtendedPackages), this
 * utility reads the package's crouton.manifest.ts and adds its collections
 * to `config.collections` and `config.targets` so the generator creates
 * the missing CRUD routes.
 *
 * If a manifest declares `configuration` options and `config.features.<alias>`
 * holds no config object yet, the user is interactively prompted for each
 * option. The answers are stored under `config.features.<alias>` — the one
 * thing `features` still carries — so that `isConditionMet()` resolves
 * conditional collections automatically.
 *
 * User-defined collections always win — we never overwrite them.
 */

import path from 'node:path'
import fsp from 'node:fs/promises'
import * as p from '@clack/prompts'
import pluralizeLib from 'pluralize'
import { discoverManifests } from './manifest-bridge.ts'
import { findPackagesDir } from './manifest-loader.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CollectionConfig {
  name: string
  fieldsFile: string
  [key: string]: unknown
}

interface TargetConfig {
  layer: string
  collections: string[]
}

interface CroutonConfig {
  features?: Record<string, boolean | Record<string, unknown>>
  collections?: CollectionConfig[]
  targets?: TargetConfig[]
  [key: string]: unknown
}

interface ManifestCollection {
  name: string
  schemaPath?: string
  optional?: boolean
  condition?: string
  hierarchy?: boolean | Record<string, unknown>
}

interface ManifestConfigOption {
  type: 'boolean' | 'string' | 'number' | 'select' | 'multiselect'
  label: string
  description?: string
  default: unknown
  options?: Array<{ value: string; label: string }>
}

interface Manifest {
  id: string
  layer?: { name: string }
  ownsCollections?: boolean
  collections?: ManifestCollection[]
  configuration?: Record<string, ManifestConfigOption>
}

/** Info about a feature that was interactively configured during merge. */
export interface PromptedConfig {
  featureKey: string
  manifestId: string
  configObject: Record<string, unknown>
  /** runtimeConfig entries to write (e.g. { croutonBookings: { email: { enabled: true } } }) */
  runtimeConfig?: { server: Record<string, unknown>; public: Record<string, unknown> }
  /** .env hints to display after generation */
  envHints?: string[]
}

interface MergeResult {
  merged: number
  collections: Array<{ name: string; layer: string; feature: string }>
  skipped: string[]
  /** Features that were interactively configured (caller should persist these). */
  promptedConfigs: PromptedConfig[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-path like "email.enabled" against an object.
 * Returns `undefined` if any segment is missing.
 */
function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

/**
 * Check whether an optional collection's condition is met.
 *
 * `condition` is a dot-path like "config.email.enabled" evaluated against the
 * feature config object (e.g., `config.features.bookings`).
 */
function isConditionMet(featureConfig: boolean | Record<string, unknown>, condition?: string): boolean {
  if (!condition) return true
  // featureConfig can be `true` (simple boolean enable) — conditions never match
  if (typeof featureConfig !== 'object') return false
  return !!getNestedValue(featureConfig, condition)
}

/**
 * Pluralize a collection name using English rules (category→categories,
 * entry→entries, equipment uncountable). Idempotent on already-plural input.
 */
function pluralize(name: string): string {
  return pluralizeLib(name)
}

/**
 * Set a value at a dot-path (e.g. "email.enabled") in an object,
 * creating intermediate objects as needed.
 */
function setNestedValue(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split('.')
  let current: Record<string, unknown> = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {}
    }
    current = current[keys[i]] as Record<string, unknown>
  }
  current[keys[keys.length - 1]] = value
}

/**
 * Convert a feature key like "bookings" to a camelCase runtimeConfig key
 * like "croutonBookings".
 */
function toRuntimeConfigKey(featureKey: string): string {
  return 'crouton' + featureKey.charAt(0).toUpperCase() + featureKey.slice(1)
}

// ---------------------------------------------------------------------------
// Interactive prompting
// ---------------------------------------------------------------------------

/**
 * Prompt the user for manifest configuration options.
 * Only called when a feature is enabled as a simple boolean (`true`)
 * and the manifest declares `configuration` entries.
 *
 * Returns the built config object (to be stored under `config.features[key]`)
 * or `null` if the user cancelled.
 */
async function promptForConfiguration(
  featureKey: string,
  manifestName: string,
  configuration: Record<string, ManifestConfigOption>,
): Promise<Record<string, unknown> | null> {
  p.note(`${manifestName} has configuration options`, `Configure ${featureKey}`)

  const configObj: Record<string, unknown> = { config: {} }
  const configInner = configObj.config as Record<string, unknown>

  for (const [dotPath, option] of Object.entries(configuration)) {
    let answer: unknown

    if (option.type === 'boolean') {
      answer = await p.confirm({
        message: option.label + (option.description ? ` — ${option.description}` : ''),
        initialValue: option.default as boolean ?? false,
      })
    } else if (option.type === 'select' && option.options) {
      answer = await p.select({
        message: option.label + (option.description ? ` — ${option.description}` : ''),
        options: option.options.map(o => ({ value: o.value, label: o.label })),
        initialValue: option.default as string,
      })
    } else if (option.type === 'multiselect' && option.options) {
      answer = await p.multiselect({
        message: option.label + (option.description ? ` — ${option.description}` : ''),
        options: option.options.map(o => ({ value: o.value, label: o.label })),
        initialValues: (option.default as string[]) ?? [],
      })
    } else {
      // string / number — use text prompt
      answer = await p.text({
        message: option.label + (option.description ? ` — ${option.description}` : ''),
        initialValue: String(option.default ?? ''),
      })
      if (option.type === 'number' && typeof answer === 'string') {
        answer = Number(answer)
      }
    }

    // User pressed Ctrl+C
    if (p.isCancel(answer)) {
      p.cancel('Configuration cancelled')
      return null
    }

    setNestedValue(configInner, dotPath, answer)
  }

  return configObj
}

/**
 * Build runtimeConfig and .env hints from a prompted config object.
 */
function buildRuntimeAndEnvHints(
  featureKey: string,
  configObj: Record<string, unknown>,
): Pick<PromptedConfig, 'runtimeConfig' | 'envHints'> {
  const rtKey = toRuntimeConfigKey(featureKey)
  const inner = configObj.config as Record<string, unknown> | undefined

  if (!inner) return {}

  const runtimeConfig = {
    server: { [rtKey]: inner },
    public: { [rtKey]: inner },
  }

  const envHints: string[] = []

  // Feature-specific env hints
  if (featureKey === 'bookings' && getNestedValue(inner, 'email.enabled')) {
    envHints.push(
      'RESEND_API_KEY=re_xxx',
      'NUXT_EMAIL_FROM=noreply@yourdomain.com',
    )
  }

  return { runtimeConfig, envHints: envHints.length > 0 ? envHints : undefined }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Mutate `config.collections` and `config.targets` in place, adding any
 * package-manifest collections that the user hasn't already listed.
 *
 * When a manifest has `configuration` options and the feature is a simple
 * boolean, prompts the user interactively and upgrades the feature config.
 */
export async function mergeManifestCollections(config: CroutonConfig, extendedPackages: string[]): Promise<MergeResult> {
  const result: MergeResult = { merged: 0, collections: [], skipped: [], promptedConfigs: [] }

  if (extendedPackages.length === 0) return result

  const packagesDir = await findPackagesDir(process.cwd())
  if (!packagesDir) return result

  // Discover all manifests
  const manifests: Manifest[] = await discoverManifests()

  // Map of user-defined collection names, keyed by lowercased name for
  // case-insensitive collision detection. Value is the user's original casing
  // so we can preserve it when reporting/registering matches.
  // Without this, e.g. user `orderItems` + manifest `orderItem` (pluralizes to
  // `orderitems`) would both register, producing duplicate app.config entries.
  const existingNames = new Map<string, string>(
    (config.collections || []).map(c => [c.name.toLowerCase(), c.name]),
  )

  // Ensure arrays exist
  if (!config.collections) config.collections = []
  if (!config.targets) config.targets = []

  // Detect non-interactive mode (CI or explicit flag)
  const isInteractive = process.stdout.isTTY && !process.env.CI

  for (const manifest of manifests) {
    if (!manifest.collections || manifest.collections.length === 0) continue
    // The package ships these itself; generating them would fork them (#2278).
    if (manifest.ownsCollections) continue
    // Only packages the app extends (#2286).
    if (!extendedPackages.includes(manifest.id)) continue

    // Derive feature alias from manifest id (e.g., 'crouton-bookings' → 'bookings')
    const featureKey = manifest.id.replace(/^crouton-/, '')
    if (!config.features) config.features = {}
    let featureConfig: boolean | Record<string, unknown> = config.features[featureKey] || true

    // Interactive prompting: no config object yet and the manifest has configuration
    if (featureConfig === true && manifest.configuration && Object.keys(manifest.configuration).length > 0) {
      if (isInteractive) {
        const configObj = await promptForConfiguration(featureKey, manifest.id, manifest.configuration)
        if (configObj) {
          // Upgrade feature from boolean to config object
          config.features[featureKey] = configObj
          featureConfig = configObj

          const hints = buildRuntimeAndEnvHints(featureKey, configObj)
          result.promptedConfigs.push({
            featureKey,
            manifestId: manifest.id,
            configObject: configObj,
            ...hints,
          })
        }
        // If cancelled, keep featureConfig as `true` — optional collections just won't match
      } else {
        // Non-interactive: use defaults from manifest configuration
        const configObj: Record<string, unknown> = { config: {} }
        const configInner = configObj.config as Record<string, unknown>
        for (const [dotPath, option] of Object.entries(manifest.configuration)) {
          setNestedValue(configInner, dotPath, option.default)
        }
        config.features[featureKey] = configObj
        featureConfig = configObj

        const hints = buildRuntimeAndEnvHints(featureKey, configObj)
        result.promptedConfigs.push({
          featureKey,
          manifestId: manifest.id,
          configObject: configObj,
          ...hints,
        })
      }
    }

    // Resolve package directory
    const pkgDir = path.join(packagesDir, manifest.id)

    // Get layer name from manifest
    const layerName = manifest.layer?.name || featureKey

    // Find or create the target entry for this layer
    let target = config.targets.find(t => t.layer === layerName)
    if (!target) {
      target = { layer: layerName, collections: [] }
      config.targets.push(target)
    }

    for (const col of manifest.collections) {
      // Use pluralized lowercase name for config compatibility
      const configName = pluralize(col.name.toLowerCase())

      // Skip collections the user already defined (user override wins).
      // Check case-insensitively against both singular (col.name) and plural
      // (configName) forms so that user `orderItems` is recognized as the
      // same collection as manifest `orderItem` → `orderitems`.
      const matchedOriginal =
        existingNames.get(configName.toLowerCase()) ??
        existingNames.get(col.name.toLowerCase())
      if (matchedOriginal) {
        if (!target.collections.includes(matchedOriginal)) {
          target.collections.push(matchedOriginal)
        }
        result.skipped.push(matchedOriginal)
        continue
      }

      // Skip optional collections whose condition isn't met
      if (col.optional && !isConditionMet(featureConfig, col.condition)) {
        continue
      }

      // Resolve absolute path to schema file
      if (!col.schemaPath) continue
      const absSchemaPath = path.resolve(pkgDir, col.schemaPath)

      // Verify the schema file exists
      try {
        await fsp.access(absSchemaPath)
      } catch {
        // Schema file doesn't exist — skip silently
        continue
      }

      // Add to config.collections with absolute path
      config.collections.push({
        name: configName,
        fieldsFile: absSchemaPath,
        ...(col.hierarchy ? { hierarchy: col.hierarchy } : {})
      })

      // Track for subsequent collision checks within this merge pass so two
      // manifests claiming the same collection don't both register.
      existingNames.set(configName.toLowerCase(), configName)

      // Add to target's collections list
      if (!target.collections.includes(configName)) {
        target.collections.push(configName)
      }

      result.merged++
      result.collections.push({
        name: configName,
        layer: layerName,
        feature: featureKey,
      })
    }
  }

  return result
}
