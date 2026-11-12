#!/usr/bin/env node
/**
 * typecheck-packages — type-check every packages/* package, or say out loud why not (#3128).
 *
 * The rule (epic #3126): a type error in any packages/* file fails the PR that introduces it,
 * or the package is visibly named as skipped with an open ticket. So every package that has a
 * `typecheck` script must sit in exactly one list of scripts/typecheck-packages.json:
 *   gate      → run here (`pnpm --filter <name> typecheck`); a failure fails the run
 *   excluded  → { name: "#<ticket>" } — printed as skipped, never run
 * A package in neither list fails the run, so a new package can't slip past unchecked.
 *
 * Every package is printed with its status (`run` / `skip` / `unchanged`), so the log is the
 * coverage report.
 *
 * Usage:
 *   node scripts/typecheck-packages.mjs                 # all gate packages (push / infra / local)
 *   node scripts/typecheck-packages.mjs --only a,b      # PR scope: changed packages (dir names
 *                                                       # like crouton-feedback, or @fyit/… names)
 *   node scripts/typecheck-packages.mjs --dry-run       # print the plan, run nothing
 * With --only, a gate package runs when it changed OR depends (transitively, via any workspace
 * dependency) on a changed package — breaking feedback's exported types re-checks devtools.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const TICKET = /^#\d+$/

/** Every packages/<dir>/package.json → { dir, name, hasTypecheck, deps }. */
export function listPackages(root) {
  const base = join(root, 'packages')
  return readdirSync(base, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(base, e.name, 'package.json')))
    .map(e => {
      const pkg = JSON.parse(readFileSync(join(base, e.name, 'package.json'), 'utf8'))
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })
      return { dir: e.name, name: pkg.name, hasTypecheck: Boolean(pkg.scripts?.typecheck), deps }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Problems with the list file itself: anything here fails the run. */
export function configErrors(pkgs, config) {
  const gate = new Set(config.gate || [])
  const excluded = config.excluded || {}
  const known = new Map(pkgs.map(p => [p.name, p]))
  const errors = []
  for (const p of pkgs) {
    if (!p.hasTypecheck) continue
    const inGate = gate.has(p.name)
    const inExcluded = Object.hasOwn(excluded, p.name)
    if (!inGate && !inExcluded) errors.push(`${p.name} has a typecheck script but is in neither "gate" nor "excluded" — add it to one`)
    if (inGate && inExcluded) errors.push(`${p.name} is in both "gate" and "excluded" — pick one`)
  }
  for (const name of [...gate, ...Object.keys(excluded)]) {
    if (!known.has(name)) errors.push(`${name} is listed but no packages/* package has that name`)
    else if (!known.get(name).hasTypecheck) errors.push(`${name} is listed but has no typecheck script`)
  }
  for (const [name, ticket] of Object.entries(excluded)) {
    if (!TICKET.test(String(ticket))) errors.push(`${name} is excluded without a ticket ("${ticket}") — use "#<issue>"`)
  }
  return errors
}

/** Gate packages to run. `only` null → all; else changed ones plus their transitive dependents. */
export function selectRun(pkgs, gate, only) {
  const gateSet = new Set(gate)
  if (only == null) return pkgs.filter(p => gateSet.has(p.name)).map(p => p.name)
  const byKey = new Map()
  for (const p of pkgs) { byKey.set(p.name, p.name); byKey.set(p.dir, p.name) }
  const changed = new Set(only.map(k => byKey.get(k)).filter(Boolean))
  const byName = new Map(pkgs.map(p => [p.name, p]))
  const touches = (name, seen = new Set()) => {
    if (changed.has(name)) return true
    if (seen.has(name)) return false
    seen.add(name)
    return (byName.get(name)?.deps || []).some(d => byName.has(d) && touches(d, seen))
  }
  return pkgs.filter(p => gateSet.has(p.name) && touches(p.name)).map(p => p.name)
}

/** The full plan: one printed line per package, the run set, and the config errors. */
export function plan(pkgs, config, only = null) {
  const errors = configErrors(pkgs, config)
  const run = selectRun(pkgs, config.gate || [], only)
  const runSet = new Set(run)
  const excluded = config.excluded || {}
  const lines = pkgs.map(p => {
    if (!p.hasTypecheck) return `none       ${p.name} (no typecheck script)`
    if (runSet.has(p.name)) return `run        ${p.name}`
    if (Object.hasOwn(excluded, p.name)) return `skip       ${p.name} (excluded, ${excluded[p.name]})`
    if ((config.gate || []).includes(p.name)) return `unchanged  ${p.name}`
    return `UNLISTED   ${p.name}`
  })
  return { lines, run, errors }
}

export function parseArgs(argv) {
  const out = { only: null, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--only') out.only = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean)
    else if (a.startsWith('--only=')) out.only = a.slice(7).split(',').map(s => s.trim()).filter(Boolean)
  }
  return out
}

/** Entry point; `exec` is injectable so the test can run the real flow without pnpm. */
export function main({ root = process.cwd(), argv = process.argv.slice(2), log = console.log, exec } = {}) {
  const config = JSON.parse(readFileSync(join(root, 'scripts', 'typecheck-packages.json'), 'utf8'))
  const { only, dryRun } = parseArgs(argv)
  const { lines, run, errors } = plan(listPackages(root), config, only)
  log(`typecheck-packages: ${run.length} to run${only ? ` (changed: ${only.join(', ') || 'none'})` : ''}`)
  for (const l of lines) log(`  ${l}`)
  if (errors.length) {
    for (const e of errors) log(`::error::typecheck-packages: ${e}`)
    return 1
  }
  if (dryRun) return 0
  const runOne = exec || (name => spawnSync('pnpm', ['--filter', name, 'typecheck'], { cwd: root, stdio: 'inherit' }).status)
  const failed = run.filter(name => { log(`::group::typecheck ${name}`); const s = runOne(name); log('::endgroup::'); return s !== 0 })
  if (failed.length) {
    log(`::error::typecheck-packages: type errors in ${failed.join(', ')}`)
    return 1
  }
  log(`typecheck-packages: ${run.length} package(s) clean`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main())
