#!/usr/bin/env node
// Report-only (#3407): which apps'/POCs' generated collections are behind the generator?
// Regenerates each app in a throwaway sibling copy (`crouton config --force`), compares the
// collection trees with what is committed. NEVER fails on findings (exit 2 = bad usage only).
// Usage: node scripts/app-collection-drift.mjs [--json] [--out <file>] [--root <dir>]
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isCheckedRoute, walk } from './check-collection-body-validation.mjs'

// Intentional hand edits: repo-relative collection dir -> reason. Listed, never hidden.
export const ALLOW = {}

const SKIP_COPY = new Set(['node_modules', '.nuxt', '.output', '.data'])
const posix = p => p.split(sep).join('/')

/** Read every file of each layers/<layer>/collections/<name>/ tree -> { 'layer/name/rel': Buffer } */
export function readCollections(appDir) {
  const out = {}
  const layers = join(appDir, 'layers')
  if (!existsSync(layers)) return out
  for (const layer of readdirSync(layers)) {
    const col = join(layers, layer, 'collections')
    if (!existsSync(col) || !statSync(col).isDirectory()) continue
    for (const f of walk(col)) out[posix(join('layers', layer, 'collections', relative(col, f)))] = readFileSync(f)
  }
  return out
}

const collectionOf = p => p.split('/').slice(0, 4).join('/') // layers/<l>/collections/<name>

export function compareTrees(committed, regenerated) {
  const changed = []
  const missing = []
  const extra = []
  for (const [p, buf] of Object.entries(regenerated)) {
    if (!(p in committed)) missing.push(p)
    else if (!committed[p].equals(buf)) changed.push(p)
  }
  for (const p of Object.keys(committed)) if (!(p in regenerated)) extra.push(p)
  const cDirs = new Set(Object.keys(committed).map(collectionOf))
  const rDirs = new Set(Object.keys(regenerated).map(collectionOf))
  return {
    changed,
    missing,
    extra,
    configuredNotCommitted: [...rDirs].filter(d => !cDirs.has(d)),
    committedNotConfigured: [...cDirs].filter(d => !rDirs.has(d)),
  }
}

/** Committed create/edit routes that read the body without readValidatedBody (reuses #3377's route test). */
export function missesBodyValidation(committed) {
  return Object.entries(committed)
    .filter(([p]) => isCheckedRoute(`x/${p}`))
    .filter(([, buf]) => !buf.toString('utf8').includes('readValidatedBody('))
    .map(([p]) => p)
}

export function errorLine(text) {
  const line = String(text || '').split('\n').find(l => /Error:/.test(l)) || String(text || '').split('\n')[0] || 'unknown error'
  return line.trim()
}

