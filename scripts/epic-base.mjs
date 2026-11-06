#!/usr/bin/env node
// epic-base.mjs — #3504: which epic branch should a worker's PR target?
//
// The ticket's hidden pipeline block is the explicit answer (the decomposer writes it). A ticket
// attached to an epic by hand has no block, so fall back to GitHub's own parent link: the nearest
// OPEN ancestor that has an `epic/<n>-*` branch. Explicit beats inferred; closed epics and
// epics without a branch never count.
//
//   node scripts/epic-base.mjs <issue> < body.txt
//     prints  epic_branch=…  epic=…  source=…   (stdout, for $GITHUB_OUTPUT-style parsing)
//     and a human log line on stderr.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parsePipelineBlock } from './pipeline-context.mjs'

const MAX_DEPTH = 5

/**
 * Pure decision. `ancestors` is nearest-first: [{ number, state, branch }].
 * Returns { epic_branch, epic, source, log }. epic_branch '' means main.
 */
export function chooseEpicBase({ block = {}, ancestors = [], readError = '' } = {}) {
  if (block.base === 'main') {
    return { epic_branch: '', epic: block.epic ?? null, source: 'block-main', log: 'ticket pins base=main' }
  }
  if (block.epic_branch) {
    return { epic_branch: block.epic_branch, epic: block.epic ?? null, source: 'block', log: 'from ticket block' }
  }
  const hit = ancestors.find((a) => a && a.state === 'open' && a.branch)
  if (hit) {
    return { epic_branch: hit.branch, epic: hit.number, source: 'parent', log: `from open parent epic #${hit.number}` }
  }
  if (readError) {
    return { epic_branch: '', epic: block.epic ?? null, source: 'parent-read-failed', log: `parent read failed: ${readError}` }
  }
  return { epic_branch: '', epic: block.epic ?? null, source: 'none', log: 'no open parent epic with a branch' }
}

function gh(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
}

const errLine = (e) => `${e.stderr || e.message || e}`.trim().split('\n')[0]

/** One hop up: { parent } | { top: true } (no parent) | { readError }. */
function readParent(api, repo, cur) {
  try {
    return { parent: api(`repos/${repo}/issues/${cur}/parent`) }
  } catch (e) {
    const msg = `${e.stderr || e.message || e}`
    if (/HTTP 404|No parent issue found/i.test(msg)) return { top: true } // top of the tree
    return { readError: errLine(e) }
  }
}

/** The `epic/<n>-*` branch of an open parent: { branch } | { readError }. */
function readEpicBranch(api, repo, number) {
  try {
    const refs = api(`repos/${repo}/git/matching-refs/heads/epic/${number}-`)
    return { branch: refs?.[0]?.ref?.replace(/^refs\/heads\//, '') || '' }
  } catch (e) {
    return { readError: errLine(e) }
  }
}

/** Walk up GitHub's parent links; stop at the first open ancestor with a branch. */
export function walkAncestors(issue, repo, api = gh) {
  const ancestors = []
  if (!repo) return { ancestors, readError: 'repo not set (GITHUB_REPOSITORY empty)' }
  let cur = issue
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hop = readParent(api, repo, cur)
    if (hop.readError) return { ancestors, readError: hop.readError }
    const parent = hop.parent
    if (hop.top || !parent || !parent.number) break
    const state = `${parent.state || ''}`.toLowerCase()
    let branch = ''
    if (state === 'open') {
      const r = readEpicBranch(api, repo, parent.number)
      if (r.readError) return { ancestors, readError: r.readError }
      branch = r.branch
    }
    ancestors.push({ number: parent.number, state, branch })
    if (state === 'open' && branch) break
    cur = parent.number
  }
  return { ancestors, readError: '' }
}

function main(argv) {
  const issue = argv[0]
  if (!issue) {
    console.error('usage: node scripts/epic-base.mjs <issue> < body.txt')
    process.exit(2)
  }
  let body = ''
  try { body = readFileSync(0, 'utf8') } catch { /* empty */ }
  const block = parsePipelineBlock(body)
  let ancestors = []
  let readError = ''
  if (!block.base && !block.epic_branch) {
    ;({ ancestors, readError } = walkAncestors(issue, process.env.GITHUB_REPOSITORY || ''))
  }
  const r = chooseEpicBase({ block, ancestors, readError })
  console.error(`epic-base: #${issue} → '${r.epic_branch || 'main'}' (${r.source}: ${r.log})`)
  process.stdout.write(`epic_branch=${r.epic_branch}\nepic=${r.epic ?? ''}\nsource=${r.source}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
}
