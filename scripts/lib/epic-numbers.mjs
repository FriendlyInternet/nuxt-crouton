// epic-numbers.mjs — the epic's numbers for its postmortem (#3253). Pure, no I/O.
// The I/O (gh + the pipeline-data run records) lives in scripts/epic-numbers-run.mjs; postmortem.yml
// runs it before the model, and the trusted `post` step appends `renderNumbers` to the postmortem and
// stores the JSON as `epics/<N>.json` on `pipeline-data` (read by the 10-epic review, #3254).
//
// Numbers are COMPUTED here, never by the model, so they match the run records exactly.
// Definitions (logged on #3253, cheap to change):
//   planRounds  = plan-review records          buildRounds = build-review records
//   revises     = revise + conflict records    silent      = records whose `produced` has 'nothing'
//   timeToMainHours = epic created_at → the latest merge of a PR whose base is main
//   ownerTouches    = the owner's comments on the epic, children and their PRs that are not a plain
//                     approval (`isApproval`), split into typed vs posted by an interactive agent.
import { isApproval, isAgentComment } from '../approval.mjs'

/** Run records start here (#3251 went live; there are no backfill rows). */
export const RECORDS_START = '2026-11-04'

const num = v => (v == null || v === '' ? null : Number(v) || null)

/**
 * Which child issue a run record belongs to, or null.
 * `record.issue` wins when it is a child; otherwise the record's PR is looked up (build-review and
 * fix-ci records carry only `pr`).
 */
export function childFor(record, prToIssue = {}, childSet = new Set()) {
  const issue = num(record?.issue)
  if (issue && childSet.has(issue)) return issue
  const pr = num(record?.pr)
  const viaPr = pr ? num(prToIssue[pr]) : null
  return viaPr && childSet.has(viaPr) ? viaPr : null
}

/** PR → child issue: from records that carry both, then from the PRs found per child. */
export function buildPrToIssue(records = [], children = []) {
  const childSet = new Set(children.map(c => num(c.number)))
  const map = {}
  for (const c of children) for (const p of c.prs || []) if (num(p.number)) map[num(p.number)] = num(c.number)
  for (const r of records) {
    const issue = num(r?.issue); const pr = num(r?.pr)
    if (issue && pr && childSet.has(issue) && !map[pr]) map[pr] = issue
  }
  return map
}

const STAGE_COUNTS = { 'plan-review': 'planRounds', 'build-review': 'buildRounds', revise: 'revises', conflict: 'revises' }
const isSilent = r => Array.isArray(r?.produced) && r.produced.includes('nothing')

