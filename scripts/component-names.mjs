#!/usr/bin/env node
/**
 * Check every component a package manifest names against the components Nuxt itself registers
 * for that package (#3898). A manifest name with no component fails `--check`. A component used
 * outside its package (tag, resolveComponent('Name'), or a quoted 'Crouton…' string in apps/, pocs/
 * or another package) that the manifest does not name fails it too (#3909).
 *
 *   node scripts/component-names.mjs --check            # exit 1 on a name with no component, or a component used elsewhere but not named (CI)
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
function missingIn(pkg, have) {
  return manifestNames(pkg).filter(n => !have.has(n)).map(n => `${pkg}: manifest names ${n}, no such component`)
}

// ── used outside its package (#3909): comments are not stripped, so a mention there counts ───────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', 'dist', '_archive', 'e2e', 'tests', '__tests__'])
const SEARCH_EXT = /\.(vue|ts|js|mjs)$/
const SKIP_FILE = /\.(test|spec)\.|\.d\.ts$/

function walk(dir, out) {
  if (!existsSync(dir)) return out
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) {
      if (!SKIP_DIRS.has(d.name)) walk(join(dir, d.name), out)
    } else if (d.isFile() && SEARCH_EXT.test(d.name) && !SKIP_FILE.test(d.name)) {
      const file = join(dir, d.name)
      out.push({ file, text: readFileSync(file, 'utf8') })
    }
  }
  return out
}

let sources
const allSources = () => (sources ??= ['apps', 'pocs', 'packages'].reduce((acc, d) => walk(join(ROOT, d), acc), []))

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** True when a file outside packages/<pkg>/ uses `name` as a tag, via resolveComponent, or (Crouton…) as a quoted string. */
function usedOutside(pkg, name) {
  const own = join(PKGS, pkg) + sep
  const forms = [
    new RegExp(`(?<![A-Za-z0-9_$)\\]])<${esc(name)}(?![A-Za-z0-9-])`),
    new RegExp(`resolveComponent\\((['"])${esc(name)}\\1\\)`)
  ]
  if (name.startsWith('Crouton')) forms.push(new RegExp(`(['"])${esc(name)}\\1`))
  return allSources().some(({ file, text }) => !file.startsWith(own) && forms.some(re => re.test(text)))
}

/** `<pkg>: <Name> is used outside the package, not named in the manifest` for each such component. */
function unnamedIn(pkg, have) {
  const named = new Set(manifestNames(pkg))
  return [...have.keys()].filter(n => !named.has(n) && usedOutside(pkg, n))
    .map(n => `${pkg}: ${n} is used outside the package, not named in the manifest`)
}

function check(fresh) {
  const pkgs = packages()
  const missing = []
  const unnamed = []
  for (const pkg of pkgs) {
    const have = registered(pkg, fresh)
    missing.push(...missingIn(pkg, have))
    unnamed.push(...unnamedIn(pkg, have))
  }
  if (missing.length || unnamed.length) {
    for (const m of [...missing, ...unnamed]) console.error(m)
    process.exit(1)
  }
  const named = pkgs.reduce((n, pkg) => n + manifestNames(pkg).length, 0)
  console.log(`${named} components named, 0 without a file, 0 used outside and not named`)
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
