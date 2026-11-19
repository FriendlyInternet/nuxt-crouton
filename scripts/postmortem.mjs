// postmortem.mjs — pure decisions for the pipeline epic postmortem (#3425). No I/O.
// GitHub I/O lives in postmortem-run.mjs; postmortem.yml calls it (target → write → post).
// The epic's numbers (#3253) are computed in lib/epic-numbers.mjs; this file only appends them.
//
// Markers (HTML comments, invisible when rendered, read from the raw body):
//   <!-- postmortem:done epic=#N -->                 the postmortem is posted
//   <!-- postmortem:skipped epic=#N -->              the run failed; closing is not held up
//   <!-- postmortem:close-pending via=<path> epic=#N -->  a close path waits for the postmortem
//
// TRUST: this repo is public, so anyone can comment a marker. `done`/`skipped` count only from the
// pipeline bots or an OWNER/MEMBER/COLLABORATOR (today's interactive postmortems are posted by a
// collaborator). `close-pending` counts ONLY from the pipeline bots — no human comment can arm a close.

export const PIPELINE_AUTHORS = ['nuxt-harness[bot]', 'github-actions[bot]']
export const TRUSTED_ASSOC = ['OWNER', 'MEMBER', 'COLLABORATOR']
import { renderNumbersFailed } from './lib/epic-numbers.mjs'

export const PROVENANCE = '> 🤖 **pi.dev harness** · agent pipeline (CI) · _epic postmortem (#3425)_'
export const MIN_BODY = 200

export const isPipelineAuthor = c => c?.user?.type === 'Bot' && PIPELINE_AUTHORS.includes(c?.user?.login)
export const isTrustedAuthor = c => isPipelineAuthor(c) || TRUSTED_ASSOC.includes(c?.author_association)

// Drop fenced blocks and inline code spans: a marker quoted as an example is not a marker.
export function stripCode(body = '') {
  return String(body || '').replace(/```[\s\S]*?(```|$)/g, '').replace(/~~~[\s\S]*?(~~~|$)/g, '').replace(/`[^`\n]*`/g, '')
}

const STATE_RE = /<!--\s*postmortem:(done|skipped)\b[^>]*-->/g
const PENDING_RE = /<!--\s*postmortem:close-pending\s+via=(verified|close-epic)\b[^>]*-->/g

/** 'done' | 'skipped' | null — from trusted comments only; done wins over skipped. */
export function postmortemState(comments = []) {
  let skipped = false
  for (const c of comments || []) {
    if (!isTrustedAuthor(c)) continue
    for (const m of stripCode(c.body).matchAll(STATE_RE)) {
      if (m[1] === 'done') return 'done'
      skipped = true
    }
  }
  return skipped ? 'skipped' : null
}

/** null | 'verified' | 'close-epic' — the latest close-pending marker from a pipeline bot. */
export function pendingClose(comments = []) {
  let via = null
  for (const c of comments || []) {
    if (!isPipelineAuthor(c)) continue
    for (const m of stripCode(c.body).matchAll(PENDING_RE)) via = m[1]
  }
  return via
}

/**
 * Should a postmortem run start for this epic?
 * @returns {{ go: boolean, reason: string }}
 */
// `pendingSteps` (#3846): steps of a `tickets:rolling` epic not finished yet (lib/epic-steps.mjs
// stepsPending). Every sub-issue written so far can be closed after step 0 while later steps have no
// ticket yet, so the automatic start waits; a manual run still goes.
// `dryRun` (#3253): a hand-started run that posts nothing (the body goes to the job summary), so it may
// re-run an epic that already has a postmortem — how the numbers + steps check are tried on old epics.
export function decidePostmortemRun({ isEpic = false, subIssues = [], comments = [], manual = false, pendingSteps = 0, dryRun = false } = {}) {
  if (!isEpic) return { go: false, reason: 'not an epic' }
  if (dryRun) return { go: true, reason: 'dry run' }
  const state = postmortemState(comments)
  if (state === 'done') return { go: false, reason: 'postmortem already posted' }
  if (manual) return { go: true, reason: state === 'skipped' ? 'manual retry after a skipped run' : 'manual run' }
  if (state === 'skipped') return { go: false, reason: 'an earlier run was skipped — retry by hand' }
  if (pendingSteps > 0) return { go: false, reason: 'steps still pending' }
  const kids = subIssues || []
  if (kids.length > 0 && kids.every(k => k.state === 'closed')) return { go: true, reason: 'every sub-issue is closed' }
  return { go: false, reason: 'not done' }
}

const runLink = runUrl => (runUrl ? `[the run](${runUrl})` : 'the run')

// The trusted numbers tail (#3253): the numbers block, or the "didn't run" line. HTML comments are
// stripped — numbers.md is written on the runner the model shares, so it must not plant a marker.
export function numbersTail({ numbers, numbersFailed, runUrl } = {}) {
  if (numbersFailed) return renderNumbersFailed({ reason: String(numbersFailed).trim(), runUrl })
  const clean = String(numbers || '').replace(/<!--[\s\S]*?-->/g, '').trim()
  return clean || ''
}
const withTail = (body, tail) => (tail ? `${body.replace(/\n+$/, '')}\n\n${tail}\n` : body)

export function renderSkipped({ epic, runUrl, numbers, numbersFailed }) {
  return withTail([
    `<!-- postmortem:skipped epic=#${epic} -->`,
    '<!-- pipeline-note -->',
    PROVENANCE,
    '',
    `⚠️ **Postmortem didn't run** — see ${runLink(runUrl)}. Closing this epic is not held up by it.`,
    '',
    `To retry: run the \`postmortem.yml\` workflow by hand with \`epic=${epic}\`.`
  ].join('\n'), numbersTail({ numbers, numbersFailed, runUrl }))
}

