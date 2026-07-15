#!/usr/bin/env node
/**
 * deploy-failure-report — the decision behind the post-merge deploy watchdog
 * (.github/workflows/report-failed-deploy.yml, #340). Pure + unit-tested (mirrors
 * scripts/packages-guard.mjs / scripts/deploy-detect.mjs); the workflow's github-script does
 * only the GitHub I/O (find the rolling ticket, fetch failed-job logs) and then acts on the
 * decision returned here.
 *
 * Fixes the noise that produced #1617/#1548/#1535 — three separate 🔴 tickets for what was
 * two self-healed CF flakes + one already-fixed migration (#1639):
 *   1. Rolling dedup — one ticket per workflow[+app], commented on re-failure, not one-per-run.
 *   2. Transient-flake classification — a CF infra blip (D1 7429, fetch-failed) is labeled
 *      `transient-infra` and does NOT @-ping; a real regression pings loudly as before.
 *   3. Honest attribution — a non-`push` run (e.g. workflow_dispatch) caveats that the commit
 *      shown is the branch tip at run time, not necessarily the cause (the #1617 misattribution).
 */

// Signatures that mean "the runner/Cloudflare hiccuped", not "the code is broken". Drawn from
// the real failing logs of #1548 (D1 overloaded 7429) and #1535 (fetch failed / connectivity).
export const TRANSIENT_SIGNATURES = [
  /\[code: 7429\]/,
  /D1 DB is overloaded/i,
  /Requests queued for too long/i,
  /A fetch request failed/i,
  /likely due to a connectivity issue/i,
  /\bfetch failed\b/i,
  /\bECONNRESET\b/,
  /\bETIMEDOUT\b/,
  /\bEAI_AGAIN\b/,
  /socket hang up/i,
  /\b50[234]\b[^\n]+(gateway|unavailable|timeout|time-out)/i
]

// Signatures of a genuine, code-caused failure. These WIN over a transient match (a run can
// print a connectivity warning and still have died on a real error) so we never mislabel a
// real regression as a flake. From #1620 (NOT NULL constraint) + the usual build/type errors.
export const HARD_SIGNATURES = [
  /constraint failed/i,
  /SQLITE_/,
  /error TS\d+/,
  /Type error:/i,
  /Cannot find module/i,
  /Cannot resolve/i,
  /No migrations present/i,
  /No schema files found/i,
  /is not defined/,
  /SyntaxError/,
  /Could not load/i
]

/** Classify failed-job log text. A hard signature always wins; unknown → treated as real. */
export function classifyLogs(text = '') {
  const s = String(text)
  const hard = HARD_SIGNATURES.find(re => re.test(s))
  if (hard) return { transient: false, reason: `hard-failure signature ${hard}` }
  const soft = TRANSIENT_SIGNATURES.find(re => re.test(s))
  if (soft) return { transient: true, reason: `transient signature ${soft}` }
  return { transient: false, reason: null }
}

/** App/poc slug from a per-app workflow path; the generic deploy-apps/pocs workflows carry none. */
export function slugFromPath(path = '') {
  const raw = (String(path).match(/deploy-([a-z0-9-]+)\.yml$/) || [])[1] || null
  return raw === 'apps' || raw === 'pocs' ? null : raw
}

// Markers: one rolling ticket per (workflow, slug); each occurrence records its run id so a
// re-run of the SAME failed run doesn't double-log.
export const keyMarker = (workflowName, slug) => `<!-- failed-deploy key:${workflowName}|${slug || '-'} -->`
export const runMarker = runId => `<!-- run:${runId} -->`

const shortSha = sha => String(sha || '').slice(0, 7)
const firstLine = msg => String(msg || '').split('\n')[0]

function attribution(run) {
  const sha = shortSha(run.head_sha)
  const url = `https://github.com/${run.repoFullName}/commit/${run.head_sha}`
  const msg = firstLine(run.head_commit?.message)
  const line = `- **Commit at run time:** [\`${sha}\`](${url})${msg ? ` — ${msg}` : ''}`
  // A push deploy's head_sha IS the merge that triggered it. A workflow_dispatch (or any
  // non-push) run's head_sha is just the branch tip when it ran — NOT necessarily the cause
  // (the #1617 trap: a manual prod deploy blamed on an unrelated `[skip ci]` commit).
  if (run.event === 'push') return line
  return `${line}\n  - ⚠️ _\`${run.event}\` run — this commit is the branch tip at run time, not necessarily the cause._`
}

function occurrence(run, classification) {
  const tag = classification.transient ? '🟡 likely transient infra' : '🔴 likely a real failure'
  return [
    `${tag} · [failing run](${run.html_url}) · \`${run.event}\``,
    attribution(run),
    classification.reason ? `- _Signal: ${classification.reason}_` : '- _Signal: unrecognised — treat as real._',
    runMarker(run.id)
  ].join('\n')
}

/**
 * Decide what to do with a failed post-merge deploy run. PURE.
 *   run: { id, name, event, path, head_sha, head_commit, html_url, head_branch, repoFullName }
 *   classification: from classifyLogs()
 *   existing: { number, text } for the open rolling ticket, or null. `text` = its body + all
 *             comments joined (used to skip an already-recorded run id).
 *   appLabel: a resolved existing `app:`/`poc:` label name, or null.
 */
export function decideReport({ run, classification, existing = null, appLabel = null }) {
  const slug = slugFromPath(run.path)
  const ping = !classification.transient
  const labels = ['type:fix', 'meta:agents']
  if (classification.transient) labels.push('transient-infra')
  if (appLabel) labels.push(appLabel)

  if (existing) {
    if (String(existing.text || '').includes(runMarker(run.id))) {
      return { action: 'skip', reason: `run ${run.id} already recorded on #${existing.number}`, ping: false }
    }
    return { action: 'comment', issueNumber: existing.number, ping, body: occurrence(run, classification) }
  }

  const title = `🚨 ${run.name} failed on ${run.head_branch} (post-merge)`
  const mention = ping ? `🔴 **@pmcp — a post-merge deploy failed: \`${run.name}\` broke on \`${run.head_branch}\`.**` : `🟡 **Post-merge deploy hiccup (likely transient): \`${run.name}\` on \`${run.head_branch}\`.**`
  const body = [
    mention,
    '',
    ping
      ? `The change is already merged, so this ticket exists so the breakage isn't lost.`
      : `Looks like a transient CF/runner blip that usually self-heals on the next deploy — recorded here (no ping) so a *recurring* flake still shows as a pattern.`,
    '',
    '## Occurrences',
    '',
    occurrence(run, classification),
    '',
    '## 🧪 How to verify the fix',
    `1. Reproduce: re-run \`${run.name}\` or run the app's deploy locally and watch for the same error.`,
    `2. Fix the cause on a branch, open a PR (\`Closes #<this>\`), and confirm the deploy goes green.`,
    '',
    `<sub>🤖 **Claude Code** · agent pipeline (CI) · _post-merge deploy watchdog (#340, #1639)_</sub>`,
    keyMarker(run.name, slug)
  ].join('\n')

  return { action: 'create', title, body, labels, ping }
}
