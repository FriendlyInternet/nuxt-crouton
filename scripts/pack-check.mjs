#!/usr/bin/env node
// pack-check (#3393) — pack every public @fyit/* package the way `pnpm publish` would and check
// the tarball can stand on its own once it's installed from npm:
//   (a) no `workspace:` / `catalog:` protocol left in the packed package.json
//   (b) every exports/main/types/bin target is in the tarball
//   (c) every tracked layer folder (app, server, shared, i18n, …) is in the tarball
//   (d) a tarball with dist/ gets it from a prepack/prepare build, not from a leftover local build
//   (e) every path the package's nuxt.config.ts loads (join(currentDir,'…'), from './…',
//       new URL('./…')) is in the tarball — a path missing from the source too is only a warning
// plus: all public versions are equal (lockstep release), and undeclared @fyit/* imports (warn-only).
//
// Usage: node scripts/pack-check.mjs   → one line per package, `N/M ok`, exit 1 on any FAIL.
// Pure functions are exported for scripts/pack-check.test.mjs; main() only runs from the CLI.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LAYER_DIRS = ['app', 'server', 'shared', 'i18n', 'modules', 'layers', 'public', 'collections']
const EXTS = ['.ts', '.mjs', '.js', '.json']

/** Every `packages/*` whose package.json is not `private: true` → [{ dir, pkg }]. */
export function publicPackages(root) {
  const base = join(root, 'packages')
  const out = []
  for (const name of readdirSync(base).sort()) {
    const file = join(base, name, 'package.json')
    if (!existsSync(file)) continue
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    if (pkg.private === true) continue
    out.push({ dir: join(base, name), pkg })
  }
  return out
}

const strip = p => String(p).replace(/^\.\//, '')

/** Every file a consumer can resolve by package metadata: exports leaves, main, types, bin values. */
export function packTargets(pkg) {
  const out = new Set()
  const walk = (v) => {
    if (typeof v === 'string') out.add(strip(v))
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x)
  }
  walk(pkg.exports)
  if (typeof pkg.main === 'string') out.add(strip(pkg.main))
  if (typeof pkg.types === 'string') out.add(strip(pkg.types))
  if (typeof pkg.bin === 'string') out.add(strip(pkg.bin))
  else if (pkg.bin && typeof pkg.bin === 'object') for (const b of Object.values(pkg.bin)) out.add(strip(b))
  return [...out].sort()
}

