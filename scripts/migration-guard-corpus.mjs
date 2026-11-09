#!/usr/bin/env node
// migration-guard-corpus.mjs — report-only (#3621): replay the migration guard (#3013) over merged
// PRs that touched a package schema, comparing each PR's merge commit with its parent so drift that
// was already on main is not blamed on the PR. Never wired into CI.
//
//   node scripts/migration-guard-corpus.mjs --worktree /tmp/mg-wt --cache /tmp/mg-cache [--prs 3572,3439] [--out report.md]

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { evaluateMigrationGuard, isSchemaChange } from './migration-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')

export const TRIGGER_GLOBS = [
  'packages/*/server/database/schema.ts',
  'packages/*/server/database/schema/**',
  'packages/*/collections/*/server/database/schema.ts',
  'packages/*/server/database/migrations/*.sql',
  'packages/*/server/db/schema*.ts',
  'packages/*/server/db/schema/**',
]
export const KNOWN_ROLLUPS = [2743, 2984]

// ── pure helpers (unit-tested) ───────────────────────────────────────────────
export function mergeShaLists(full = [], firstParent = []) {
  return [...new Set([...full, ...firstParent])]
}

/** lookup(sha) → [{ number, merged_at }]; returns merged PR numbers, newest (highest) first. */
export function collectPrs(shas, lookup) {
  const seen = new Set()
  for (const sha of shas) {
    for (const p of lookup(sha) || []) if (p && p.merged_at) seen.add(p.number)
  }
  return [...seen].sort((a, b) => b - a)
}

/** Output of `gh api --paginate … --jq '.[].filename'` → array (every page kept). */
export function parseFileList(text = '') {
  return text.split('\n').map(s => s.trim()).filter(Boolean)
}

/** merge/parent: dir → { statements } | { error } | { skipped }. */
export function diffStatements(merge = {}, parent = {}) {
  const out = {}
  for (const app of Object.keys(merge).sort()) {
    const m = merge[app] || {}
    const p = parent[app] || {}
    const before = new Set((p.statements || []).map(s => s.trim()))
    const introduced = (m.statements || []).map(s => s.trim()).filter(s => !before.has(s))
    const newError = Boolean(m.error) && !p.error
    if (introduced.length || newError) out[app] = { introduced, newError, error: m.error }
  }
  return out
}

const isClean = r => Object.values(r || {}).every(x => !x || x.skipped || (!x.error && !(x.statements || []).length))

export function classifyPr({ merge, parent, prFiles = [], body = '', names = {} }) {
  const guard = evaluateMigrationGuard({ changedFiles: prFiles, body, results: merge, names })
  if (isClean(merge)) return { guard: guard.status, flagged: [], clean: true, preExistingOnly: false }
  const diff = diffStatements(merge, parent || {})
  const flagged = Object.entries(diff).map(([app, d]) => {
    const migrationAdded = prFiles.some(f => f.startsWith(`${app}/server/db/migrations/`) && f.endsWith('.sql'))
    return {
      app, introduced: d.introduced, newError: d.newError, migrationAdded,
      verdict: migrationAdded ? 'likely false alarm: migration present, snapshot missing' : 'likely real: no migration',
    }
  })
  return { guard: guard.status, flagged, clean: false, preExistingOnly: guard.status === 'fail' && flagged.length === 0 }
}

export function computeTotals(rows) {
  const t = { fired: 0, real: 0, falseAlarm: 0, preExisting: 0 }
  const seen = new Set()
  for (const r of rows) {
    if (!r.classified || r.rollupOf?.length) continue // roll-ups re-show their sub-PRs: count once
    if (r.classified.guard === 'fail') t.fired++
    if (r.classified.preExistingOnly) t.preExisting++
    tallyFlagged(r.classified.flagged, seen, t)
  }
  return t
}

