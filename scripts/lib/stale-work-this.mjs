// stale-work-this.mjs — pure detector for the housekeeping digest (#3018).
// A `work-this` label stays on an issue after its run ends, so a label whose run never came
// (or ended with no PR) sits unseen. List tickets where nothing is building them. No I/O here.

const HOUR = 3600000

/**
 * Issue numbers with a real worker run in the given window. Run titles are `#<n> · <mode>`;
 * `skipped` runs were fired by some other label and built nothing, so they are dropped.
 * @param {Array<{display_title?:string, conclusion?:string|null}>} runs
 * @returns {Set<number>}
 */
export function issuesWithRecentRun(runs = []) {
  const out = new Set()
  for (const r of runs) {
    if (r.conclusion === 'skipped') continue
    const m = /^#(\d+)\b/.exec(r.display_title || '')
    if (m) out.add(Number(m[1]))
  }
  return out
}

/**
 * @param {{ issues: Array<{number:number,title?:string,html_url?:string,labels:any[],
 *   labeledAt?:string, openPr?:boolean}>, recentRunIssues?: Set<number>,
 *   canaryIssues?: Set<number>, now?: number, minMinutes?: number }} input
 */
export function staleWorkThis({
  issues = [],
  recentRunIssues = new Set(),
  canaryIssues = new Set(),
  now = Date.now(),
  minMinutes = 60
}) {
  const names = (i) => (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
  return issues
    .filter((i) => {
      const n = names(i)
      if (!n.includes('work-this')) return false
      if (n.includes('epic') || n.includes('status:blocked')) return false
      if (canaryIssues.has(i.number)) return false
      const at = Date.parse(i.labeledAt)
      if (!(now - at > minMinutes * 60000)) return false
      if (i.openPr) return false
      if (recentRunIssues.has(i.number)) return false
      return true
    })
    .map((i) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      labelAgeHours: Math.floor((now - Date.parse(i.labeledAt)) / HOUR),
      inProgress: names(i).includes('status:in-progress')
    }))
    .sort((a, b) => b.labelAgeHours - a.labelAgeHours)
}
