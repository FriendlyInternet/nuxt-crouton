// Prune dangling collection references (#226).
//
// The writers behind `crouton config` only ever ADD entries (schema barrel, app.config,
// layer `extends`). Delete a collection folder and the entries stay, and the next run
// crashes loading the stale barrel. This reconciles: an entry that points at a
// collection/layer folder that no longer exists on disk is removed. Matching is EXACT
// (never `includes()`), so `gadgets` never takes `gadgetsArchive` with it.

import { readFile, writeFile, access, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseModule, generateCode } from 'magicast'
import { getSchemaPath } from './update-schema-index.ts'
import { resolveAppConfigPath } from './update-app-config.ts'

export interface PruneOptions {
  cwd?: string
  dryRun?: boolean
}

export interface PruneResult {
  removed: Array<{ file: string; entry: string }>
}

const COLLECTION_PATH_RE = /(?:^|\/)layers\/([^/]+)\/collections\/([^/]+)(?:\/|$)/

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const norm = (s: string) => s.replace(/\\/g, '/')

/** `layers/<layer>/collections/<name>` parsed out of an import/export source, if any. */
function parseCollectionSource(source: string): { layer: string; name: string } | null {
  const m = COLLECTION_PATH_RE.exec(norm(source))
  return m ? { layer: m[1]!, name: m[2]! } : null
}

function getOptions(mod: any): any {
  const d = mod.exports.default
  return d?.$type === 'function-call' ? d.$args[0] : d
}

function programBody(mod: any): any[] {
  const program = mod.$ast.program || mod.$ast
  return program?.body || []
}

async function readParsed(file: string): Promise<{ code: string; mod: any } | null> {
  if (!await exists(file)) return null
  const code = await readFile(file, 'utf-8')
  try {
    return { code, mod: parseModule(code) }
  } catch {
    console.log(`! Could not parse ${file} — skipped pruning dangling references there`)
    return null
  }
}

async function pruneSchemaBarrel(cwd: string, dryRun: boolean, out: PruneResult['removed']): Promise<void> {
  const file = await getSchemaPath(cwd)
  const parsed = await readParsed(file)
  if (!parsed) return
  const { mod } = parsed
  const program = mod.$ast.program || mod.$ast
  const body: any[] = program?.body || []
  const keep: any[] = []
  const found: string[] = []

  for (const node of body) {
    const isExport = node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration'
    const src = isExport && node.source?.value ? parseCollectionSource(String(node.source.value)) : null
    if (src && !await exists(join(cwd, 'layers', src.layer, 'collections', src.name))) {
      found.push(`${src.layer}/${src.name}`)
      continue
    }
    keep.push(node)
  }
  if (!found.length) return

  if (!dryRun) {
    program.body = keep
    await writeFile(file, generateCode(mod).code, 'utf-8')
  }
  for (const entry of found) out.push({ file, entry })
}

async function pruneAppConfig(cwd: string, dryRun: boolean, out: PruneResult['removed']): Promise<void> {
  const file = await resolveAppConfigPath(cwd)
  const parsed = await readParsed(file)
  if (!parsed) return
  const { mod } = parsed

  const dangling: Array<{ local: string; layer: string; name: string }> = []
  for (const node of programBody(mod)) {
    if (node.type !== 'ImportDeclaration' || !node.source?.value) continue
    const src = parseCollectionSource(String(node.source.value))
    if (!src || await exists(join(cwd, 'layers', src.layer, 'collections', src.name))) continue
    for (const spec of node.specifiers || []) {
      if (spec.local?.name) dangling.push({ local: spec.local.name, layer: src.layer, name: src.name })
    }
  }
  if (!dangling.length) return

  if (!dryRun) {
    const registry = getOptions(mod)?.croutonCollections
    for (const d of dangling) {
      if (registry) {
        for (const key of Object.keys(registry)) {
          const value = registry[key]
          if (value && (value.$type === 'identifier' ? value.$name : undefined) === d.local) {
            delete registry[key]
          }
        }
      }
      delete mod.imports[d.local]
    }
    await writeFile(file, generateCode(mod).code, 'utf-8')
  }
  for (const d of dangling) out.push({ file, entry: `${d.layer}/${d.name}` })
}

async function pruneExtends(
  file: string,
  isDangling: (entry: string) => Promise<string | null>,
  dryRun: boolean,
  out: PruneResult['removed'],
): Promise<void> {
  const parsed = await readParsed(file)
  if (!parsed) return
  const { mod } = parsed
  let ext: any
  try {
    ext = getOptions(mod)?.extends
  } catch {
    return
  }
  if (!ext || typeof ext.length !== 'number') return

  // Only string entries are judged; anything else is kept as written.
  const found: string[] = []
  const indexes: number[] = []
  for (let i = 0; i < ext.length; i++) {
    if (typeof ext[i] !== 'string') continue
    const label = await isDangling(ext[i])
    if (label) {
      found.push(label)
      indexes.push(i)
    }
  }
  if (!found.length) return
  if (!dryRun) {
    for (const i of indexes.reverse()) ext.splice(i, 1)
    await writeFile(file, generateCode(mod).code, 'utf-8')
  }
  for (const entry of found) out.push({ file, entry })
}

export async function pruneDanglingCollectionRefs(options: PruneOptions = {}): Promise<PruneResult> {
  const cwd = options.cwd ?? process.cwd()
  const dryRun = options.dryRun ?? false
  const removed: PruneResult['removed'] = []

  await pruneSchemaBarrel(cwd, dryRun, removed)
  await pruneAppConfig(cwd, dryRun, removed)

  // Each layer's nuxt.config.ts: `./collections/<name>` whose folder is gone
  const layersDir = resolve(cwd, 'layers')
  const layers = await readdir(layersDir, { withFileTypes: true })
    .then(es => es.filter(e => e.isDirectory()).map(e => e.name))
    .catch(() => [] as string[])
  for (const layer of layers) {
    await pruneExtends(join(layersDir, layer, 'nuxt.config.ts'), async (entry) => {
      const m = /^\.\/collections\/([^/]+)\/?$/.exec(norm(entry))
      if (!m) return null
      return await exists(join(layersDir, layer, 'collections', m[1]!)) ? null : `${layer}/${m[1]}`
    }, dryRun, removed)
  }

  // Root nuxt.config.ts: `./layers/<layer>` whose folder is gone
  await pruneExtends(join(cwd, 'nuxt.config.ts'), async (entry) => {
    const m = /^\.\/layers\/([^/]+)\/?$/.exec(norm(entry))
    if (!m) return null
    return await exists(join(layersDir, m[1]!)) ? null : m[1]!
  }, dryRun, removed)

  for (const r of removed) {
    const verb = dryRun ? 'Would prune' : 'Pruned'
    console.log(`↻ ${verb} dangling reference to ${r.entry} from ${r.file.replace(cwd + '/', '')}`)
  }

  return { removed }
}
