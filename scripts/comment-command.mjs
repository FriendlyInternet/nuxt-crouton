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
 * Which label a comment is asking for, or `null` when it is only talking about them.
 *
 * `/delegate-pi` is tested before `/delegate` because the latter is a prefix of the
 * former — that ordering is load-bearing (#1077). `/deploy` maps to `delegate` too,
 * preserving the behaviour the workflow shipped with. `/work` reaches the single-use
 * worker lane, which had no comment gesture at all before #2010.
 *
 * @param {string} body Raw Markdown body of the issue comment.
 * @returns {'delegate-pi' | 'delegate' | 'work-this' | null}
 */
export function parseCommand(body) {
  const text = stripNonCommandRegions(String(body || ''))

  // Anchored to line start (`m`), allowing leading whitespace so an indented command in
  // a list item still works. A trailing boundary stops `/delegate-something-else` from
  // being read as `/delegate`.
  const has = cmd => new RegExp(`^[ \\t]*/${cmd}(?![\\w-])`, 'm').test(text)

  if (has('work')) return 'work-this'
  if (has('delegate-pi')) return 'delegate-pi'
  if (has('delegate') || has('deploy')) return 'delegate'
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

