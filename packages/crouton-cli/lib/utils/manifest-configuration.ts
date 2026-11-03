/**
 * Ask an extended package's setup questions (manifest `configuration`).
 *
 * For every package the app EXTENDS (#2286 — `extends` is the only package
 * on-switch; `extendedPackages` comes from resolveExtendedPackages) whose
 * manifest declares `configuration` options, and `config.features.<alias>`
 * holds no config object yet, the user is prompted for each option (defaults
 * in CI). The answers are stored under `config.features.<alias>`.
 *
 * This used to also merge manifest collections into the app config; since
 * #2278 every package with collections ships them itself, so that was removed
 * (#2316).
 */

import * as p from '@clack/prompts'
// Direct import, not the jiti bridge: this file is .ts itself, and a second jiti
// copy of manifest-loader (own cache, own module instance) made coverage count
// the same branches twice and go negative, which the fallow audit refuses (#2286).
import { discoverManifests } from './manifest-loader.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CroutonConfig {
  features?: Record<string, boolean | Record<string, unknown>>
  [key: string]: unknown
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
  configuration?: Record<string, ManifestConfigOption>
}

/** Info about a feature that was interactively configured. */
export interface PromptedConfig {
  featureKey: string
  manifestId: string
  configObject: Record<string, unknown>
  /** runtimeConfig entries to write (e.g. { croutonBookings: { email: { enabled: true } } }) */
  runtimeConfig?: { server: Record<string, unknown>; public: Record<string, unknown> }
  /** .env hints to display after generation */
  envHints?: string[]
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

/** The manifest's default answers, used when nobody can be asked (CI). */
function defaultConfiguration(configuration: Record<string, ManifestConfigOption>): Record<string, unknown> {
  const configInner: Record<string, unknown> = {}
  for (const [dotPath, option] of Object.entries(configuration)) {
    setNestedValue(configInner, dotPath, option.default)
  }
  return { config: configInner }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Ask each extended package's setup questions and store the answers under
 * `config.features.<alias>` (mutates `config`). Returns what was configured
 * so the caller can persist it.
 */
export async function applyManifestConfiguration(config: CroutonConfig, extendedPackages: string[]): Promise<PromptedConfig[]> {
  const promptedConfigs: PromptedConfig[] = []
  if (extendedPackages.length === 0) return promptedConfigs

  const manifests: Manifest[] = await discoverManifests()

  // Detect non-interactive mode (CI or explicit flag)
  const isInteractive = process.stdout.isTTY && !process.env.CI

  for (const manifest of manifests) {
    if (!extendedPackages.includes(manifest.id)) continue
    if (!manifest.configuration || Object.keys(manifest.configuration).length === 0) continue

    // Derive feature alias from manifest id (e.g., 'crouton-bookings' → 'bookings')
    const featureKey = manifest.id.replace(/^crouton-/, '')
    if (!config.features) config.features = {}
    // Already configured: an object, not the bare `true` switch
    if ((config.features[featureKey] || true) !== true) continue

    const configObj = isInteractive
      ? await promptForConfiguration(featureKey, manifest.id, manifest.configuration)
      : defaultConfiguration(manifest.configuration)
    // Cancelled: leave the feature unconfigured
    if (!configObj) continue

    config.features[featureKey] = configObj
    promptedConfigs.push({
      featureKey,
      manifestId: manifest.id,
      configObject: configObj,
      ...buildRuntimeAndEnvHints(featureKey, configObj),
    })
  }

  return promptedConfigs
}
