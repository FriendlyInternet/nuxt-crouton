// stale-work-this-gather.mjs — collects the inputs for staleWorkThis (#3018) through an
// injected GitHub client, so the real collection code can be tested without the network.
import { readFileSync } from 'node:fs'
import { issuesWithRecentRun, staleWorkThis } from './stale-work-this.mjs'

const labelNames = (it) => (it.labels || []).map((l) => (typeof l === 'string' ? l : l.name))

async function paged(gh, path, max = 10) {
  const out = []
  for (let page = 1; page <= max; page++) {
    const r = await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    out.push(...r)
    if (r.length < 100) break
  }
  return out
}

async function labeledAtOf(gh, repo, number) {
  const events = await paged(gh, `${repo}/issues/${number}/events`, Infinity)
  let labeledAt = null
  for (const e of events) {
    if (e.event === 'labeled' && e.label?.name === 'work-this') labeledAt = e.created_at
  }
  return labeledAt
}

async function toCandidate(gh, repo, owner, i) {
  const n = labelNames(i)
  if (!n.includes('work-this') || n.includes('status:blocked')) return null
  const labeledAt = await labeledAtOf(gh, repo, i.number)
  if (!labeledAt) return null
  const prs = await gh(`${repo}/pulls?state=open&head=${owner}:work-${i.number}&per_page=1`)
  return {
    number: i.number,
    title: i.title,
    html_url: i.html_url,
    labels: i.labels,
    labeledAt,
    openPr: prs.length > 0
  }
}

/**
 * @param {{ gh: (path:string)=>Promise<any>, owner: string, name: string,
 *   canariesPath?: string, now?: number }} deps
 * @returns {Promise<Array|null>} the stale list, or null when collection failed
 */
export async function staleWorkThisLabels({
  gh,
  owner,
  name,
  canariesPath = '.github/canaries.json',
  now = Date.now()
}) {
  try {
    const repo = `/repos/${owner}/${name}`
    // Own query: the shared openIssues list is one 100-item page and would miss older tickets.
    const openIssues = (await paged(gh, `${repo}/issues?state=open&labels=work-this`)).filter(
      (x) => !x.pull_request
    )
    const canaryIssues = new Set(
      JSON.parse(readFileSync(canariesPath, 'utf8'))
        .canaries.map((c) => c.issue)
        .filter(Boolean)
    )
    const since = new Date(now - 60 * 60000).toISOString()
    const runs = await gh(
      `${repo}/actions/workflows/work-issue-pidev.yml/runs?per_page=100&created=${encodeURIComponent('>=' + since)}`
    )
    const recentRunIssues = issuesWithRecentRun(runs.workflow_runs || [])
    const issues = []
    for (const i of openIssues) {
      const c = await toCandidate(gh, repo, owner, i)
      if (c) issues.push(c)
    }
    return staleWorkThis({ issues, recentRunIssues, canaryIssues, now })
  } catch (e) {
    console.error(`staleWorkThis: skipped: ${e.message}`)
    return null
  }
}
