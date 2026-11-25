// Fix-bot precheck + "why no commit" (#4317). Pure decisions, node built-ins only; the workflow
// (fix-ci-on-failure.yml, step `gate`) only calls them.
//
// A. Still red? Before any model runs: if the PR head moved past the failed commit, or the failed
//    run has since gone green on the same commit (the owner pressed "Re-run failed jobs"), there is
//    nothing to fix. Any doubt (the jobs can't be read) fails OPEN — the fixer runs as before.
// B. One reason per run that pushed no fix, from the jobs' `needs` (result + declared outputs), so a
//    run record says WHY it produced nothing instead of only `nothing`.

/**
 * @param {{ failedSha?: string|null, headSha?: string|null, checks: {name?:string, conclusion:string|null}[]|null }} input
 * @returns {{ run: boolean, reason: string }}
 */
export function decideStillRed({ failedSha, headSha, checks }) {
  if (failedSha && headSha && failedSha !== headSha) return { run: false, reason: 'head-moved' }
  if (checks === null || checks === undefined) return { run: true, reason: 'check-unreadable' }
  if (checks.length > 0 && checks.every(c => c.conclusion === 'success')) return { run: false, reason: 'already-green' }
  return { run: true, reason: 'still-red' }
}

/** Reads the failed run's newest job attempts (when it is still the PR head) and decides. Never throws. */
export async function stillRed({ github, owner, repo, run, headSha }) {
  const failedSha = run?.head_sha || null
  let checks = []
  if (failedSha === headSha) {
    try {
      const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, { owner, repo, run_id: run.id, filter: 'latest', per_page: 100 })
      checks = jobs.filter(j => j.conclusion !== 'skipped').map(j => ({ name: j.name, conclusion: j.conclusion }))
    } catch {
      checks = null
    }
  }
  return decideStillRed({ failedSha, headSha, checks })
}

/**
 * #2163: a `pkg:*` leaf issue unlocks packages/ for exactly those packages; an epic head never does.
 * @returns {Promise<{ allowed: 'true'|'false', names: string }>}
 */
export async function packagesAllowedFor({ github, owner, repo, issueNumber, head, warn = () => {} }) {
  if (!issueNumber || /^epic\//.test(String(head || ''))) return { allowed: 'false', names: '' }
  try {
    const iss = (await github.rest.issues.get({ owner, repo, issue_number: issueNumber })).data
    const pkgs = (iss.labels || [])
      .map(l => (typeof l === 'string' ? l : l.name))
      .filter(n => /^pkg:/.test(n)).map(n => n.slice(4))
    if (pkgs.length) return { allowed: 'true', names: pkgs.join(' ') }
  } catch (e) { warn(`pkg-label check #${issueNumber}: ${e.message}`) }
  return { allowed: 'false', names: '' }
}

/** Every reason a fixer run can end with no fix pushed. The gate codes are fixBotWillTry's (fix-bot-dispatch.mjs). */
export const NO_COMMIT_REASONS = [
  'not-eligible', 'no-failed-run', 'blocked', 'not-watched', 'not-failure', 'gave-up', 'already-diagnosed',
  'already-green', 'head-moved', 'same-on-base', 'diagnosis-missing', 'diagnosis-not-approved',
  'guard-refused', 'model-no-change', 'run-failed', 'unknown',
]

const broke = (r) => r === 'failure' || r === 'cancelled'

/**
 * @param {Record<string, { result?: string, outputs?: Record<string, string> }>} needs  parsed toJSON(needs)
 * @returns {string|null} one NO_COMMIT_REASONS code, or null when a fix was pushed
 */
export function noCommitReason(needs = {}) {
  const fb = needs.fixbot || {}
  const fo = fb.outputs || {}
  const gate = fixbotReason(fb.result, fo)
  if (gate) return gate
  const fx = needs.fix || {}
  return fixReason(fx.result, fx.outputs || {}, fo.mode === 'diagnose')
}

/** Why job fixbot ended the run (failed, gate stop, same on base, no diagnosis), or '' when job fix ran. */
function fixbotReason(result, fo) {
  if (broke(result)) return 'run-failed'
  if (fo.proceed !== 'true') return fo.skip_reason || 'unknown'
  if (fo.base_skip === 'true') return 'same-on-base'
  if (fo.mode === 'diagnose' && fo.diagnosed !== 'true') return 'diagnosis-missing'
  return ''
}

// Job fix's exits, in order: the first rule that matches names the reason (null = a fix was pushed).
const FIX_RULES = [
  [(r) => broke(r.result), () => 'run-failed'],
  [(r) => r.xo.moved === 'true', () => 'head-moved'],
  [(r) => r.xo.go !== 'true', (r) => (r.diagnose ? 'diagnosis-not-approved' : 'unknown')],
  [(r) => r.xo.refused === 'true', () => 'guard-refused'],
  [(r) => r.xo.pushed === 'true', () => null],
  [(r) => r.xo.committed !== 'true', () => 'model-no-change'],
]

function fixReason(result, xo, diagnose) {
  const r = { result, xo, diagnose }
  const hit = FIX_RULES.find(([when]) => when(r))
  return hit ? hit[1](r) : 'unknown'
}
