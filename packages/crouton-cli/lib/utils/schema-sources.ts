// schema-sources.ts — reproduce NuxtHub's per-layer schema glob over the app's
// recursive `extends` graph, WITHOUT a Nuxt process in the loop (epic #1445,
// WS1a #1446). NuxtHub globs, per resolved layer dir:
//   server/db/schema.ts · server/db/schema.<dialect>.ts · server/db/schema/*.ts
// (see @nuxthub/core dist/module.mjs getSchemaPaths). We walk the same layer
// set kit resolves — the app root, its auto-scanned layers/*, and every
// `extends` entry (relative, `@fyit/*` bare, or package subpath) resolved from
// each layer's OWN dir (pnpm strict isolation) — and collect the same globs.
//
// Deliberately NOT handled (documented limitations, brief §5 WS1):
//   - the `hub:db:schema:extend` hook (asserted unused by a repo-invariant test)
//   - `.nuxtrc`-contributed extends (no in-repo usage)
// The identity-aware duplicate-table gate over this path list is WS1b (#1447).

import { createRequire } from 'node:module'
import { existsSync, realpathSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import { parseModule } from 'magicast'

export interface ResolveSchemaSourcesOptions {
  /** Dialect for the schema.<dialect>.ts glob + filter. Defaults to sqlite. */
  dialect?: string
}

export interface SchemaGraph {
  /** Ordered, deduped, absolute schema-source paths (the NuxtHub glob set). */
  paths: string[]
  /** Declared `extends` specs that could not be resolved to a layer dir. */
  unresolved: string[]
}

const NUXT_CONFIG_NAMES = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']

/** Walk up from `startDir` to the nearest dir holding a nuxt.config.* (the layer root). */
function findLayerRoot(startDir: string): string | null {
  let dir = startDir
  for (let i = 0; i < 20; i++) {
    if (NUXT_CONFIG_NAMES.some(name => existsSync(join(dir, name)))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function layerConfigPath(dir: string): string | null {
  for (const name of NUXT_CONFIG_NAMES) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}

/** Statically extract the `extends` string entries from a nuxt.config.* — no execution. */
function readExtends(configPath: string): string[] {
  let code: string
  try {
    code = readFileSync(configPath, 'utf8')
  } catch {
    return []
  }
  let mod
  try {
    mod = parseModule(code)
  } catch {
    return []
  }
  // Unwrap `defineNuxtConfig({...})`; a plain `export default {...}` is used as-is.
  let def: any = mod.exports.default
  if (def && def.$type === 'function-call') def = def.$args?.[0]
  const ext = def && def.extends
  if (!ext) return []
  try {
    return [...ext].filter((x: unknown): x is string => typeof x === 'string')
  } catch {
    return [] // non-literal extends (variable/spread) — not statically resolvable
  }
}

/** Resolve an extends spec to a layer dir, FROM the extending layer's own dir. */
function resolveLayerDir(spec: string, fromDir: string): string | null {
  // Relative / absolute path extends resolve against the extending layer.
  if (spec.startsWith('.') || isAbsolute(spec)) {
    const candidate = resolve(fromDir, spec)
    return existsSync(candidate) ? findLayerRoot(candidate) : null
  }
  // Bare package or package subpath — node-resolve from the extending layer's
  // dir (pnpm strict isolation), then walk up to the layer root. A subpath that
  // doesn't resolve (e.g. a theme with no resolvable entry) must NOT crash.
  try {
    const req = createRequire(join(fromDir, '_schema-sources-resolver_.js'))
    return findLayerRoot(dirname(req.resolve(spec)))
  } catch {
    return null
  }
}

/**
 * Resolve the app's schema graph SYNCHRONOUSLY — the ordered, deduped, absolute
 * schema-source paths NuxtHub would glob, plus any declared `extends` specs that
 * could not be resolved. The body is sync (fs + magicast, no I/O await) so the
 * generated drizzle.config.ts can call it without top-level await (drizzle-kit's
 * esbuild config loader is CJS and rejects TLA).
 */
export function resolveSchemaGraph(
  appDir: string,
  options: ResolveSchemaSourcesOptions = {}
): SchemaGraph {
  const dialect = options.dialect ?? 'sqlite'
  const visitedDirs = new Set<string>() // realpath'd layer roots — first-wins
  const seenFiles = new Set<string>() // realpath'd file paths — dedup
  const ordered: string[] = []
  const unresolved: string[] = []

  const collectGlobs = (layerDir: string): void => {
    const dbDir = join(layerDir, 'server', 'db')
    if (!existsSync(dbDir)) return
    const candidates: string[] = [
      join(dbDir, 'schema.ts'),
      join(dbDir, `schema.${dialect}.ts`)
    ]
    const schemaSubdir = join(dbDir, 'schema')
    if (existsSync(schemaSubdir)) {
      let entries: string[] = []
      try {
        entries = readdirSync(schemaSubdir).sort()
      } catch {
        entries = []
      }
      for (const f of entries) if (f.endsWith('.ts')) candidates.push(join(schemaSubdir, f))
    }
    for (const p of candidates) {
      if (!existsSync(p)) continue
      const real = realpathSync(p)
      if (seenFiles.has(real)) continue
      seenFiles.add(real)
      ordered.push(p)
    }
  }

  const visitLayer = (dir: string): void => {
    if (!existsSync(dir)) return
    const real = realpathSync(dir)
    if (visitedDirs.has(real)) return
    visitedDirs.add(real)

    // (1) this layer's own globs (collected before recursion — first-wins dedup)
    collectGlobs(real)

    // (2) auto-scanned layers/* — kit globs these even WITHOUT an extends entry
    //     (reverse-alphabetical, processed before explicit extends)
    const layersDir = join(real, 'layers')
    if (existsSync(layersDir)) {
      let subs: string[] = []
      try {
        subs = readdirSync(layersDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name)
          .sort()
          .reverse()
      } catch {
        subs = []
      }
      for (const name of subs) visitLayer(join(real, 'layers', name))
    }

    // (3) explicit extends — each resolved from THIS layer's own dir
    const cfg = layerConfigPath(real)
    if (cfg) {
      for (const spec of readExtends(cfg)) {
        const target = resolveLayerDir(spec, real)
        if (target) visitLayer(target)
        else if (!unresolved.includes(spec)) unresolved.push(spec)
      }
    }
  }

  visitLayer(appDir)
  return { paths: ordered, unresolved }
}

/**
 * Resolve the ordered, deduped, absolute list of schema-source files an app's
 * layer graph contributes — the same set NuxtHub globs, assembled without Nuxt.
 */
export async function resolveSchemaSources(
  appDir: string,
  options: ResolveSchemaSourcesOptions = {}
): Promise<string[]> {
  return resolveSchemaGraph(appDir, options).paths
}

/** Synchronous variant of {@link resolveSchemaSources} — for the CJS drizzle config. */
export function resolveSchemaSourcesSync(
  appDir: string,
  options: ResolveSchemaSourcesOptions = {}
): string[] {
  return resolveSchemaGraph(appDir, options).paths
}