/** Relative paths a nuxt.config.ts loads, `./` stripped. `import type` and bare `new URL('./')` skipped. */
export function configRefs(src) {
  const text = String(src || '')
  const out = new Set()
  for (const m of text.matchAll(/join\(\s*currentDir\s*,\s*['"]([^'"]+)['"]/g)) out.add(strip(m[1]))
  for (const m of text.matchAll(/^\s*import\s+(?!type\s)[^;]*?\sfrom\s+['"](\.\.?\/[^'"]+)['"]/gm)) out.add(strip(m[1]))
  for (const m of text.matchAll(/new URL\(\s*['"](\.\/[^'"]+)['"]\s*,\s*import\.meta\.url/g)) {
    const p = strip(m[1])
    if (p && p !== '.') out.add(p)
  }
  return [...out].sort()
}

/** Is `ref` in the tarball — as a file, a folder, or an extensionless import (.ts/.mjs/.js/.json)? */
export function inTarball(ref, files) {
  const r = strip(ref).replace(/\/$/, '')
  const set = files instanceof Set ? files : new Set(files)
  if (set.has(r)) return true
  if (EXTS.some(e => set.has(r + e))) return true
  for (const f of set) if (f.startsWith(r + '/')) return true
  return false
}

function targetPresent(target, files) {
  if (!target.includes('*')) return inTarball(target, files) || target === 'package.json'
  const prefix = target.slice(0, target.indexOf('*'))
  const dir = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : ''
  if (!dir) return true
  return files.some(f => f.startsWith(dir + '/'))
}

/**
 * The rules over one packed package. Pure.
 * @param {{ pkg: object, packedJson?: string, files: string[], trackedTopDirs?: string[],
 *   configRefs?: string[], sourceExists?: (ref: string) => boolean }} input
 * @returns {{ problems: string[], warnings: string[] }}
 */
export function checkPacked({ pkg, packedJson, files, trackedTopDirs = [], configRefs: refs = [], sourceExists = () => true }) {
  const targets = packTargets(pkg)
  const config = ruleConfigRefs(refs, files, sourceExists)
  const problems = [
    ...ruleProtocols(packedJson ?? JSON.stringify(pkg)),
    ...ruleTargets(targets, files),
    ...ruleLayerDirs(trackedTopDirs, files),
    ...ruleDistBuild(pkg, targets, files),
    ...config.problems,
  ]
  return { problems, warnings: config.warnings }
}

/** (a) no workspace:/catalog: protocol left in the packed package.json. */
function ruleProtocols(json) {
  return ['workspace:', 'catalog:']
    .filter(p => json.includes(`"${p}`))
    .map(p => `packed package.json still has ${p}`)
}

/** (b) every exports/main/types/bin target is in the tarball. */
function ruleTargets(targets, files) {
  return targets.filter(t => !targetPresent(t, files)).map(t => `target ${t} is not in the tarball`)
}

/** (c) every tracked layer folder is in the tarball. */
function ruleLayerDirs(trackedTopDirs, files) {
  return trackedTopDirs
    .filter(d => LAYER_DIRS.includes(d) && !files.some(f => f.startsWith(d + '/')))
    .map(d => `tracked folder ${d}/ is not in the tarball`)
}

/** (d) a shipped dist/ must come from a prepack/prepare build. */
function ruleDistBuild(pkg, targets, files) {
  const usesDist = [...files, ...targets].some(f => f.startsWith('dist/'))
  const scripts = pkg.scripts || {}
  return usesDist && !scripts.prepack && !scripts.prepare ? ['ships dist/ but has no prepack/prepare build'] : []
}

/** (e) every path nuxt.config loads is in the tarball; one missing from the source too is a warning. */
function ruleConfigRefs(refs, files, sourceExists) {
  const missing = refs.filter(ref => !inTarball(ref, files))
  return {
    problems: missing.filter(ref => sourceExists(ref)).map(ref => `nuxt.config loads ${ref} but the tarball lacks it`),
    warnings: missing.filter(ref => !sourceExists(ref))
      .map(ref => `nuxt.config references ${ref}, which does not exist in the source (stale config line)`),
  }
}

/** All public versions must be equal; one problem naming the odd ones out, else none. */
export function checkLockstep(pkgs) {
  const counts = new Map()
  for (const p of pkgs) counts.set(p.version, (counts.get(p.version) || 0) + 1)
  if (counts.size <= 1) return []
  const major = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const odd = pkgs.filter(p => p.version !== major).map(p => `${p.name}@${p.version}`)
  return [`versions are not lockstep (most are ${major}): ${odd.join(', ')}`]
}

/** @fyit/* packages imported at runtime by `sources` but not declared in any dependency field. Warn-only. */
export function undeclaredImports(pkg, sources) {
  const declared = new Set([pkg.name, ...['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']
    .flatMap(k => Object.keys(pkg[k] || {}))])
  const out = new Set()
  for (const { text } of sources) {
    const code = String(text)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^\s*import\s+type\s[\s\S]*?from\s+['"][^'"]+['"]/gm, '')
    for (const m of code.matchAll(/(?:from\s+|import\s*\(\s*|^\s*import\s+)['"](@fyit\/[a-z0-9-]+)/gm)) {
      if (!declared.has(m[1])) out.add(m[1])
    }
  }
  return [...out].sort()
}

// ── CLI ──────────────────────────────────────────────────────────────────────

// A job with only setup-node has no `pnpm` on PATH; Node's bundled corepack provides it.
let pnpmCmd
function pnpm() {
  if (pnpmCmd) return pnpmCmd
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'ignore' })
    pnpmCmd = ['pnpm', []]
  }
  catch {
    pnpmCmd = ['corepack', ['pnpm']]
  }
  return pnpmCmd
}

function packOne(dir) {
  const dest = mkdtempSync(join(tmpdir(), 'pack-check-'))
  try {
    const [cmd, pre] = pnpm()
    execFileSync(cmd, [...pre, 'pack', '--pack-destination', dest], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' } })
    const tgz = readdirSync(dest).find(f => f.endsWith('.tgz'))
    if (!tgz) throw new Error('pnpm pack produced no tarball')
    const path = join(dest, tgz)
    const files = execFileSync('tar', ['tzf', path], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\n').filter(Boolean).filter(f => !f.endsWith('/')).map(f => f.replace(/^package\//, ''))
    const packedJson = execFileSync('tar', ['xzf', path, '-O', 'package/package.json'], { encoding: 'utf8' })
    return { files, packedJson }
  }
  finally {
    rmSync(dest, { recursive: true, force: true })
  }
}

function trackedTopDirsOf(dir) {
  const out = execFileSync('git', ['ls-files', '.'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 })
  return [...new Set(out.split('\n').filter(f => f.includes('/')).map(f => f.split('/')[0]))].sort()
}

function runtimeSources(dir, files) {
  return files
    .filter(f => /\.(ts|mjs|js|vue)$/.test(f) && !f.endsWith('.d.ts') && !f.startsWith('dist/'))
    .filter(f => existsSync(join(dir, f)))
    .map(f => ({ path: f, text: readFileSync(join(dir, f), 'utf8') }))
}

/** Pack + check one package from its source dir → { problems, warnings }. */
function checkPackage(dir, pkg) {
  const { files, packedJson } = packOne(dir)
  const cfgPath = join(dir, 'nuxt.config.ts')
  const refs = existsSync(cfgPath) ? configRefs(readFileSync(cfgPath, 'utf8')) : []
  const sourceExists = ref => [ref, ...EXTS.map(e => ref + e)].some(p => existsSync(join(dir, p)))
  const res = checkPacked({ pkg, packedJson, files, trackedTopDirs: trackedTopDirsOf(dir), configRefs: refs, sourceExists })
  for (const name of undeclaredImports(pkg, runtimeSources(dir, files))) res.warnings.push(`imports ${name} but does not declare it`)
  return res
}

/** The useful part of a failed `pnpm pack`: its ERR/error lines, else its last lines. */
function packFailure(err) {
  const lines = [err?.stdout, err?.stderr].map(b => String(b || '')).join('\n')
    .split('\n').map(l => l.trim()).filter(Boolean)
  const errLines = lines.filter(l => /ERR|error/i.test(l))
  const why = (errLines.length ? errLines : lines).slice(-3).join(' ') || String(err?.message || err)
  return { problems: [`pack failed: ${why}`], warnings: [] }
}

function safeCheck(dir, pkg) {
  try {
    return checkPackage(dir, pkg)
  }
  catch (err) {
    return packFailure(err)
  }
}

function report(label, res) {
  console.log(res.problems.length ? `${label}: FAIL — ${res.problems.join('; ')}` : `${label}: ok`)
  for (const w of res.warnings) console.log(`  warn: ${w}`)
  return res.problems.length === 0
}

function main() {
  // PACK_CHECK_ROOT lets the test run the real CLI over a fixture repo.
  const root = resolve(process.env.PACK_CHECK_ROOT || join(import.meta.dirname, '..'))
  const pkgs = publicPackages(root)
  const ok = pkgs.filter(({ dir, pkg }) => report(`${pkg.name}@${pkg.version}`, safeCheck(dir, pkg))).length
  const lock = checkLockstep(pkgs.map(p => p.pkg))
  for (const p of lock) console.log(`FAIL — ${p}`)
  console.log(`${ok}/${pkgs.length} ok`)
  if (ok < pkgs.length || lock.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
