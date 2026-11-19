#!/usr/bin/env node
// suggest.mjs — record ONE improvement suggestion on the `pipeline-data` branch (#4271, epic #4223).
//
//   node scripts/suggest.mjs "<one sentence>" --area <area> --evidence <https://url> [--source <s>] [--dry-run]
//
// Exit codes — it never exits 0 without saving (unlike record-run's notice + exit 0):
//   0 saved (or --dry-run, which says "dry run — not saved")
//   1 invalid input (errors printed)
//   2 valid but NOT saved (no token, no repo, or the write failed) — the line is printed on stderr
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { validateSuggestion, resolveTarget, defaultSource, suggestionPath } from './lib/suggestions.mjs'
import { writeRecord } from './eval-ledger/record-run.mjs'

export function parseArgs(argv) {
  const out = { text: undefined, area: undefined, evidence: undefined, source: undefined, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--area' || a === '--evidence' || a === '--source') out[a.slice(2)] = argv[++i]
    else if (out.text === undefined && !a.startsWith('--')) out.text = a
  }
  return out
}

const gh = (args) => {
  try { return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv)
  const res = validateSuggestion({
    ts: new Date().toISOString(),
    source: args.source || defaultSource(env),
    area: args.area,
    text: args.text,
    evidence: args.evidence,
  })
  if (!res.ok) {
    for (const e of res.errors) console.error(`invalid: ${e}`)
    return 1
  }
  const line = res.line
  const json = JSON.stringify(line)
  if (args.dryRun) {
    console.log(`dry run — not saved: ${json}`)
    return 0
  }
  const hasToken = env.DATA_TOKEN || env.GH_TOKEN || env.GITHUB_TOKEN
  const hasRepo = env.REPO || env.GITHUB_REPOSITORY
  const ghToken = hasToken ? '' : gh(['auth', 'token'])
  let ghRepo = ''
  if (!hasRepo) {
    try { ghRepo = JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner']) || '{}').nameWithOwner || '' } catch { ghRepo = '' }
  }
  const { token, repo, error } = resolveTarget(env, { ghToken, ghRepo })
  if (error) {
    console.error(`NOT saved: ${error}`)
    console.error(json)
    return 2
  }
  try {
    const path = await writeRecord({ repo, token, record: line, path: suggestionPath(line, randomBytes(3).toString('hex')), message: `data: suggestion (${line.area})` })
    console.log(`saved → pipeline-data:${path}`)
    return 0
  } catch (e) {
    console.error(`NOT saved: ${e?.message || e}`)
    console.error(json)
    return 2
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(await main())
}