function dedupe(records) {
  const seen = new Set()
  return (records || []).filter(r => {
    const key = `${r?.run_id ?? r?.ref}-${r?.attempt ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function timeToMain(epicCreatedAt, prs) {
  const merged = prs.filter(p => p.baseRef === 'main' && p.mergedAt).map(p => Date.parse(p.mergedAt)).filter(Number.isFinite)
  const start = Date.parse(epicCreatedAt || '')
  if (!merged.length || !Number.isFinite(start)) return null
  return Math.round(((Math.max(...merged) - start) / 36e5) * 10) / 10
}

function ownerTouches(comments, ownerLogin) {
  const out = { typed: 0, viaAgent: 0, links: [] }
  for (const c of comments || []) {
    if (c?.user?.login !== ownerLogin || isApproval(c.body)) continue
    if (isAgentComment(c.body)) out.viaAgent++
    else out.typed++
    if (c.html_url) out.links.push(c.html_url)
  }
  return out
}

/**
 * @param {object} a
 * @param {number} a.epic
 * @param {string} a.epicCreatedAt
 * @param {{ number: number, title?: string, prs?: { number: number, baseRef?: string, mergedAt?: string }[] }[]} a.children
 * @param {{ number: number, baseRef?: string, mergedAt?: string }[]} [a.epicPrs] the epic branch → main PRs
 * @param {object[]} a.records the run records (pipeline-data records/**)
 * @param {object[]} a.ownerComments every comment on the epic, children and PRs (filtered to the owner here)
 * @param {string} [a.ownerLogin]
 */
const emptyRow = issue => ({ issue, runs: 0, planRounds: 0, buildRounds: 0, revises: 0, silent: 0 })

// One record into a row (a child's, or the epic's own).
function tally(row, r) {
  row.runs++
  const k = STAGE_COUNTS[r.stage]
  if (k) row[k]++
  if (isSilent(r)) row.silent++
}

const silentEntry = (r, child) => ({ ref: r.ref || null, workflow: r.workflow || r.flow || null, stage: r.stage || null, child })

export function epicNumbers({ epic, epicCreatedAt, children = [], epicPrs = [], records = [], ownerComments = [], ownerLogin = 'pmcp', stepLine = null } = {}) {
  const epicN = num(epic)
  const childSet = new Set(children.map(c => num(c.number)))
  const prToIssue = buildPrToIssue(records, children)
  const epicPrSet = new Set(epicPrs.map(p => num(p.number)))
  const isOnEpic = r => num(r?.issue) === epicN || epicPrSet.has(num(r?.pr))
  const perChild = children.map(c => emptyRow(num(c.number)))
  const byIssue = new Map(perChild.map(r => [r.issue, r]))
  const epicRow = emptyRow(epicN)
  const silent = []
  for (const r of dedupe(records)) {
    const child = childFor(r, prToIssue, childSet)
    const row = child ? byIssue.get(child) : isOnEpic(r) ? epicRow : null
    if (!row) continue
    tally(row, r)
    if (isSilent(r)) silent.push(silentEntry(r, child))
  }
  const allPrs = [...epicPrs, ...children.flatMap(c => c.prs || [])]
  return {
    epic: epicN,
    runs: epicRow.runs + perChild.reduce((s, r) => s + r.runs, 0),
    epicRuns: epicRow.runs,
    silent,
    perChild,
    timeToMainHours: timeToMain(epicCreatedAt, allPrs),
    ownerTouches: ownerTouches(ownerComments, ownerLogin),
    stepLine: stepLine || null
  }
}

const runLink = (s, i) => (s.ref ? `[${s.stage || 'run'}${s.child ? ` #${s.child}` : ''}](${s.ref})` : `${s.stage || 'run'} ${i + 1}`)

/** The `### 📊 Numbers` block the trusted post step appends. Never invents zeros for missing records. */
export function renderNumbers(n) {
  const t = n?.ownerTouches || { typed: 0, viaAgent: 0 }
  const ttm = n?.timeToMainHours == null ? 'not merged to main' : `${n.timeToMainHours} h`
  const touches = `owner touches beyond \`ok\`: ${t.typed} typed, ${t.viaAgent} via an agent session`
  const lines = ['### 📊 Numbers', '']
  // #4316: what was built vs dropped (not planned) — first, in both branches.
  if (n?.stepLine) lines.push(`Steps: ${n.stepLine}`, '')
  if (!n?.runs) {
    lines.push(`No run records for this epic (records start ${RECORDS_START}). Time to main: ${ttm} · ${touches}.`)
    return lines.join('\n')
  }
  lines.push(`**${n.runs} runs** · **${n.silent.length} silent** · time to main: ${ttm} · ${touches}.`, '')
  lines.push('| child | runs | plan rounds | build rounds | revises | silent |', '|---|---|---|---|---|---|')
  for (const r of n.perChild) lines.push(`| #${r.issue} | ${r.runs} | ${r.planRounds} | ${r.buildRounds} | ${r.revises} | ${r.silent} |`)
  if (n.epicRuns) lines.push(`| epic #${n.epic} itself | ${n.epicRuns} | | | | |`)
  if (n.silent.length) lines.push('', `Silent runs (produced nothing): ${n.silent.map(runLink).join(' · ')}`)
  return lines.join('\n')
}

export function renderNumbersFailed({ reason, runUrl } = {}) {
  const link = runUrl ? ` ([the run](${runUrl}))` : ''
  return `📊 **Numbers didn't run** — ${reason || 'unknown reason'}${link}. The epic is not held up by it.`
}

const STEP_SECTIONS = ['do', 'for agents', 'how to test', 'test']
const headingKey = h => h.replace(/[^\p{L}\p{N}\s]/gu, '').trim().toLowerCase()

/**
 * The ticket's steps: numbered (`1.`) and bulleted top-level items under `## Do`, `## 🤖 For agents`,
 * `## 🧪 How to test` and `## Test`. Code spans are kept as written; fenced blocks are skipped.
 * @returns {{ section: string, n: number, text: string }[]}
 */
// One line → { fence } | { heading } | { n?, text } (a step) | null.
function classifyLine(line) {
  if (/^\s*(```|~~~)/.test(line)) return { fence: true }
  const h = line.match(/^#{1,6}\s+(.*)$/)
  if (h) return { heading: h[1].trim() }
  const numbered = line.match(/^ ?(\d+)[.)]\s+(.*\S)/)
  if (numbered) return { n: Number(numbered[1]), text: numbered[2] }
  const bullet = line.match(/^ ?[-*]\s+(.*\S)/)
  return bullet ? { text: bullet[1] } : null
}

export function extractTicketSteps(body = '') {
  const out = []
  const st = { section: null, fenced: false, count: 0 }
  for (const line of String(body || '').split('\n')) {
    const c = classifyLine(line)
    if (c?.fence) st.fenced = !st.fenced
    if (st.fenced || !c || c.fence) continue
    if (c.heading != null) {
      st.section = STEP_SECTIONS.includes(headingKey(c.heading)) ? c.heading : null
      st.count = 0
    } else if (st.section) {
      st.count = c.n ?? st.count + 1
      out.push({ section: st.section, n: st.count, text: c.text })
    }
  }
  return out
}