export function renderPending({ epic, via, runUrl }) {
  return [
    `<!-- postmortem:close-pending via=${via} epic=#${epic} -->`,
    '<!-- pipeline-note -->',
    PROVENANCE,
    '',
    `⏳ **The postmortem is running** — this epic closes as soon as it posts (${runLink(runUrl)}).`
  ].join('\n')
}

/**
 * The model's text → the comment to post, or null when it is unusable (posted as skipped instead).
 * Strips every HTML comment the model wrote (it must not plant a close-pending or handoff marker,
 * since this body is posted by a pipeline bot), then leads with the one real marker.
 */
// `numbers` / `numbersFailed` (#3253): the trusted numbers tail goes after the model's text.
export function finalizeBody({ epic, text, numbers, numbersFailed, runUrl }) {
  const clean = String(text || '').replace(/<!--[\s\S]*?-->/g, '').trim()
  if (clean.length < MIN_BODY) return null
  return withTail(`<!-- postmortem:done epic=#${epic} -->\n${PROVENANCE}\n\n${clean}\n`, numbersTail({ numbers, numbersFailed, runUrl }))
}

/** The model prompt: follow the repo's postmortem skill, write the body to a file, change nothing. */
export function buildPostmortemPrompt({ epic, outFile, numbersFile, stepsFile, dryRun = false }) {
  const extra = []
  if (numbersFile) {
    extra.push(
      `- Read \`${numbersFile}\` (the epic's numbers, computed from the run records; it may be missing). Where a`,
      '  "was hard" point is about silent runs or many rounds, cite those runs by link. Do not copy the numbers',
      '  block: a trusted step appends it.'
    )
  }
  if (stepsFile) {
    extra.push(
      `- For each child in \`${stepsFile}\`, compare its ticket steps with the merged diff (\`gh pr diff <pr>\`).`,
      '  Add a `### 🧾 Ticket steps vs diff` section that lists ONLY the steps not done, each as `not done`,',
      '  `dropped with reason (link to the note)` or `dropped without a note`. End it with one line:',
      '  `all other N steps done`.'
    )
  }
  if (dryRun) extra.push('- This epic may already have a postmortem. Write yours from the evidence; do not copy it.')
  return [
    `You are writing the postmortem for epic #${epic} of this repository, in CI (no human is attached).`,
    '',
    'Follow `.claude/skills/postmortem/SKILL.md` for the content and shape, with these pipeline rules:',
    `- Read GitHub with the \`gh\` CLI (read-only token): \`gh issue view ${epic} --comments\`, its sub-issues`,
    `  (\`gh api repos/{owner}/{repo}/issues/${epic}/sub_issues\`), their PRs and comments.`,
    `- Write ONLY the comment body (markdown) to \`${outFile}\` with your file-write tool. Nothing else goes there.`,
    '- Do NOT post comments, change labels, close issues or create issues. A trusted step posts your text,',
    '  adds the `postmortem:done` marker and flips the labels. Do not write any HTML comment marker yourself.',
    '- Step 4 (proposals): for each proposal, say where it is already tracked (link the issue), or write',
    '  "new — not minted (pipeline run)". Never create the issue.',
    '- Back every "was hard" point with evidence (an issue, PR, run or comment link).',
    '- End with the `🔭 Next` section.',
    '- Do not @mention anyone: this comment needs nothing back.',
    ...extra
  ].join('\n')
}