/** Regenerate an app in a sibling copy; always remove the copy. */
export function regenerate(appDir, { run = execFileSync } = {}) {
  const parent = resolve(appDir, '..')
  const name = appDir.split(sep).pop()
  const copy = join(parent, `.${name}.collection-drift`)
  rmSync(copy, { recursive: true, force: true })
  try {
    cpSync(appDir, copy, { recursive: true, filter: src => !SKIP_COPY.has(src.split(sep).pop()) })
    try {
      run('node', ['../../packages/crouton-cli/bin/crouton-generate.js', 'config', '--force'], {
        cwd: copy, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      return { status: 'error', error: errorLine(`${e.stderr || ''}\n${e.stdout || ''}\n${e.message || ''}`) }
    }
    return { status: 'ok', tree: readCollections(copy) }
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}

async function hasCollections(cfg) {
  try {
    const mod = await import(pathToFileURL(cfg).href)
    const cols = (mod.default || mod).collections
    return Array.isArray(cols) ? cols.length > 0 : Boolean(cols && Object.keys(cols).length)
  } catch { return false /* unreadable config: not checkable */ }
}

function appCandidates(root) {
  return ['apps', 'pocs'].flatMap((group) => {
    const base = join(root, group)
    if (!existsSync(base)) return []
    return readdirSync(base).sort()
      .filter(name => !name.startsWith('.'))
      .map(name => ({ id: `${group}/${name}`, cfg: join(base, name, 'crouton.config.js') }))
      .filter(c => existsSync(c.cfg))
  })
}

export async function discoverApps(root) {
  const apps = []
  for (const c of appCandidates(root)) {
    if (await hasCollections(c.cfg)) apps.push(c.id)
  }
  return apps
}

/** Classify an app's collections; allow-list entries are keyed by repo-relative collection dir. */
export function analyze(app, committed, result, allow = ALLOW) {
  if (result.status === 'error') return { app, status: 'error', error: result.error, routesWithoutBodyValidation: missesBodyValidation(committed) }
  const cmp = compareTrees(committed, result.tree)
  const behindDirs = new Set([...cmp.changed, ...cmp.missing, ...cmp.extra].map(collectionOf))
  for (const d of [...cmp.configuredNotCommitted, ...cmp.committedNotConfigured]) behindDirs.add(d)
  const allDirs = new Set([...Object.keys(committed), ...Object.keys(result.tree)].map(collectionOf))
  const collections = [...allDirs].sort().map((d) => {
    const key = `${app}/${d}`
    if (behindDirs.has(d)) return key in allow ? { dir: key, status: 'allowed', reason: allow[key] } : { dir: key, status: 'behind' }
    return { dir: key, status: 'current' }
  })
  const problems = Object.keys(allow)
    .filter(k => k.startsWith(`${app}/`))
    .filter(k => !collections.some(c => c.dir === k && c.status === 'allowed'))
    .map(k => `${k}: allow-listed but now current or gone — remove from ALLOW`)
  return {
    app,
    status: collections.some(c => c.status === 'behind') ? 'behind' : 'current',
    collections,
    filesBehind: cmp.changed.length + cmp.missing.length + cmp.extra.length,
    examples: [...cmp.changed, ...cmp.missing, ...cmp.extra].slice(0, 5),
    configuredNotCommitted: cmp.configuredNotCommitted,
    committedNotConfigured: cmp.committedNotConfigured,
    routesWithoutBodyValidation: missesBodyValidation(committed),
    problems,
  }
}

export function readDriftReport(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { error: 'report could not run — see the "App collection drift" step log' }
  }
}

function appLines(a) {
  const out = []
  if (a.status === 'error') out.push(`- \`${a.app}\` — ⛔ can't regenerate: ${a.error}`)
  for (const c of (a.collections || []).filter(c => c.status === 'allowed')) out.push(`- \`${c.dir}\` — allowed: ${c.reason}`)
  const behind = (a.collections || []).filter(c => c.status === 'behind').length
  if (behind) out.push(`- \`${a.app}\` — 🟡 ${behind}/${(a.collections || []).length} collections behind (${a.filesBehind} files)`)
  const routes = (a.routesWithoutBodyValidation || []).length
  if (routes) out.push(`- \`${a.app}\` — 🔴 ${routes} routes without body validation`)
  return [...out, ...(a.problems || []).map(p => `- \`${a.app}\` — ${p}`)]
}

export function renderDriftLines(report) {
  if (!report) return null
  if (report.error) return [`⚠️ The app-collection report could not run this time — see the "App collection drift" step in the workflow log.`]
  const lines = report.flatMap(appLines)
  if (!lines.length) return null
  lines.push('_Regenerate deliberately: `cd <app> && crouton config --force` — or add the collection to ALLOW in scripts/app-collection-drift.mjs with a reason._')
  return lines
}

export async function buildReport(root) {
  const report = []
  for (const app of await discoverApps(root)) {
    const dir = join(root, app)
    report.push(analyze(app, readCollections(dir), regenerate(dir)))
  }
  return report
}

function renderText(report) {
  if (!report.length) return 'No apps with configured collections.'
  return report.map((a) => {
    const routesLine = `${(a.routesWithoutBodyValidation || []).length} routes lack body validation`
    if (a.status === 'error') return `${a.app}: ⛔ can't regenerate — ${a.error} (${routesLine})`
    const allowed = a.collections.filter(c => c.status === 'allowed').map(c => `\n    allowed: ${c.dir} — ${c.reason}`).join('')
    const ex = a.examples.map(e => `    ${e}`).join('\n')
    const extra = [
      ...a.configuredNotCommitted.map(d => `    configured, not committed: ${d}`),
      ...a.committedNotConfigured.map(d => `    committed, not configured: ${d}`),
    ].join('\n')
    return `${a.app}: ${a.status} (${a.filesBehind} files differ, ${routesLine})\n${ex}${extra ? `\n${extra}` : ''}${allowed}`
  }).join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const val = f => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined)
  if ((args.includes('--out') && !val('--out')) || (args.includes('--root') && !val('--root'))) {
    console.error('usage: app-collection-drift.mjs [--json] [--out <file>] [--root <dir>]')
    process.exit(2)
  }
  const root = resolve(val('--root') || '.')
  const report = await buildReport(root)
  const text = args.includes('--json') ? JSON.stringify(report, null, 2) : renderText(report)
  if (val('--out')) writeFileSync(val('--out'), `${args.includes('--json') ? text : text}\n`)
  else console.log(text)
}
