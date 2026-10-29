#!/usr/bin/env node
// layer: harness
// Close a `workflow` (pipeline-fix) issue only when a real worker run shows the fix
// working — not when its PR merges (#2657). The issue body carries one line,
// `Evidence-needed: <text a real run will annotate>`; the fix PR uses `Refs #NN` so it
// stays open; this script closes it with the run link once an annotation matches.
//
// Usage: node scripts/fix-evidence.mjs [runId]   (needs GH_TOKEN; GITHUB_REPOSITORY)
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The text after `Evidence-needed:` (trimmed), or null. */
export function evidenceNeeded(body) {
  const m = /^[ \t>*-]*Evidence-needed:[ \t]*(.+)$/im.exec(body || '')
  const text = m?.[1]?.trim().replace(/^`+|`+$/g, '').trim()
  return text || null
}

/** First annotation whose `title: message` contains the needle (case-insensitive), else null. */
export function findEvidence(needle, annotations) {
  const n = (needle || '').trim().toLowerCase()
  if (!n) return null
  return (annotations || []).find(a =>
    `${a.title ?? ''}: ${a.message ?? ''}`.toLowerCase().includes(n)) ?? null
}

/** Latest merged_at among cross-referenced PRs in an issue timeline, or null. */
export function mergedAt(timeline) {
  const times = (timeline || [])
    .filter(e => e.event === 'cross-referenced')
    .map(e => e.source?.issue?.pull_request?.merged_at)
    .filter(Boolean)
  return times.length ? times.sort().at(-1) : null
}

const gh = (path, extra = []) =>
  JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', path, ...extra], { encoding: 'utf8' })).flat()
const ghSend = args => execFileSync('gh', args, { encoding: 'utf8' })

function runAnnotations(repo, runId) {
  const jobs = gh(`/repos/${repo}/actions/runs/${runId}/jobs`).flatMap(r => r.jobs ?? [r])
  return jobs.flatMap(job => gh(`/repos/${repo}/check-runs/${job.id}/annotations`))
}

function closeWithEvidence(repo, issue, run, hit) {
  const body = [
    '> 🤖 **pi.dev harness** · agent pipeline (CI) · _fix-evidence check_',
    '',
    '## ✅ Seen working',
    `**Needs:** nothing — closing.`,
    '',
    `Seen working in run ${run.html_url}: \`${hit.title ?? ''}: ${hit.message ?? ''}\``,
  ].join('\n')
  ghSend(['issue', 'comment', String(issue.number), '--repo', repo, '--body', body])
  ghSend(['issue', 'close', String(issue.number), '--repo', repo, '--reason', 'completed'])
}

function checkIssue(repo, issue, run, annotations) {
  const needle = evidenceNeeded(issue.body)
  if (!needle) return
  const merged = mergedAt(gh(`/repos/${repo}/issues/${issue.number}/timeline`))
  if (!merged || new Date(run.created_at) <= new Date(merged)) {
    console.log(`#${issue.number}: ${merged ? 'run predates the merge' : 'fix PR not merged yet'} — skip`)
    return
  }
  const hit = findEvidence(needle, annotations)
  if (!hit) { console.log(`#${issue.number}: «${needle}» not seen in this run`); return }
  closeWithEvidence(repo, issue, run, hit)
  console.log(`#${issue.number}: evidence found — closed`)
}

export async function main(runIdArg) {
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set')
  const runId = runIdArg || process.env.RUN_ID
  if (!runId) { console.log('no run id given — nothing to check'); return }
  const run = JSON.parse(ghSend(['api', `/repos/${repo}/actions/runs/${runId}`]))

  const annotations = runAnnotations(repo, run.id)
  console.log(`run ${run.id}: ${annotations.length} annotation(s)`)

  const issues = gh(`/repos/${repo}/issues?state=open&labels=workflow&per_page=100`)
    .filter(i => !i.pull_request)
  for (const issue of issues) checkIssue(repo, issue, run, annotations)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((e) => { console.error(e); process.exit(1) })
}
