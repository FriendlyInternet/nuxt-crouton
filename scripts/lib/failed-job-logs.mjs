/**
 * Pick the failed jobs worth quoting in the fix-bot hand-back and render their log tails (#3336).
 *
 * The aggregate gate (`CI Gate`, `E2E Gate`) always fails when any job does and its log is only a
 * JSON summary, so quoting it hides the real error. Pure: the caller supplies the jobs list and a
 * `fetchLog(jobId)` function (Octokit in the workflow), so this has no network of its own.
 */
import { logTail } from './log-tail.mjs'

const MAX_JOBS = 3

/** @param {Array<{id:number,name:string,conclusion:string|null}>} jobs */
export function pickFailedJobs(jobs) {
  return (jobs || [])
    .filter(j => (j.conclusion === 'failure' || j.conclusion === 'timed_out') && !/\bgate$/i.test(j.name || ''))
    .slice(0, MAX_JOBS)
}

/**
 * @param {Array<{id:number,name:string}>} picked
 * @param {(jobId:number)=>Promise<string>} fetchLog
 * @returns {Promise<string>} markdown, each job's tail in its own fence
 */
export async function renderFailedJobLogs(picked, fetchLog) {
  if (!picked.length) {
    return 'Only the aggregate CI Gate failed — no other job reported an error; see the failing run.'
  }
  const parts = []
  for (const job of picked) {
    let tail = ''
    try {
      tail = logTail(await fetchLog(job.id), { maxLines: 60, maxBytes: 4096 }).text
    } catch { tail = '' }
    if (!tail) {
      parts.push(`### ${job.name}\n(log for ${job.name} could not be fetched)`)
      continue
    }
    parts.push(`### ${job.name}\n\`\`\`\n${tail.replaceAll('```', "'''")}\n\`\`\``)
  }
  return parts.join('\n\n')
}
