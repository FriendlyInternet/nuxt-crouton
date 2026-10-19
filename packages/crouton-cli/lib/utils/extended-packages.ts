// Which crouton packages does this app use? The ONE answer (#2286): the app's
// `extends` graph, walked transitively and statically (magicast, no Nuxt), so
// `@fyit/crouton-core` brings the packages it bundles (auth, admin, i18n) and a
// path extends to a package counts by its package.json name.
//
// `crouton.config.js features` used to be a second answer — four tables in the
// generator keyed on it and disagreed. Owner decision 2026-10-16: extends is the
// only package on-switch; `features.<alias>` only carries a package's prompted
// configuration (manifest-configuration.ts).

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readExtends, resolveLayerDir, layerConfigPath } from './schema-sources.ts'

const CROUTON_SPEC = /^@fyit\/(crouton-[a-z0-9-]+)(?:\/.*)?$/

/** `@fyit/crouton-pages`, `@fyit/crouton-themes/ko` → `crouton-pages`, `crouton-themes`. */
function idFromSpec(spec: string): string | null {
  const m = CROUTON_SPEC.exec(spec)
  return m ? m[1] : null
}

/** A resolved layer dir is a crouton package when its package.json says so. */
function idFromLayerDir(dir: string): string | null {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const name = JSON.parse(readFileSync(pkgPath, 'utf8'))?.name
    return typeof name === 'string' ? idFromSpec(name) : null
  } catch {
    return null
  }
}

/**
 * The crouton package ids (`crouton-core`, `crouton-bookings`, …) an app extends,
 * directly or through another layer, in discovery order. A `@fyit/crouton-*` spec
 * counts even when it cannot be node-resolved (the app says it extends it; the
 * manifest loader decides what that means). Non-crouton specs are ignored but
 * still walked when they resolve to a layer (an app's own `./layers/shop`).
 */
export function resolveExtendedPackages(appDir: string): string[] {
  const ids: string[] = []
  const visited = new Set<string>()

  const add = (id: string | null): void => {
    if (id && !ids.includes(id)) ids.push(id)
  }

  const visit = (dir: string): void => {
    if (!existsSync(dir)) return
    const real = realpathSync(dir)
    if (visited.has(real)) return
    visited.add(real)
    const cfg = layerConfigPath(real)
    if (!cfg) return
    for (const spec of readExtends(cfg)) {
      add(idFromSpec(spec))
      const target = resolveLayerDir(spec, real)
      if (!target) continue
      if (!idFromSpec(spec)) add(idFromLayerDir(target) ?? (basename(target).startsWith('crouton-') ? basename(target) : null))
      visit(target)
    }
  }

  visit(appDir)
  return ids
}

/** `crouton-bookings` → `bookings`: the alias `features.<alias>` and manifests use. */
export function packageAlias(id: string): string {
  return id.replace(/^crouton-/, '')
}
