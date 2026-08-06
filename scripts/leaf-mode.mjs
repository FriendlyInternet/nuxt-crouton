#!/usr/bin/env node
// leaf-mode.mjs — #2060: distinguish "start this leaf from scratch" from "continue this
// branch" so a re-dispatch onto an already-existing work-<issue> branch/PR can't silently
// no-op.
//
// WHY THIS EXISTS. Every no-op observed on #2012 was a re-run against a branch that already
// had work (and sometimes an open PR), never a first run on a fresh leaf. work-issue-pidev.yml
// builds the pi prompt with one fixed "IMPLEMENT this ONE leaf issue end-to-end... branch off
// main/the epic branch" wording regardless of prior state, so a re-dispatch reused the "start
// fresh" instruction verbatim — pi could reasonably (but silently) decide there was nothing new
// to do, and the run then looked identical to a genuine harness crash (the artifact-gate has no
// way to tell the two apart).
//
// `chooseLeafMode` is the pure decision: given facts about whether work-<issue> already exists
// as a branch and/or has a PR referencing the issue, pick 'start' or 'continue'.
// `leafModeInstruction` renders the distinct prompt fragment for each mode — the 'continue' one
// requires an explicit no-further-work comment rather than a silent exit (the #2060 acceptance).
//
// Wiring this into work-issue-pidev.yml (checking `git ls-remote --heads origin work-<issue>`
// and claim-facts.mjs's `self.pr`, then branching the printf that builds the pi prompt) is a
// `.github/workflows/**` edit — outside what this worker may touch (#1076, deliberate policy).
// The verbatim patch is on the tracking issue for a human to apply.

export const START_MODE = 'start'
export const CONTINUE_MODE = 'continue'

/**
 * Decide which mode a leaf dispatch should run in.
 *
 * @param {object}  o
 * @param {boolean} [o.hasWorkBranch]  `work-<issue>` already exists on origin
 * @param {boolean} [o.hasOpenPR]      a PR referencing the issue already exists from that branch
 *                                     (open or merged — either means work already happened;
 *                                     `claim-facts.mjs`/`decideClaim` still gates a COMPETING
 *                                     claim before this is ever reached, so by the time this
 *                                     runs any PR found here is understood to be OUR OWN)
 * @returns {{ mode: 'start' | 'continue' }}
 */
export function chooseLeafMode({ hasWorkBranch = false, hasOpenPR = false } = {}) {
  return { mode: (hasWorkBranch || hasOpenPR) ? CONTINUE_MODE : START_MODE }
}

/**
 * The distinct prompt fragment for a mode, in place of the single "IMPLEMENT this ONE leaf
 * issue end-to-end..." sentence work-issue-pidev.yml currently sends unconditionally.
 *
 * @param {'start'|'continue'} mode
 * @param {object} o
 * @param {string|number} o.issue
 * @returns {string}
 */
export function leafModeInstruction(mode, { issue } = {}) {
  if (mode === CONTINUE_MODE) {
    return `A branch and/or PR for issue #${issue} already exists (work-${issue}). Check it out, read its current diff and the issue's latest comments, and CONTINUE the work — do NOT restart from scratch or assume it is already done. If, having actually read the branch's state, you conclude there is genuinely nothing further to do, you MUST post a top-level comment on the issue explaining why before ending the run — a silent no-op here is a FAILED run, not a success.`
  }
  return `No existing branch or PR was found for issue #${issue} — this is a fresh leaf; start it from scratch.`
}

// ── CLI ──────────────────────────────────────────────────────────────────────────
//   node scripts/leaf-mode.mjs mode --has-work-branch --has-open-pr
//     → prints 'start' or 'continue'
//   node scripts/leaf-mode.mjs instruction <issue> --has-work-branch --has-open-pr
//     → prints the prompt fragment for that mode
function main(argv) {
  const [cmd, ...rest] = argv
  const flags = new Set(rest.filter((a) => a.startsWith('--')))
  const hasWorkBranch = flags.has('--has-work-branch')
  const hasOpenPR = flags.has('--has-open-pr')
  if (cmd === 'mode') {
    process.stdout.write(chooseLeafMode({ hasWorkBranch, hasOpenPR }).mode)
    return
  }
  if (cmd === 'instruction') {
    const issue = rest.find((a) => !a.startsWith('--'))
    const { mode } = chooseLeafMode({ hasWorkBranch, hasOpenPR })
    process.stdout.write(leafModeInstruction(mode, { issue }))
    return
  }
  console.error('usage: node scripts/leaf-mode.mjs mode|instruction <issue> [--has-work-branch] [--has-open-pr]')
  process.exit(2)
}

import { pathToFileURL } from 'node:url'
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
}
