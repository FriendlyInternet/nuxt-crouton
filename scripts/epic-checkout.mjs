#!/usr/bin/env node
// epic-checkout.mjs — a READ-ONLY second checkout of an epic's branch, next to main (#3846).
//
// WHY. A rolling epic's tickets are written and reviewed just before they are built, so their
// file/line claims must be graded against the EPIC BRANCH (where earlier steps landed), not main.
// But the harness itself — scripts, prompts, model resolution, gates — must keep running from main:
// checking the job out at an older epic branch runs older harness code (the #3618 hazard). So the
// epic branch goes into a separate, detached `git worktree` under $RUNNER_TEMP; the main worktree's
// HEAD and branch are never touched (no `checkout`/`switch` here), and nothing under the workspace
// changes, so a later artifact commit can't pick it up.
//
//   node scripts/epic-checkout.mjs --epic <issue> --dest "$RUNNER_TEMP/epic-src" [--repo O/R]
//     → prints <dest> on stdout when the epic has a branch, or NOTHING (a brand-new epic: main IS its
//       code; the reader then uses the main checkout). Never fails the job: any error → a warning on
//       stderr and nothing on stdout.
// The issue may be the epic or one of its tickets: its pipeline block's `epic_branch` wins, else
// the first `refs/heads/epic/<epic>-*` head (also `epic/<n>--v1-*`), where <epic> is the block's
// `epic=` or the issue itself — the same rule as decompose-on-issue-pidev.yml's context step.
import { execFileSync } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parsePipelineBlock } from './pipeline-context.mjs'

/**
 * PURE. Which branch holds this epic's code? → a branch name, or '' when it has none yet.
 *   body  = the issue body (its pipeline block) · heads = `git ls-remote --heads` lines or ref names
 *   epic  = the issue number (used when the block names no epic)
 */
export function resolveEpicBranch({ body = '', heads = [], epic } = {}) {
  const block = parsePipelineBlock(body || '')
  if (block.epic_branch && block.epic_branch.startsWith('epic/')) return block.epic_branch
  const n = block.epic ?? Number(epic)
  if (!Number.isInteger(n) || n <= 0) return ''
  const prefix = `epic/${n}-`
  for (const h of heads || []) {
    const ref = String(h).trim().split(/\s+/).pop().replace(/^refs\/heads\//, '')
    if (ref.startsWith(prefix)) return ref
  }
  return ''
}

/** The dest must sit outside the workspace (under $RUNNER_TEMP when set). */
export function assertDestOutside(dest, { cwd = process.cwd(), runnerTemp = process.env.RUNNER_TEMP } = {}) {
  const d = resolve(dest)
  const ws = resolve(cwd)
  if (d === ws || d.startsWith(ws + sep)) throw new Error(`--dest ${dest} is inside the workspace — use $RUNNER_TEMP`)
  if (runnerTemp && !(d === resolve(runnerTemp) || d.startsWith(resolve(runnerTemp) + sep))) throw new Error(`--dest ${dest} is not under $RUNNER_TEMP`)
  return d
}

/**
 * I/O. Fetch `branch` (depth 1) and add it as a DETACHED worktree at `dest`. Returns dest, or ''
 * when there is no branch. `git` = (args) => stdout, injected for tests. Never checks out in the
 * main worktree.
 */
export function addEpicWorktree({ branch, dest, git }) {
  if (!branch) return ''
  git(['fetch', 'origin', branch, '--depth=1'])
  git(['worktree', 'add', '--detach', dest, 'FETCH_HEAD'])
  return dest
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] || '' : ''
}

function main(argv) {
  const epic = arg(argv, 'epic')
  const dest = arg(argv, 'dest')
  const repo = arg(argv, 'repo') || process.env.GITHUB_REPOSITORY || ''
  if (!epic || !dest) { console.error('usage: epic-checkout.mjs --epic <issue> --dest <dir under $RUNNER_TEMP> [--repo O/R]'); process.exit(2) }
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const out = assertDestOutside(dest)
    let body = ''
    try {
      body = execFileSync('gh', ['api', `repos/${repo}/issues/${epic}`, '-q', '.body'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) { console.error(`::warning::epic-checkout: could not read #${epic} (${e.message.split('\n')[0]}) — matching the branch by name`) }
    const block = parsePipelineBlock(body)
    const n = block.epic ?? Number(epic)
    const heads = git(['ls-remote', '--heads', 'origin', `epic/${n}-*`]).split('\n').filter(Boolean)
    const branch = resolveEpicBranch({ body, heads, epic })
    const got = addEpicWorktree({ branch, dest: out, git })
    if (got) { console.error(`epic-checkout: ${branch} → ${got} (read-only; harness stays on main)`); console.log(got) }
    else console.error(`epic-checkout: #${epic} has no epic branch yet — readers use the main checkout`)
  } catch (e) {
    console.error(`::warning::epic-checkout failed (${String(e.message).split('\n')[0]}) — readers use the main checkout`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2))
