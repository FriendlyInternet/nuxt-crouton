#!/usr/bin/env node
// epic-scaffold.mjs — one command makes an epic pipeline-ready (#2429, WS7 of #2108).
//
// WHY. A hand-prepared epic needs five facts nobody wrote down: the hidden
// `<!-- pipeline: epic=N depth=1 epic_branch=… -->` block on each child, `Blocked-by: #NN`
// ordering, a `pkg:*` label (or `Packages-approved:` line) so packages-guard accepts the worker's
// PR, and the `epic/<N>-<slug>` branch existing before the first worker runs. This script takes
// ONE plan and emits the whole tree. It reuses apply-decompose-plan.mjs (parsePlan / planToActions
// / runActions) — the decomposer-side half — rather than re-implementing child creation.
//
// THE PLAN (JSON):
//   { "title": "...", "body": "... Dedup-checked: ...", "labels": ["epic","pkg:x"],
//     "slug": "optional-branch-slug",
//     "packagesApproved": "optional — appended to every child as `Packages-approved: …`",
//     "children": [ { "title", "body", "labels", "blockedBy": [siblingIdx…], "needsSplit"? } ] }
//
// The epic body MUST carry a `Dedup-checked:` line — this must not become a way around the
// dedup gate (require-issue-dedup hook, #297).
//
//   node scripts/epic-scaffold.mjs [--dry-run] plan.json [--repo O/R]
//
// Then label the epic `delegate-pi` to start the decomposer/scheduler (deliberately NOT done here).

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parsePlan, planToActions, runActions, PlanError } from './apply-decompose-plan.mjs'

export const DEDUP_RE = /Dedup-checked:/i

/** kebab-case a title into a branch-safe slug (max 40 chars). */
export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'epic'
}

/** Validate the scaffold plan → { title, body, labels, slug, children } (children via parsePlan). */
export function parseScaffoldPlan(raw) {
  let p
  if (typeof raw === 'string') {
    try { p = JSON.parse(raw) } catch (e) { throw new PlanError(`plan is not valid JSON: ${e.message}`) }
  } else { p = raw }
  if (!p || typeof p !== 'object') throw new PlanError('plan must be an object')
  if (typeof p.title !== 'string' || !p.title.trim()) throw new PlanError('plan.title must be a non-empty string')
  if (typeof p.body !== 'string' || !p.body.trim()) throw new PlanError('plan.body must be a non-empty string')
  if (!DEDUP_RE.test(p.body)) {
    throw new PlanError('epic body has no `Dedup-checked:` line — run the issue-dedup search first and attest it (the scaffold must not bypass the dedup gate)')
  }
  const approved = typeof p.packagesApproved === 'string' && p.packagesApproved.trim() ? p.packagesApproved.trim() : null
  const children = parsePlan({
    leaf: false,
    children: (p.children || []).map(c => ({
      ...c,
      body: approved && typeof c?.body === 'string' && !/^\s*Packages-approved:/im.test(c.body)
        ? `${c.body.trimEnd()}\n\nPackages-approved: ${approved}\n`
        : c?.body,
    })),
  }).children
  const labels = Array.isArray(p.labels) ? p.labels.filter(l => typeof l === 'string' && l) : []
  if (!labels.includes('epic')) labels.unshift('epic')
  return { title: p.title.trim(), body: p.body, labels, slug: slugify(p.slug || p.title), children }
}

/** PURE: the branch name for an epic number. */
export const epicBranch = (n, slug) => `epic/${n}-${slug}`

/** PURE: child gh actions for an already-numbered epic (depth 0 → children at depth 1). */
export function scaffoldActions(plan, { epic, knownLabels = [] }) {
  return planToActions(
    { leaf: false, children: plan.children },
    { target: epic, epic, depth: 0, epic_branch: epicBranch(epic, plan.slug), knownLabels },
  )
}

/** Human-readable tree for --dry-run. Pure. */
export function renderTree(plan, actions, epic = 'N') {
  const lines = [`epic #${epic}: ${plan.title}  [${plan.labels.join(', ')}]`, `  branch: ${epicBranch(epic, plan.slug)} (from origin/main)`]
  plan.children.forEach((c, i) => {
    const create = actions.find(a => a.type === 'create' && a.ref === `child${i}`)
    const deps = c.blockedBy.length ? `  Blocked-by: ${c.blockedBy.map(d => `child${d}`).join(', ')}` : '  (dispatched immediately)'
    lines.push(`  child${i}: ${c.title}  [${(create?.labels || c.labels).join(', ')}]`, `   ${deps.trim()}`)
    const block = (create?.body || '').match(/<!--\s*pipeline:[^>]*-->/)
    if (block) lines.push(`   ${block[0]}`)
  })
  return lines.join('\n')
}

function exec(file, args, input) {
  return execFileSync(file, args, { input, encoding: 'utf8' }).trim()
}

function knownLabelsFromFile(path = '.github/labels.yml') {
  try {
    return [...readFileSync(path, 'utf8').matchAll(/^-\s*name:\s*["']?([^"'\n]+)["']?\s*$/gim)].map(m => m[1].trim())
  } catch { return [] }
}

/** Create the branch from origin/main on the remote, idempotently (never a duplicate). */
function ensureBranch(branch) {
  if (exec('git', ['ls-remote', '--heads', 'origin', branch])) return false
  exec('git', ['fetch', 'origin', 'main'])
  exec('git', ['push', 'origin', `origin/main:refs/heads/${branch}`])
  return true
}

function main(argv) {
  const dry = argv.includes('--dry-run')
  const ri = argv.indexOf('--repo')
  const repo = ri >= 0 ? argv[ri + 1] : (process.env.GITHUB_REPOSITORY || 'FriendlyInternet/nuxt-crouton')
  const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--repo')
  if (!file) {
    console.error('usage: node scripts/epic-scaffold.mjs [--dry-run] <plan.json> [--repo O/R]')
    process.exit(2)
  }
  let plan
  try { plan = parseScaffoldPlan(readFileSync(file, 'utf8')) } catch (e) {
    console.error(`epic-scaffold: ${e.message}`)
    process.exit(1)
  }
  const knownLabels = knownLabelsFromFile()
  if (dry) {
    console.log(renderTree(plan, scaffoldActions(plan, { epic: 'N', knownLabels })))
    return
  }
  const url = exec('gh', ['issue', 'create', '--repo', repo, '--title', plan.title, '--body-file', '-', ...plan.labels.flatMap(l => ['--label', l])], plan.body)
  const epic = Number((url.match(/\/issues\/(\d+)/) || [])[1])
  if (!Number.isFinite(epic)) throw new Error(`could not parse epic number from: ${url}`)
  const branch = epicBranch(epic, plan.slug)
  // Branch BEFORE any child exists, so no worker can start against a missing epic branch.
  const made = ensureBranch(branch)
  const summary = runActions(scaffoldActions(plan, { epic, knownLabels }), { repo })
  console.log(JSON.stringify({ epic, url, branch, branchCreated: made, ...summary }, null, 2))
  if (summary.created.length !== plan.children.length) {
    console.error('epic-scaffold: not every child was created')
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2))
