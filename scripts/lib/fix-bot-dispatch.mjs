// fix-bot-dispatch.mjs — may the CI fix-bot run on this PR when started by hand? (#3105)
//
// The fix-bot's `workflow_run` trigger only sees `work-*` heads. The manual `workflow_dispatch` path
// (started by the owner's `ok` on a red epic → main PR) also accepts an `epic/*` head into `main`,
// but ONLY while the PR is open and the owner's `ok` still stands (`go` = ownerMergeGo() result).
// Pure; the workflow gathers the facts.

/** @returns {{ run: boolean, reason: string }} */
export function decideFixBotDispatch({ head, base, state, go }) {
  const h = String(head || '')
  if (state !== 'open') return { run: false, reason: `PR is not open (${state})` }
  if (h.startsWith('work-')) return { run: true, reason: 'work-* branch' }
  if (!h.startsWith('epic/')) return { run: false, reason: `head ${h} is not a pipeline branch` }
  if (base !== 'main') return { run: false, reason: `epic head must target main (base is ${base})` }
  if (!go?.go) return { run: false, reason: go?.reason || 'no standing owner ok' }
  return { run: true, reason: 'epic → main with a standing owner ok' }
}

/**
 * The newest failed CI/E2E workflow run for a head sha. A check-run id is NOT a workflow-run id,
 * so this takes workflow runs (actions.listWorkflowRunsForRepo), never check runs.
 * @param {{ id:number, name:string, conclusion:string|null, created_at?:string, html_url?:string }[]} runs
 */
export function pickFailedRun(runs = []) {
  const failed = runs
    .filter(r => ['CI', 'E2E'].includes(r.name) && r.conclusion === 'failure')
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return failed[0] || null
}
