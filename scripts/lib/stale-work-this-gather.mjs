// stale-work-this-gather.mjs — collects the inputs for staleWorkThis (#3018) through an
// injected GitHub client, so the real collection code can be tested without the network.
import { readFileSync } from 'node:fs'
import { issuesWithRecentRun, staleWorkThis } from './stale-work-this.mjs'

const labelNames = (it) => (it.labels || []).map((l) => (typeof l === 'string' ? l : l.name))

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
    // Own query: the shared openIssues list is one 100-item page and would miss older tickets.
    const openIssues = []
    for (let page = 1; page <= 10; page++) {
      const r = await gh(
        `/repos/${owner}/${name}/issues?state=open&labels=work-this&per_page=100&page=${page}`
      )
      openIssues.push(...r.filter((x) => !x.pull_request))
      if (r.length < 100) break
    }
    const canaryIssues = new Set(
      JSON.parse(readFileSync(canariesPath, 'utf8'))
        .canaries.map((c) => c.issue)
        .filter(Boolean)
    )
    const since = new Date(now - 60 * 60000).toISOString()
    const runs = await gh(
      `/repos/${owner}/${name}/actions/workflows/work-issue-pidev.yml/runs?per_page=100&created=${encodeURIComponent('>=' + since)}`
    )
    const recentRunIssues = issuesWithRecentRun(runs.workflow_runs || [])
    const issues = []
    for (const i of openIssues) {
      const n = labelNames(i)
      if (!n.includes('work-this') || n.includes('status:blocked')) continue
      let labeledAt = null
      for (let page = 1; ; page++) {
        const ev = await gh(`/repos/${owner}/${name}/issues/${i.number}/events?per_page=100&page=${page}`)
        for (const e of ev) {
          if (e.event === 'labeled' && e.label?.name === 'work-this') labeledAt = e.created_at
        }
        if (ev.length < 100) break
      }
      if (!labeledAt) continue
      const prs = await gh(
        `/repos/${owner}/${name}/pulls?state=open&head=${owner}:work-${i.number}&per_page=1`
      )
      issues.push({
        number: i.number,
        title: i.title,
        html_url: i.html_url,
        labels: i.labels,
        labeledAt,
        openPr: prs.length > 0
      })
    }
    return staleWorkThis({ issues, recentRunIssues, canaryIssues, now })
  } catch (e) {
    console.error(`staleWorkThis: skipped: ${e.message}`)
    return null
  }
}
