#!/usr/bin/env node
// screenshot-targets.mjs — choose WHICH previewed apps the "Preview screenshot" check shoots (#3970).
//
// A package change redeploys every app that extends it, so shooting every downloaded preview record
// fills the PR with pictures of apps the PR never touched. The rule:
//   • shoot the apps whose own folder changed (<workspace>/<app>/…) plus the apps a
//     `<!-- review-surface: <app> <path> -->` marker names;
//   • a package-only PR (neither) shows at most 2 consumers: the gallery first when a shared
//     component changed (only it has the /__review?file= page), then apps/ ahead of pocs/ by name;
//   • everything else is listed as skipped, with why, so the comment can say so.
//
//   node scripts/screenshot-targets.mjs --records <dir> --pr <N> --out <file>
//   env: CHANGED_FILES (newline-separated), PR_BODY (optional; else read from the API — a failed
//   read exits 1, never falls back to shooting every app, #3957).
// Writes the chosen meta.json paths to --out (one per line); prints count=<n> and note=<line>.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPrBody } from './capture-review-surfaces.mjs'

const PACKAGE_ONLY_CAP = 2
const WHY_REDEPLOYED = 'only redeployed because a package it uses changed'
const WHY_PACKAGE_ONLY = `package-only PR — showing at most ${PACKAGE_ONLY_CAP} consumers`
const WHY_NOT_DEPLOYED = 'named by review-surface but not deployed for this commit'

/** App names the PR's review-surface markers name (first token), de-duplicated, in order. */
export function namedApps(prBody) {
  const out = []
  for (const m of String(prBody || '').matchAll(/<!--\s*review-surface:\s*(.+?)\s*-->/g)) {
    const [app] = m[1].split(/\s+/)
    if (app && !out.includes(app)) out.push(app)
  }
  return out
}

const byName = (a, b) => {
  const wa = a.workspace === 'apps' ? 0 : 1
  const wb = b.workspace === 'apps' ? 0 : 1
  return wa - wb || String(a.app).localeCompare(String(b.app))
}

/**
 * records: [{ app, workspace, meta }] → { shoot: [meta…], skipped: [{ app, why }], rule }
 */
export function pickTargets({ records = [], changedFiles = [], prBody = '' }) {
  const files = (changedFiles || []).map(f => String(f).trim()).filter(Boolean)
  const named = namedApps(prBody)
  const picked = pickChangedOrNamed(records, files, named) || pickPackageOnly(records, files)
  const missing = named
    .filter(app => !records.some(r => r.app === app))
    .map(app => ({ app, why: WHY_NOT_DEPLOYED }))
  return { shoot: picked.shoot.map(r => r.meta), skipped: [...picked.skipped, ...missing], rule: picked.rule }
}

/** Records whose own folder changed or that a marker names; null when there are none. */
function pickChangedOrNamed(records, files, named) {
  const isOwn = r => files.some(f => f.startsWith(`${r.workspace}/${r.app}/`))
  const shoot = records.filter(r => isOwn(r) || named.includes(r.app))
  if (!shoot.length) return null
  const skipped = records.filter(r => !shoot.includes(r)).map(r => ({ app: r.app, why: WHY_REDEPLOYED }))
  return { rule: 'changed-or-named', shoot, skipped }
}

/** Package-only PR: at most PACKAGE_ONLY_CAP consumers, gallery first for a shared component. */
function pickPackageOnly(records, files) {
  const sharedComponent = files.some(f => /^packages\/crouton-[^/]+\/app\/components\/.+\.vue$/.test(f))
  const order = [...records].sort(byName)
  const gallery = sharedComponent ? order.find(r => r.app === 'gallery') : undefined
  const ranked = gallery ? [gallery, ...order.filter(r => r !== gallery)] : order
  const skipped = ranked.slice(PACKAGE_ONLY_CAP).map(r => ({ app: r.app, why: WHY_PACKAGE_ONLY }))
  return { rule: 'package-only', shoot: ranked.slice(0, PACKAGE_ONLY_CAP), skipped }
}

/** One line for the comment: "skipped N: a, b (why); c (why)" — '' when nothing was skipped. */
export function skippedNote(skipped = []) {
  if (!skipped.length) return ''
  const groups = new Map()
  for (const s of skipped) groups.set(s.why, [...(groups.get(s.why) || []), s.app])
  const parts = [...groups].map(([why, apps]) => `${apps.join(', ')} (${why})`)
  return `skipped ${skipped.length}: ${parts.join('; ')}`
}

function findMetas(dir) {
  const out = []
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...findMetas(p))
    else if (name === 'meta.json') out.push(p)
  }
  return out.sort()
}

const arg = (argv, n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : undefined }

async function main() {
  const argv = process.argv.slice(2)
  const dir = arg(argv, 'records'), pr = arg(argv, 'pr'), out = arg(argv, 'out')
  if (!dir || !pr || !out) {
    console.error('usage: screenshot-targets.mjs --records <dir> --pr <N> --out <file>')
    process.exit(2)
  }
  let prBody
  try {
    prBody = await readPrBody({ env: process.env, pr })
  } catch (e) {
    // stderr: stdout is appended to $GITHUB_OUTPUT, where a non key=value line would break it.
    console.error(`::error::${e.message}`)
    process.exit(1)
  }
  const records = findMetas(dir).map((meta) => {
    const m = JSON.parse(readFileSync(meta, 'utf8'))
    return { app: m.app, workspace: m.workspace, meta }
  })
  const changedFiles = (process.env.CHANGED_FILES || '').split('\n')
  const { shoot, skipped, rule } = pickTargets({ records, changedFiles, prBody })
  writeFileSync(out, shoot.map(p => `${p}\n`).join(''))
  console.error(`[screenshot-targets] rule=${rule} shoot=${shoot.length}/${records.length}`)
  console.log(`count=${shoot.length}`)
  console.log(`note=${skippedNote(skipped).replace(/[\r\n]+/g, ' ')}`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
