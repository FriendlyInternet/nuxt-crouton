#!/usr/bin/env node
// resume-decomposed.mjs — an issue that is ALREADY decomposed is not a leaf (#2048).
//
// THE BUG THIS CLOSES. The decomposer's LEAF TEST is applied to the issue's *prose*
// ("single coherent change, bounded file set, …") and never to its *sub-issues* — and
// step 1 of the prompt reads the issue with `gh issue view`, which does not list them.
// So epic #515, which has three open, ready children (#516/#517/#518), was classified
// as a single leaf and labelled `work-this`. The single-leaf worker then spent eleven
// minutes trying to implement an entire epic on one branch, produced nothing, and the
// owner was paged about a pipeline doing exactly what it was told.
//
// WHY THIS IS DETERMINISTIC AND NOT A PROMPT LINE. "Does this issue have open children"
// is a lookup, not a judgement. Asking a probabilistic runtime to re-derive a fact the
// API answers directly is how the fact gets ignored. The same state was already being
// paginated twice elsewhere in the very same workflow (the artifact-gate's #1074 child
// -deliverable scan) — just too late to affect the decision. So: check first, and only
// fall through to the LLM classification when there is genuinely nothing to resume.
//
// The correct behaviour for an already-decomposed tree is "resume the tree, work the
// remaining open leaves" — a deliverable the artifact-gate already understands (#1074).

import { pathToFileURL } from 'node:url'
import { appendFileSync, readFileSync } from 'node:fs'
// Both are already the tested source of truth for these two facts — the trigger label the
// worker fires on, and the `Blocked-by: #NN` body format. Importing beats restating them.
import { WORKER_TRIGGER } from './pipeline-loop-guard.mjs'
import { parseBlockedBy } from './apply-decompose-plan.mjs'

/**
 * Which of an already-decomposed issue's children should be dispatched now?
 *
 * @param {Array} children  `[{ number, state, body?, hasOpenChildren? }]` — the target's
 *                          sub-issues, as returned by the sub_issues API.
 * @returns {{ resume: boolean, dispatch: Array<{number:number,label:string}>, waiting:number[], reason:string }}
 *
 * `resume:false` means "not decomposed — classify normally". That covers BOTH an issue
 * with no children at all and one whose children are ALL CLOSED (a finished tree is not
 * a tree to resume; the issue may legitimately have new leaf work).
 */
export function planResume(children = []) {
  const kids = (children || []).filter(Boolean)
  const open = kids.filter((c) => c.state === 'open')
  if (!open.length) {
    return {
      resume: false,
      dispatch: [],
      waiting: [],
      reason: kids.length
        ? `all ${kids.length} sub-issue(s) are closed — nothing to resume`
        : 'no sub-issues — not decomposed',
    }
  }

  // A child waits until every blocker it names is closed (#1750). Blockers are issue
  // NUMBERS in the child's body (`Blocked-by: #NN`), unlike a plan's sibling indices.
  const closed = new Set(kids.filter((c) => c.state === 'closed').map((c) => c.number))
  const openNumbers = new Set(open.map((c) => c.number))
  const dispatch = []
  const waiting = []
  for (const c of open) {
    const blockers = parseBlockedBy(c.body || '')
    // Only a blocker that is still OPEN holds a child back. A blocker outside this tree
    // (or already gone) must not wedge it — an unresolvable reference would otherwise
    // park the child forever with nothing to close it.
    const live = blockers.filter((n) => openNumbers.has(n) && !closed.has(n))
    if (live.length) { waiting.push(c.number); continue }
    // A child that is itself decomposed needs the decomposer again, not a code worker.
    dispatch.push({ number: c.number, label: c.hasOpenChildren ? 'delegate-pi' : WORKER_TRIGGER })
  }

  return {
    resume: true,
    dispatch,
    waiting,
    reason: dispatch.length
      ? `already decomposed — resuming ${dispatch.length} of ${open.length} open child(ren)`
      : `already decomposed — all ${open.length} open child(ren) are blocked by siblings`,
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
//   node scripts/resume-decomposed.mjs < children.json
// children.json is the sub_issues array (with `body`), gathered by the workflow.
// Prints `resume=<0|1>`, `dispatch=<n:label,...>` and `reason=<text>` to $GITHUB_OUTPUT.
function main() {
  let children = []
  try {
    const raw = readFileSync(0, 'utf8').trim()
    children = raw ? JSON.parse(raw) : []
  } catch (err) {
    // Fail OPEN into normal classification: a gather glitch must not stop the pipeline.
    console.log(`::warning::resume-decomposed could not read its input (${err.message}) — classifying normally.`)
    return
  }
  const v = planResume(children)
  console.log(`resume-decomposed: ${v.reason}`)
  if (v.waiting.length) console.log(`  waiting on siblings: ${v.waiting.map((n) => `#${n}`).join(', ')}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `resume=${v.resume ? 1 : 0}`,
      `dispatch=${v.dispatch.map((d) => `${d.number}:${d.label}`).join(',')}`,
      `reason=${v.reason.replace(/[\r\n]+/g, ' ')}`,
      '',
    ].join('\n'))
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
