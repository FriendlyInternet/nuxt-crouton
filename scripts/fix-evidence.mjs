#!/usr/bin/env node
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

function runAnnotations(repo, runId, io) {
  const jobs = io.gh(`/repos/${repo}/actions/runs/${runId}/jobs`).flatMap(r => r.jobs ?? [r])
  return jobs.flatMap(job => io.gh(`/repos/${repo}/check-runs/${job.id}/annotations`))
}

function closeWithEvidence(repo, issue, run, hit, io) {
  const body = [
    '> 🤖 **pi.dev harness** · agent pipeline (CI) · _fix-evidence check_',
    '',
    '## ✅ Seen working',
    `**Needs:** nothing — closing.`,
    '',
    `Seen working in run ${run.html_url}: \`${hit.title ?? ''}: ${hit.message ?? ''}\``,
  ].join('\n')
  io.ghSend(['issue', 'comment', String(issue.number), '--repo', repo, '--body', body])
  io.ghSend(['issue', 'close', String(issue.number), '--repo', repo, '--reason', 'completed'])
}

/** Open `workflow` issues that name evidence AND whose fix PR has merged (cheap reads only). */
function waitingIssues(repo, io) {
  return io.gh(`/repos/${repo}/issues?state=open&labels=workflow&per_page=100`)
    .filter(i => !i.pull_request)
    .map(issue => ({ issue, needle: evidenceNeeded(issue.body) }))
    .filter(w => w.needle)
    .map(w => ({ ...w, merged: mergedAt(io.gh(`/repos/${repo}/issues/${w.issue.number}/timeline`)) }))
    .filter(w => w.merged || console.log(`#${w.issue.number}: fix PR not merged yet — skip`))
}

/** Keep issues whose fix merged before this run started. */
function mergedBeforeRun(waiting, run) {
  return waiting.filter(w => new Date(run.created_at) > new Date(w.merged)
    || console.log(`#${w.issue.number}: run predates the merge — skip`))
}

function checkIssue(repo, w, run, annotations, io) {
  const hit = findEvidence(w.needle, annotations)
  if (!hit) { console.log(`#${w.issue.number}: «${w.needle}» not seen in this run`); return }
  closeWithEvidence(repo, w.issue, run, hit, io)
  console.log(`#${w.issue.number}: evidence found — closed`)
}

export async function main(runIdArg, io = { gh, ghSend }) {
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set')
  const runId = runIdArg || process.env.RUN_ID
  if (!runId) { console.log('no run id given — nothing to check'); return }
  const waiting = waitingIssues(repo, io)
  if (!waiting.length) { console.log('no issue waits for evidence'); return }
  const run = JSON.parse(io.ghSend(['api', `/repos/${repo}/actions/runs/${runId}`]))
  const due = mergedBeforeRun(waiting, run)
  if (!due.length) return
  const annotations = runAnnotations(repo, run.id, io)
  console.log(`run ${run.id}: ${annotations.length} annotation(s)`)
  for (const w of due) checkIssue(repo, w, run, annotations, io)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((e) => { console.error(e); process.exit(1) })
}
