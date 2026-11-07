#!/usr/bin/env node
// migration-guard.mjs — report-only PR check (#3013): when a PR changes a package's database
// schema, run every deployed app's own `db:generate` on the PR head. Any statement it produces
// means the PR is missing that app's migration.
//
// Pure decision functions (unit-tested in migration-guard.test.mjs) + a small CLI:
//   node scripts/migration-guard.mjs generate --root <repo> --out <results.json>
//   node scripts/migration-guard.mjs evaluate --results r.json --files files.txt --body-file body.txt [--out o.json]

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const COMMENT_MARKER = '<!-- migration-guard -->'
export const NOT_NEEDED_RE = /^\s*Migration-not-needed:\s*(\S.*)$/im

export const SCHEMA_TRIGGER_RE = [
  /^packages\/[^/]+\/server\/database\/schema\.ts$/,
  /^packages\/[^/]+\/server\/database\/schema\/.+/,
  /^packages\/[^/]+\/collections\/[^/]+\/server\/database\/schema\.ts$/,
  /^packages\/[^/]+\/server\/database\/migrations\/[^/]+\.sql$/,
  /^packages\/[^/]+\/server\/db\/schema[^/]*\.ts$/,
  /^packages\/[^/]+\/server\/db\/schema\/.+/,
]

export function isSchemaChange(files = []) {
  return files.some(f => typeof f === 'string' && SCHEMA_TRIGGER_RE.some(re => re.test(f)))
}

export function parseStatements(sql = '') {
  return sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)
}

/** Deployed apps/POCs with a deploy.config.json and a db:generate script. */
export function listTargets(root) {
  const out = []
  for (const group of ['apps', 'pocs']) {
    const base = join(root, group)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base).sort()) {
      const dir = `${group}/${name}`
      const abs = join(root, dir)
      if (!existsSync(join(abs, 'deploy.config.json')) || !existsSync(join(abs, 'package.json'))) continue
      let pkg
      try { pkg = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8')) } catch { continue }
      if (!pkg.scripts?.['db:generate']) continue
      let legacy = false
      const cfg = join(abs, 'drizzle.config.ts')
      if (existsSync(cfg)) legacy = readFileSync(cfg, 'utf8').includes('.nuxt/hub/db/schema.mjs')
      out.push({ dir, name: pkg.name || name, legacy })
    }
  }
  return out
}

/**
 * @param {{changedFiles?: string[], body?: string, results?: Record<string, any>, targets?: {dir:string,name?:string}[]}} input
 * results: dir → { statements } | { error } | { skipped: 'legacy' }
 */
export function evaluateMigrationGuard({ changedFiles = [], body = '', results = {}, names = {} } = {}) {
  const empty = { missing: [], errored: [], skipped: [] }
  if (!isSchemaChange(changedFiles)) {
    return { status: 'not-involved', ...empty, markdown: 'No package schema file changed — migration guard not involved.' }
  }
  const missing = []
  const errored = []
  const skipped = []
  for (const dir of Object.keys(results).sort()) {
    const r = results[dir] || {}
    const app = names[dir] || dir
    if (r.skipped) skipped.push({ app: dir, reason: r.skipped })
    else if (r.error) errored.push({ app: dir, error: String(r.error).split('\n')[0], command: `pnpm --filter ${app} db:generate` })
    else if (Array.isArray(r.statements) && r.statements.length > 0) {
      missing.push({ app: dir, statements: r.statements, command: `pnpm --filter ${app} db:generate` })
    }
  }
  let status = missing.length || errored.length ? 'fail' : skipped.length ? 'notice' : 'pass'
  const m = NOT_NEEDED_RE.exec(body || '')
  let reason = null
  if (status === 'fail' && m) { status = 'notice'; reason = m[1].trim() }

  const lines = []
  const head = { fail: '❌ Missing app migration', notice: 'ℹ️ Migration guard notice', pass: '✅ App migrations are up to date' }[status]
  lines.push(`### ${head}`)
  if (missing.length) {
    lines.push('', 'This PR changes a package schema, but these apps would still generate a migration. Run the command and commit the result:')
    for (const x of missing) {
      lines.push('', `- **${x.app}** — \`${x.command}\``, '  <details><summary>statements</summary>', '', '  ```sql')
      for (const s of x.statements) lines.push(`  ${s.replace(/\n/g, '\n  ')}`)
      lines.push('  ```', '  </details>')
    }
  }
  for (const x of errored) lines.push('', `- **${x.app}** — generator failed: ${x.error} (\`${x.command}\`)`)
  if (skipped.length) {
    lines.push('', 'Skipped (drizzle.config needs a build; regenerate it with crouton): ' + skipped.map(s => `\`${s.app}\``).join(', '))
  }
  if (reason) lines.push('', `Overridden by \`Migration-not-needed:\` — ${reason}`)
  if (status === 'fail') lines.push('', 'No migration needed? Add a PR body line `Migration-not-needed: <why>`.')
  lines.push('', 'See `.claude/skills/db-migrations/SKILL.md`.')
  return { status, missing, errored, skipped, reason, markdown: lines.join('\n') }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function arg(argv, name) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

function runGenerate(root, outPath) {
  const results = {}
  const names = {}
  for (const t of listTargets(root)) {
    names[t.dir] = t.name
    if (t.legacy) { results[t.dir] = { skipped: 'legacy' }; continue }
    const migDir = `${t.dir}/server/db/migrations`
    const r = spawnSync('timeout', ['300', 'pnpm', 'db:generate'], {
      cwd: join(root, t.dir), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', migDir], { cwd: root, encoding: 'utf8' })
    const sqlFiles = status.split('\n').map(l => l.slice(3).trim()).filter(f => f.endsWith('.sql'))
    if (r.status !== 0) {
      const text = `${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').filter(Boolean).pop() || `exit ${r.status}`
      results[t.dir] = { error: text }
    } else {
      const statements = sqlFiles.flatMap(f => parseStatements(readFileSync(join(root, f), 'utf8')))
      results[t.dir] = { statements }
    }
    execFileSync('git', ['clean', '-fdq', '--', migDir], { cwd: root })
    execFileSync('git', ['checkout', '--', t.dir], { cwd: root })
  }
  writeFileSync(outPath, JSON.stringify({ results, names }, null, 2))
}

function main(argv) {
  const [cmd] = argv
  if (cmd === 'generate') {
    runGenerate(arg(argv, 'root') || process.cwd(), arg(argv, 'out') || 'migration-results.json')
    return
  }
  if (cmd === 'evaluate') {
    const { results, names } = JSON.parse(readFileSync(arg(argv, 'results'), 'utf8'))
    const changedFiles = readFileSync(arg(argv, 'files'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    const bodyFile = arg(argv, 'body-file')
    const body = bodyFile && existsSync(bodyFile) ? readFileSync(bodyFile, 'utf8') : ''
    const res = evaluateMigrationGuard({ changedFiles, body, results, names })
    console.log(res.markdown)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, res.markdown + '\n')
    const out = arg(argv, 'out')
    if (out) writeFileSync(out, JSON.stringify({ ...res, commentBody: `${COMMENT_MARKER}\n${res.markdown}` }, null, 2))
    process.exit(res.status === 'fail' ? 1 : 0)
  }
  console.error('usage: migration-guard.mjs generate|evaluate …')
  process.exit(2)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2))
