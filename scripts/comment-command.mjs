/**
 * #2004 — decide whether an issue comment is actually *issuing* a dispatch command,
 * as opposed to merely *mentioning* one.
 *
 * The incident it encodes: on #1791 a comment was posted explaining that a previous
 * run had been dispatched down the wrong lane. That explanation contained a small
 * rules table with `/delegate` in a cell — and `comment-dispatch.yml` gated on a plain
 * `contains(body, '/delegate')`, so the comment describing the misfire performed the
 * misfire, 14 seconds after it was posted. Twice in one evening the owner was paged
 * with "this run produced nothing" for a pipeline that was working correctly.
 *
 * The rule: a command counts only when it stands at the START of a line, outside code
 * and outside a quote. That is the ordinary slash-command convention, and it lets the
 * pipeline be documented in its own issue threads — which it currently cannot be.
 *
 *   node --test scripts/comment-command.test.mjs
 */

/**
 * Remove the regions of a Markdown body where a command is being *shown*, not *given*:
 * fenced code blocks, inline code spans, and blockquote lines.
 *
 * Blockquotes matter as much as code here: every agent comment in this repo opens with a
 * `> 🤖 …` provenance header, and quoting somebody else's dispatch is a normal thing to
 * do in a thread. Neither should re-fire the pipeline.
 */
function stripNonCommandRegions(body) {
  return body
    // Fenced blocks first — their content may contain backticks that would otherwise
    // confuse the inline-span pass.
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    // Inline code spans (single line only, so an unmatched backtick can't eat the body).
    .replace(/`[^`\n]*`/g, '')
    .split('\n')
    .filter(line => !/^\s*>/.test(line))
    .join('\n')
}

/**
 * The command vocabulary, in match order.
 *
 * NAMED FOR WHAT THE LANE DOES, not for who does it (#2010). `/delegate` said *who*
 * (an agent) and not *what* (plan it, or build it) — so on an issue whose work had
 * already started, the obvious word was the wrong lane, and the decomposer was sent
 * somewhere it had nothing to plan. `/plan` and `/build` cannot be confused that way.
 *
 * The old names stay as aliases forever: they are written into issue bodies, skills and
 * runbooks across the repo, and silently breaking them would be a worse trap than the
 * one this replaces.
 *
 * Order is load-bearing twice over: `work`/`build` before the planning lane, and the
 * `-pi` variants before their bare forms — `/plan` is a prefix of `/plan-pi`, exactly as
 * `/delegate` is of `/delegate-pi` (#1077).
 */
const COMMANDS = [
  { label: 'work-this', words: ['build', 'work'] },
  { label: 'delegate-pi', words: ['plan-pi', 'delegate-pi'] },
  { label: 'delegate', words: ['plan', 'delegate', 'deploy'] },
]

/**
 * Which label a comment is asking for, or `null` when it is only talking about them.
 *
 * @param {string} body Raw Markdown body of the issue comment.
 * @returns {'delegate-pi' | 'delegate' | 'work-this' | null}
 */
export function parseCommand(body) {
  const text = stripNonCommandRegions(String(body || ''))

  // Anchored to line start (`m`), allowing leading whitespace so an indented command in
  // a list item still works. The trailing boundary stops `/plan-pi` being read as `/plan`
  // and `/workflow-thing` as `/work`.
  const has = word => new RegExp(`^[ \\t]*/${word}(?![\\w-])`, 'm').test(text)

  for (const { label, words } of COMMANDS) {
    if (words.some(has)) return label
  }
  return null
}

/**
 * The lane a dispatch should actually take, given what already exists on the repo.
 *
 * WHY THIS EXISTS. `/delegate` is the reflex gesture — for a long time it was the only
 * one — and on an issue whose work is already in flight it routes to the decomposer,
 * which has nothing left to plan. It produces no artifact, the artifact-gate (#461)
 * correctly fails the run, and the owner is paged about a pipeline that was working.
 * That is exactly what happened on #1791.
 *
 * So the lane is chosen from OBSERVED STATE, not from which word was typed: if a
 * `work-<issue>` branch already exists, "delegate this" means *finish it*. An explicit
 * `/work` is always honoured, and a `/delegate` on an issue with no work branch still
 * goes to the decomposer exactly as before.
 *
 * @param {'delegate-pi'|'delegate'|'work-this'} command  What the comment asked for.
 * @param {boolean} hasWorkBranch  Whether `work-<issue-number>` exists on origin.
 * @returns {{ label: string, rerouted: boolean }}
 */
export function resolveLane(command, hasWorkBranch) {
  if (command !== 'work-this' && hasWorkBranch) {
    return { label: 'work-this', rerouted: true }
  }
  return { label: command, rerouted: false }
}

