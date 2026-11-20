// epic-numbers-run.mjs — gather the epic's numbers for its postmortem (#3253). The maths is pure, in
// lib/epic-numbers.mjs; this file only reads GitHub (gh, the job's read-only token) and the run records
// fetched from `pipeline-data`, and writes three files for the model + the trusted post step:
//   node scripts/epic-numbers-run.mjs <epic> <outDir> --records-dir <dir>
//     → numbers.json, numbers.md, steps.md   (or numbers-failed.txt with a one-line reason)
// ALWAYS EXITS 0: the numbers are report-only and must never block a postmortem or an epic close.
// SIMULATE_NUMBERS_FAILURE=true forces the failed path (how-to-test 3).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { epicNumbers, renderNumbers, extractTicketSteps } from './lib/epic-numbers.mjs'
import { stepSummary } from './lib/epic-steps.mjs'

const realGh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/** Every `*.json` under dir (recursive). Unreadable files are skipped. */
export function loadRecords(dir) {
  if (!dir || !existsSync(dir)) throw new Error(`no run records at ${dir || '(no --records-dir)'} — pipeline-data was not fetched`)
  const out = []
  const walk = d => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.json')) { try { out.push(JSON.parse(readFileSync(p, 'utf8'))) } catch { /* skip a broken file */ } }
    }
  }
  walk(dir)
  return out
}

const lines = s => String(s || '').split('\n').filter(Boolean).map(l => JSON.parse(l))
const prShape = p => ({ number: p.number, baseRef: p.baseRefName, mergedAt: p.mergedAt || null, url: p.url })
const closesRe = n => new RegExp(`^\\s*Closes\\s+#${n}\\b`, 'im')

const PR_FIELDS = 'number,baseRefName,mergedAt,url,body,headRefName'
const epicBranchOf = body => String(body || '').match(/epic_branch=(epic\/\S+?)(?:\s|-->)/)?.[1] || null

// A child's PRs: a body search filtered to a real `Closes #N` line (a plain search also matches
// mentions), plus every PR its run records name.
function childPrs({ gh, repo, records, number }) {
  const prs = new Map()
  const found = JSON.parse(gh(['pr', 'list', '--repo', repo, '--state', 'all', '--search', `#${number} in:body`, '--json', PR_FIELDS, '--limit', '50']))
  for (const p of found.filter(p => closesRe(number).test(p.body || ''))) prs.set(p.number, prShape(p))
  const seen = records.filter(r => Number(r.issue) === number && Number(r.pr)).map(r => Number(r.pr))
  for (const n of seen.filter(n => !prs.has(n))) {
    try { prs.set(n, prShape(JSON.parse(gh(['pr', 'view', String(n), '--repo', repo, '--json', PR_FIELDS])))) } catch { /* a deleted PR */ }
  }
  return [...prs.values()]
}

/** Gather from GitHub + records; returns { numbers, children } or throws. */
export async function gatherEpic({ epic, repo, records, gh = realGh, ownerLogin = 'pmcp' }) {
  const api = path => JSON.parse(gh(['api', path]))
  const pages = path => lines(gh(['api', '--paginate', '--jq', '.[]', path]))
  const epicIssue = api(`repos/${repo}/issues/${epic}`)
  const kids = pages(`repos/${repo}/issues/${epic}/sub_issues?per_page=100`)
  const children = kids.map(k => ({
    number: k.number, title: k.title, state: k.state, stateReason: k.state_reason, body: k.body || '',
    prs: childPrs({ gh, repo, records, number: k.number })
  }))
  const epicBranch = kids.map(k => epicBranchOf(k.body)).find(Boolean)
  const epicPrs = epicBranch
    ? JSON.parse(gh(['pr', 'list', '--repo', repo, '--state', 'all', '--head', epicBranch, '--json', PR_FIELDS, '--limit', '20'])).map(prShape)
    : []
  // The epic's own comments carry its step list (#4316) — fetched once, reused for owner touches.
  const epicComments = pages(`repos/${repo}/issues/${epic}/comments?per_page=100`)
  const threads = [...children.map(c => c.number), ...children.flatMap(c => c.prs.map(p => p.number)), ...epicPrs.map(p => p.number)]
    .filter(n => n !== epic)
  const ownerComments = [...epicComments, ...[...new Set(threads)].flatMap(n => pages(`repos/${repo}/issues/${n}/comments?per_page=100`))]
  const summary = stepSummary({ labels: (epicIssue.labels || []).map(l => (typeof l === 'string' ? l : l.name)), comments: epicComments, subIssues: kids })
  const numbers = epicNumbers({ epic, epicCreatedAt: epicIssue.created_at, children, epicPrs, records, ownerComments, ownerLogin, stepLine: summary.line })
  return { numbers, children }
}

/** steps.md — per child, its PRs and the ticket's steps, for the model's steps-vs-diff check. */
export function renderSteps(children) {
  const out = ['# Ticket steps per child (compare each with `gh pr diff <pr>`)', '']
  for (const c of children) {
    const prs = c.prs.length ? c.prs.map(p => `#${p.number}${p.mergedAt ? ` (merged → ${p.baseRef})` : ''}`).join(', ') : 'none found'
    out.push(`## #${c.number} — ${c.title || ''} (${c.state}${c.stateReason ? `, ${c.stateReason}` : ''})`, `PRs: ${prs}`, '')
    const steps = extractTicketSteps(c.body)
    if (!steps.length) out.push('(no numbered or bulleted steps in the ticket)')
    for (const s of steps) out.push(`- [${s.section} ${s.n}] ${s.text}`)
    out.push('')
  }
  return out.join('\n')
}

/** The CLI body, injectable for tests. Never throws; returns 'ok' | 'failed'. */
export async function runEpicNumbers({ epic, outDir, recordsDir, env = process.env, gh = realGh }) {
  mkdirSync(outDir, { recursive: true })
  try {
    if (env.SIMULATE_NUMBERS_FAILURE === 'true') throw new Error('simulate_numbers_failure set — failing on purpose')
    if (!Number(epic)) throw new Error(`not an epic number: ${epic}`)
    const repo = env.GITHUB_REPOSITORY || JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner
    const records = loadRecords(recordsDir)
    const { numbers, children } = await gatherEpic({ epic: Number(epic), repo, records, gh, ownerLogin: env.OWNER_LOGIN || 'pmcp' })
    writeFileSync(join(outDir, 'numbers.json'), JSON.stringify(numbers, null, 2) + '\n')
    writeFileSync(join(outDir, 'numbers.md'), renderNumbers(numbers) + '\n')
    writeFileSync(join(outDir, 'steps.md'), renderSteps(children))
    console.log(`epic numbers: #${epic} — ${numbers.runs} runs, ${numbers.silent.length} silent, ${children.length} children`)
    return 'ok'
  } catch (e) {
    const reason = String(e?.message || e).split('\n')[0].slice(0, 300)
    writeFileSync(join(outDir, 'numbers-failed.txt'), reason + '\n')
    console.log(`::warning::epic numbers didn't run — ${reason}`)
    return 'failed'
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--records-dir')
  const recordsDir = i >= 0 ? argv[i + 1] : null
  const [epic, outDir] = i < 0 ? argv : argv.filter((_, j) => j !== i && j !== i + 1)
  if (!outDir) { console.log('usage: node scripts/epic-numbers-run.mjs <epic> <outDir> --records-dir <dir>'); process.exit(0) }
  await runEpicNumbers({ epic, outDir, recordsDir })
  process.exit(0)
}
