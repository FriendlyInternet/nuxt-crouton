#!/usr/bin/env node
/**
 * Check every component a package manifest names against the components Nuxt itself registers
 * for that package (#3898). A manifest name with no component fails `--check`.
 *
 *   node scripts/component-names.mjs --check            # exit 1 on a name with no component (CI)
 *   node scripts/component-names.mjs --list <pkg>       # print `Name<TAB>file`, sorted
 *   add --fresh to re-run `nuxt prepare` even when .nuxt/components.d.ts exists
 *
 * A "package" is a packages/<pkg>/ folder with a crouton.manifest.ts. Its Nuxt folders are the
 * package root when it has a nuxt.config.ts, else its direct sub-folders that have one
 * (`playground` skipped). Nuxt's list is each folder's .nuxt/components.d.ts.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { manifestOf } from './lib/read-manifest.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKGS = join(ROOT, 'packages')
const EXPORT_RE = /^export const (\w+): typeof import\("([^"]+)"\)/gm

const packages = () => readdirSync(PKGS).filter(p => existsSync(join(PKGS, p, 'crouton.manifest.ts'))).sort()

function nuxtFolders(pkg) {
  const dir = join(PKGS, pkg)
  if (existsSync(join(dir, 'nuxt.config.ts'))) return [dir]
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'playground' && existsSync(join(dir, d.name, 'nuxt.config.ts')))
    .map(d => join(dir, d.name))
    .sort()
}

function prepare(folder, fresh) {
  if (!fresh && existsSync(join(folder, '.nuxt/components.d.ts'))) return
  const r = spawnSync('npx', ['nuxt', 'prepare'], { cwd: folder, encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(`nuxt prepare failed in ${relative(ROOT, folder)}`)
    if (r.stderr) console.error(r.stderr.slice(-2000))
    process.exit(1)
  }
}

/** name → file (relative to the package) for every component Nuxt registers from this package. */
function registered(pkg, fresh) {
  const pkgDir = join(PKGS, pkg)
  const out = new Map()
  for (const folder of nuxtFolders(pkg)) {
    prepare(folder, fresh)
    const dts = join(folder, '.nuxt/components.d.ts')
    if (!existsSync(dts)) continue
    for (const [, name, path] of readFileSync(dts, 'utf8').matchAll(EXPORT_RE)) {
      if (name.startsWith('Lazy') || !path.startsWith('../') || !path.endsWith('.vue')) continue
      const abs = resolve(folder, '.nuxt', path)
      const rel = relative(pkgDir, abs)
      if (rel.startsWith('..') || rel.split(sep).some(s => s === 'node_modules' || s === 'stubs')) continue
      out.set(name, rel.split(sep).join('/'))
    }
  }
  return out
}

const manifestNames = pkg => (manifestOf(`packages/${pkg}/crouton.manifest.ts`)?.provides?.components ?? []).map(c => c.name)

function list(pkg, fresh) {
  if (!packages().includes(pkg)) {
    console.error(`--list needs a package with a crouton.manifest.ts (got ${pkg ?? 'nothing'})`)
    process.exit(2)
  }
  const byName = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)
  for (const [name, file] of [...registered(pkg, fresh)].sort(byName)) console.log(`${name}\t${file}`)
}

/** `<pkg>: manifest names <Name>, no such component` for each name the package does not register. */
function missingIn(pkg, fresh) {
  const have = registered(pkg, fresh)
  return manifestNames(pkg).filter(n => !have.has(n)).map(n => `${pkg}: manifest names ${n}, no such component`)
}

function check(fresh) {
  const pkgs = packages()
  const missing = pkgs.flatMap(pkg => missingIn(pkg, fresh))
  if (missing.length) {
    for (const m of missing) console.error(m)
    process.exit(1)
  }
  const named = pkgs.reduce((n, pkg) => n + manifestNames(pkg).length, 0)
  console.log(`${named} components named, 0 without a file`)
}

function main(argv) {
  const fresh = argv.includes('--fresh')
  const li = argv.indexOf('--list')
  if (li !== -1) return list(argv[li + 1], fresh)
  if (argv.includes('--check')) return check(fresh)
  console.error('usage: node scripts/component-names.mjs --check | --list <pkg> [--fresh]')
  process.exit(2)
}

main(process.argv.slice(2))
