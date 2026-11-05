// stuck-prs.mjs — pure detectors for the housekeeping digest (#3317).
// Two PR shapes nothing else reports: epic→main PRs with no `CI Gate` check-run, and PRs the
// owner approved (`ok`) that have since gone merge-conflicted. Report-only; no I/O here.
import { ownerMergeGo } from './owner-merge-go.mjs'

const DAY = 86400000
const days = (ms) => Math.floor(ms / DAY)

/**
 * @param {{ prs: Array<{number:number,title?:string,html_url?:string,created_at:string,
 *   headCommitDate?:string, base:string, head:string, checkRunNames:string[]}>,
 *   now?: number, days?: number }} input
 */
export function epicNoCi({ prs = [], now = Date.now(), days: minDays = 3 }) {
  return prs
    .filter((p) => p.base === 'main' && String(p.head).startsWith('epic/'))
    .filter((p) => !(p.checkRunNames || []).includes('CI Gate'))
    .map((p) => {
      const since = Math.max(Date.parse(p.created_at) || 0, Date.parse(p.headCommitDate) || 0)
      return { number: p.number, title: p.title, url: p.html_url, ageDays: days(now - since) }
    })
    .filter((p) => p.ageDays > minDays)
    .sort((a, b) => b.ageDays - a.ageDays)
}

/**
 * @param {{ pr: {number:number,title?:string,html_url?:string,mergeable_state?:string},
 *   comments: any[], commits: any[], owner: string, now?: number, days?: number }} input
 * @returns {null | {number:number,title?:string,url?:string,okAgeDays:number}}
 */
export function okButConflicting({ pr, comments, commits, owner, now = Date.now(), days: minDays = 1 }) {
  if (pr.mergeable_state !== 'dirty') return null
  const r = ownerMergeGo({ comments, commits, owner })
  if (!r.go || !r.approvedAt) return null
  const age = now - Date.parse(r.approvedAt)
  if (!(age > minDays * DAY)) return null
  return { number: pr.number, title: pr.title, url: pr.html_url, okAgeDays: days(age) }
}
