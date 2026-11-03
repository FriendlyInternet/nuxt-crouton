#!/usr/bin/env node
// gather-runs.mjs — weekly "did each agent run produce anything?" table (#3251).
// Joins the week's workflow runs (`gh run list`) with the records on `pipeline-data`, so a run
// that never wrote a record shows up as "missing record" instead of vanishing.
//
//   node scripts/eval-ledger/gather-runs.mjs [--days 7] [--json]
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { summarizeRuns } from '../lib/run-outcome.mjs'
import { parseArgs } from '../lib/cli-args.mjs'

const WORKFLOWS = ['work-issue-pidev.yml', 'decompose-on-issue-pidev.yml', 'plan-review.yml', 'build-review.yml', 'ticket-review.yml', 'fix-ci-on-failure.yml', 'on-comment.yml']
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

export function render(summary) {
  const rows = Object.entries(summary).map(([w, s]) =>
    `| ${w} | ${s.runs} | ${s.produced} | ${s.nothing} | ${s.shared} | ${s.unknown} | ${s.missing} | ${s.api_calls_median ?? '–'} |`)
  return [
    '| workflow | runs | produced | nothing | shared | unknown | missing record | median api_calls |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '`api_calls` is approximate: concurrent runs share the hourly allowance. `nothing` is only counted for runs that wrote a record; `missing record` means the run never wrote one.',
  ].join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2), { boolean: ['json'] })
  const days = Number(args.days || 7)
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
  const repo = process.env.GITHUB_REPOSITORY || 'FriendlyInternet/nuxt-crouton'
  const runs = []
  for (const wf of WORKFLOWS) {
    const list = JSON.parse(gh('run', 'list', '--workflow', wf, '--created', `>=${since}`, '--limit', '500', '--json', 'databaseId'))
    for (const r of list) runs.push({ id: r.databaseId, workflow: wf })
  }
  const records = []
  let dates = []
  try { dates = JSON.parse(gh('api', `repos/${repo}/contents/records?ref=pipeline-data`)).map((d) => d.name).filter((d) => d >= since) } catch { /* no data branch yet */ }
  for (const d of dates) {
    for (const f of JSON.parse(gh('api', `repos/${repo}/contents/records/${d}?ref=pipeline-data`))) {
      try { records.push(JSON.parse(Buffer.from(JSON.parse(gh('api', f.url)).content, 'base64').toString('utf8'))) } catch { /* skip unreadable */ }
    }
  }
  const summary = summarizeRuns(runs, records)
  console.log('json' in args ? JSON.stringify(summary, null, 2) : render(summary))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
