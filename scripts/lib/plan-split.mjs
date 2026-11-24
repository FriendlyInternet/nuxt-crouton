/**
 * A plan too big for one run splits itself (#4184). PURE, Node core only, no `gh`: the new ticket's
 * body and labels for the part an approved plan's `### Split` moves out (plan-shape.mjs parseSplit).
 * scripts/handoff-exec.mjs `resolvePlanBuild` does every GitHub call (create, sub-issue link, note).
 *
 * Rules (tested in plan-split.test.mjs):
 *   - the body carries SPLIT_MARKER (the replay lookup finds an already-filed ticket by it),
 *     `Blocked-by: #<n>` and ONE pipeline block with the original's epic / epic_branch / step and
 *     `dispatch=work-this`, so the wave scheduler starts it once the original closes;
 *   - labels keep only `pkg:*` / `app:*` / `type:*` — never a stage or status label.
 */
import { parsePipelineBlock, formatPipelineBlock } from '../pipeline-context.mjs'

export const SPLIT_MARKER = (n, planId) => '<!-- plan-split:v1 from #' + n + ' plan=' + planId + ' -->'
export const NOTE_MARKER = (newN) => '<!-- plan-split-note:v1 #' + newN + ' -->'

/** The lines of a `## <heading>` section of an issue body (heading matched by `re`), up to the next `## `. */
function sectionLines(body, re) {
  const out = []
  let inside = false
  for (const line of String(body || '').split('\n')) {
    if (/^##\s/.test(line)) { inside = re.test(line); continue }
    if (inside && line.trim()) out.push(line)
  }
  return out
}

/** The text a moved item is matched by: its quoted part, else the whole item without quotes/backticks. */
function needle(move) {
  const q = String(move).match(/"([^"]+)"|“([^”]+)”/)
  return (q ? q[1] || q[2] : String(move).replace(/["`“”]/g, '')).trim()
}

function copied(lines, split) {
  const needles = (split.moves || []).map(needle).filter(Boolean)
  const ids = split.tests || []
  return lines.filter((l) => needles.some((n) => l.includes(n)) || ids.some((id) => new RegExp(`\\b${id}\\b`).test(l)))
}

/** The follow-up ticket's body. original = { number, body }; split = parseSplit's `split`. */
export function splitBody({ original, split, planUrl, planId }) {
  const n = original.number
  const body = String(original.body || '')
  const humans = copied(sectionLines(body, /For humans/i), split)
  const howTo = copied(sectionLines(body, /How to test/i), split)
  const fallback = 'see the moved items above'
  const ctx = parsePipelineBlock(body)
  const block = formatPipelineBlock({ epic: ctx.epic, epic_branch: ctx.epic_branch, dispatch: 'work-this', step: ctx.step })
  const approved = body.split('\n').find((l) => /^\s*Packages-approved:/i.test(l))
  const parts = [
    SPLIT_MARKER(n, planId),
    `Split from #${n} by its plan (${planUrl}) — too big for one run: ${split.why}`,
    '',
    '## 👤 For humans',
    humans.length ? humans.join('\n') : `The part of #${n} that did not fit one build run — ${fallback}.`,
    '',
    '## 🤖 For agents',
    `Moved here from #${n} (its approved plan's \`### Split\`):`,
    ...(split.moves || []).map((m) => `- ${m}`),
    ...(split.tests?.length ? [`- Tests moved from #${n}'s plan: ${split.tests.join(', ')}`] : []),
    '',
    '## 🧪 How to test',
    howTo.length ? howTo.join('\n') : `Run the checks for the moved items — ${fallback}.`,
    '',
    `Dedup-checked: split from #${n}`,
    `Blocked-by: #${n}`,
  ]
  if (approved) parts.push(approved.trim())
  if (block) parts.push('', block)
  return parts.join('\n') + '\n'
}

/** The original's labels the follow-up keeps: only what describes the ticket, never a stage/status. */
export function splitLabels(names = []) {
  return (names || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter((l) => /^(pkg|app|type):/.test(l || ''))
}