function tallyFlagged(flagged, seen, t) {
  for (const f of flagged) {
    const key = `${f.app}|${f.introduced.join('||')}|${f.newError}`
    if (seen.has(key)) continue
    seen.add(key)
    if (f.verdict.startsWith('likely real')) t.real++
    else t.falseAlarm++
  }
}

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function renderReport(rows, meta = {}) {
  const lines = [
    '# Migration guard — corpus replay (#3621)', '',
    `Run at HEAD \`${meta.head || '?'}\` on ${meta.date || ''}. Discovered ${meta.discovered ?? rows.length} merged schema PRs.`, '',
    'Command: `' + (meta.command || 'node scripts/migration-guard-corpus.mjs …') + '`', '',
    '"Guard would have said" = the merged guard run on the merge commit as-is. "Flagged" = statements the PR itself introduced (merge minus parent). Verdicts marked *likely* are checked by eye in the final column.', '',
    '| PR | merged | base | guard would have said | apps flagged (introduced by this PR) | real / false alarm | note |',
    '|---|---|---|---|---|---|---|',
  ]
  const measurable = rows.filter(r => r.classified)
  for (const r of measurable) {
    const c = r.classified
    const flagged = c.flagged.map(f => `${f.app} (${f.newError ? 'new error' : f.introduced.length + ' stmt'})`).join(', ') || (c.preExistingOnly ? 'none (pre-existing drift only)' : 'none')
    const verdict = c.flagged.map(f => `${f.app}: ${r.final?.[f.app] || f.verdict}`).join('; ') || '—'
    const note = [r.rollupOf?.length ? `roll-up of ${r.rollupOf.map(n => '#' + n).join(', ')}` : '', r.note].filter(Boolean).join('; ')
    lines.push(`| #${r.pr} | ${cell(r.merged)} | ${cell(r.base)} | ${c.guard} | ${cell(flagged)} | ${cell(verdict)} | ${cell(note)} |`)
  }
  const other = rows.filter(r => !r.classified)
  if (other.length) {
    lines.push('', '## Not measured', '')
    for (const r of other) lines.push(`- #${r.pr} — ${r.reason || 'not run'}`)
  }
  const t = computeTotals(rows)
  lines.push('', `**Totals** (roll-ups not double counted): guard fired on ${t.fired} · real misses ${t.real} · false alarms ${t.falseAlarm} · pre-existing-drift-only ${t.preExisting}.`)
  return lines.join('\n') + '\n'
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts })
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }

function gitShas(extra) {
  return sh('git', ['log', ...extra, '--format=%H', 'HEAD', '--', ...TRIGGER_GLOBS.map(g => `:(glob)${g}`)], { cwd: REPO_ROOT }).split('\n').filter(Boolean)
}

