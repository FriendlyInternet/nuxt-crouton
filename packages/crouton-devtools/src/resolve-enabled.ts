/**
 * Pure resolution of the unified dev-tools decision (#811).
 *
 * One flag, `NUXT_PUBLIC_CROUTON_DEVTOOLS`, now governs the whole glasses menu
 * (launcher + tools). The default is **folder-detected** from `rootDir`:
 *   - on   under `pocs/` + `fixtures/` (the incubator)
 *   - off  under `apps/` (and anything else) — a launched app is trusted to work
 * Local dev is always on. An explicit override wins over the folder default
 * either way. The old `NUXT_PUBLIC_CROUTON_REVIEW` / `NUXT_PUBLIC_CROUTON_ERUDA`
 * flags are kept as **on-only deprecated aliases** for one transition (#808 #4).
 *
 * Kept pure (no Nuxt, no process) so it is unit-testable in isolation; the
 * module wires `process.env` + `nuxt.options` into it.
 */

export interface DevtoolsEnvInput {
  /** `nuxt.options.rootDir` — the consuming app's root */
  rootDir: string
  /** `nuxt.options.dev` */
  dev: boolean
  /** `NUXT_PUBLIC_CROUTON_DEVTOOLS` — the unified override, `'true'`/`'false'` */
  devtools?: string | undefined
  /** deprecated alias: `NUXT_PUBLIC_CROUTON_REVIEW` (on-only) */
  review?: string | undefined
  /** deprecated alias: `NUXT_PUBLIC_CROUTON_ERUDA` (on-only) */
  eruda?: string | undefined
}

export interface DevtoolsResolution {
  /** the menu (launcher + tool plugins) ships in this build */
  menuEnabled: boolean
  /**
   * Annotate's build-time machinery — the `data-crouton-src` compiler transform
   * + the `/api/_review` server bridge + the `croutonReview` server config —
   * should be installed. Only meaningful on a real (non-dev) build that ships
   * the menu, so a deployed staging preview's Annotate tool can resolve source
   * files and post feedback.
   */
  annotateMachineryOn: boolean
  /** which deprecated alias env vars were seen (for a one-time deprecation warning) */
  deprecatedAliases: string[]
}

/** Folder-detected default: on under pocs/ + fixtures/, off everywhere else. */
export function folderDefault(rootDir: string): boolean {
  const norm = String(rootDir).replace(/\\/g, '/')
  return /(^|\/)(pocs|fixtures)(\/|$)/.test(norm)
}

export function resolveDevtools(input: DevtoolsEnvInput): DevtoolsResolution {
  const { rootDir, dev } = input
  const reviewAlias = input.review === 'true'
  const erudaAlias = input.eruda === 'true'

  const deprecatedAliases: string[] = []
  if (reviewAlias) deprecatedAliases.push('NUXT_PUBLIC_CROUTON_REVIEW')
  if (erudaAlias) deprecatedAliases.push('NUXT_PUBLIC_CROUTON_ERUDA')

  let menuEnabled: boolean
  if (input.devtools === 'true') {
    // Explicit opt-in — forces the menu on anywhere (incl. a launched app).
    menuEnabled = true
  } else if (input.devtools === 'false') {
    // Explicit opt-out — wins everywhere, including local dev.
    menuEnabled = false
  } else if (dev) {
    // No explicit flag → always on locally.
    menuEnabled = true
  } else {
    // A build with no override → deprecated aliases (on-only) or the folder default.
    menuEnabled = reviewAlias || erudaAlias || folderDefault(rootDir)
  }

  return {
    menuEnabled,
    annotateMachineryOn: menuEnabled && !dev,
    deprecatedAliases
  }
}