function discover() {
  const shas = mergeShaLists(gitShas([]), gitShas(['--first-parent']))
  const cache = new Map()
  const lookup = (sha) => {
    if (cache.has(sha)) return cache.get(sha)
    let v = []
    try { v = JSON.parse(sh('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/pulls`], { cwd: REPO_ROOT })) } catch { /* old direct push */ }
    cache.set(sha, v)
    return v
  }
  const prs = collectPrs(shas, lookup)
  const missing = KNOWN_ROLLUPS.filter(n => !prs.includes(n))
  if (missing.length) {
    console.error('discovery dropped known roll-up PRs: ' + missing.map(n => '#' + n).join(', '))
    process.exit(1)
  }
  return prs
}

function ghPr(n) {
  const meta = JSON.parse(sh('gh', ['pr', 'view', String(n), '--json', 'mergeCommit,body,baseRefName,headRefName,mergedAt'], { cwd: REPO_ROOT }))
  const files = parseFileList(sh('gh', ['api', '--paginate', `repos/{owner}/{repo}/pulls/${n}/files`, '--jq', '.[].filename'], { cwd: REPO_ROOT }))
  return { ...meta, files }
}

/** Same test as listTargets, but against a commit's tree instead of a checkout. */
function measurableAt(sha) {
  const show = (p) => { try { return sh('git', ['show', `${sha}:${p}`], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null } }
  const dirs = ['apps', 'pocs'].flatMap(group => {
    try { return sh('git', ['ls-tree', '--name-only', sha, `${group}/`], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean) } catch { return [] }
  })
  let legacy = 0
  let found = 0
  for (const dir of dirs) {
    const kind = targetKind(dir, show)
    if (kind === 'legacy') legacy++
    else if (kind === 'ok') found++
  }
  if (found) return { ok: true }
  return { ok: false, reason: legacy ? 'every target was legacy (skipped)' : 'no deployed app with db:generate' }
}

function targetKind(dir, show) {
  if (show(`${dir}/deploy.config.json`) === null) return 'none'
  let hasGen = false
  try { hasGen = Boolean(JSON.parse(show(`${dir}/package.json`)).scripts?.['db:generate']) } catch { /* ignore */ }
  if (!hasGen) return 'none'
  const cfg = show(`${dir}/drizzle.config.ts`)
  return cfg !== null && cfg.includes('.nuxt/hub/db/schema.mjs') ? 'legacy' : 'ok'
}

function runAt(sha, wt, cacheDir) {
  const out = join(cacheDir, `${sha}.json`)
  if (existsSync(out)) return JSON.parse(readFileSync(out, 'utf8'))
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: wt, encoding: 'utf8', stdio: 'pipe' })
  sh('git', ['checkout', '-q', '--detach', sha], { cwd: wt })
  let data
  const i = run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'])
  const b = i.status === 0 ? run('pnpm', ['build:packages']) : i
  if (b.status !== 0) data = { buildError: String(b.stderr || b.stdout).trim().split('\n').pop() }
  else {
    const g = run('node', [join(REPO_ROOT, 'scripts/migration-guard.mjs'), 'generate', '--root', wt, '--out', out])
    if (g.status !== 0) data = { buildError: String(g.stderr).trim().split('\n').pop() }
    else return JSON.parse(readFileSync(out, 'utf8'))
  }
  writeFileSync(out, JSON.stringify(data))
  return data
}

function buildRow(n, m, wt, cacheDir) {
  if (m.error || !m.mergeCommit) return { pr: n, reason: m.error || 'no merge commit' }
  if (!isSchemaChange(m.files)) return null
  const merge = m.mergeCommit.oid
  const row = { pr: n, merged: (m.mergedAt || '').slice(0, 10), base: m.baseRefName, head: m.headRefName, note: `${m.files.length} files` }
  const me = measurableAt(merge)
  if (!me.ok) return { ...row, reason: `not measurable — ${me.reason}` }
  const mr = runAt(merge, wt, cacheDir)
  if (mr.buildError) return { ...row, reason: `build failed: ${mr.buildError}` }
  let parent
  if (!isClean(mr.results)) {
    const par = runAt(sh('git', ['rev-parse', `${merge}^1`], { cwd: REPO_ROOT }).trim(), wt, cacheDir)
    parent = par.buildError ? undefined : par.results
  }
  row.classified = classifyPr({ merge: mr.results, parent, prFiles: m.files, body: m.body, names: mr.names })
  return row
}

function markRollups(rows) {
  for (const r of rows) {
    const subs = rows.filter(s => s.pr !== r.pr && s.base && s.base === r.head && s.classified?.flagged.length).map(s => s.pr)
    if (r.classified?.flagged.length && subs.length && r.base === 'main') r.rollupOf = subs
  }
}

function main() {
  const wt = arg('worktree') || '/tmp/mg-wt'
  const cacheDir = arg('cache') || '/tmp/mg-cache'
  mkdirSync(cacheDir, { recursive: true })
  if (!existsSync(wt)) sh('git', ['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: REPO_ROOT })
  const prs = arg('prs') ? arg('prs').split(',').map(Number) : discover()
  const metas = {}
  for (const n of prs) { try { metas[n] = ghPr(n) } catch (e) { metas[n] = { error: String(e.message).split('\n')[0] } } }
  const rows = prs.map(n => buildRow(n, metas[n], wt, cacheDir)).filter(Boolean)
  markRollups(rows)
  const head = sh('git', ['rev-parse', '--short=9', 'HEAD'], { cwd: REPO_ROOT }).trim()
  const report = renderReport(rows, { head, date: new Date().toISOString().slice(0, 10), discovered: prs.length, command: `node scripts/migration-guard-corpus.mjs --worktree ${wt} --cache ${cacheDir}` })
  const out = arg('out')
  if (out) writeFileSync(out, report)
  else process.stdout.write(report)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
