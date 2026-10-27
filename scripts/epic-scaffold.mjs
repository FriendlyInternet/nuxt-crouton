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
//     "packagesApproved": "optional — string, or { why, packages: [...] }: stamps every child with
//        `Packages-approved: …` and (object form) one `pkg:<name>` label per package (#2778)",
//     "children": [ { "title", "body", "labels", "blockedBy": [siblingIdx…], "needsSplit"? } ] }
//
// The epic body MUST carry a `Dedup-checked:` line — this must not become a way around the
// dedup gate (require-issue-dedup hook, #297).
//
//   node scripts/epic-scaffold.mjs [--dry-run] plan.json [--repo O/R]
//
// Running this already starts the work: every child with no `Blocked-by` gets `work-this` immediately,
// and the wave scheduler releases the rest as their blockers close. Do NOT label the epic `delegate-pi`
// afterwards — that runs the decomposer on an epic that already has children and dispatches the
// unblocked ones a second time. Use `--dry-run` to look before anything starts.

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { hasTestSteps } from './test-card.mjs'
import { parsePlan, planToActions, runActions, ghCreateIssue, PlanError } from './apply-decompose-plan.mjs'

export const NO_TEST_STEPS_MSG = 'epic body has no "## 🧪 How to test" section with steps — write 2–3 steps the owner can do on a phone'
export const DEDUP_RE = /Dedup-checked:/i

/** kebab-case a title into a branch-safe slug (max 40 chars). */
export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'epic'
}

function parseJsonObject(raw) {
  let p = raw
  if (typeof raw === 'string') {
    try { p = JSON.parse(raw) } catch (e) { throw new PlanError(`plan is not valid JSON: ${e.message}`) }
  }
  if (!p || typeof p !== 'object') throw new PlanError('plan must be an object')
  return p
}

/** Validate the scaffold plan → { title, body, labels, slug, children } (children via parsePlan). */
export function parseScaffoldPlan(raw) {
  const p = parseJsonObject(raw)
  if (typeof p.title !== 'string' || !p.title.trim()) throw new PlanError('plan.title must be a non-empty string')
  if (typeof p.body !== 'string' || !p.body.trim()) throw new PlanError('plan.body must be a non-empty string')
  if (!DEDUP_RE.test(p.body)) {
    throw new PlanError('epic body has no `Dedup-checked:` line — run the issue-dedup search first and attest it (the scaffold must not bypass the dedup gate)')
  }
  if (!hasTestSteps(p.body)) throw new PlanError(NO_TEST_STEPS_MSG)
  const children = parsePlan({
    leaf: false,
    packagesApproved: p.packagesApproved,
    children: p.children || [],
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

/**
 * Resolve main's sha WITHOUT relying on a local `origin/main` ref (absent in a shallow/single-branch
 * clone). Asked of the remote itself, so it also proves the remote is reachable — run it BEFORE
 * creating anything, so a failure here can't leave a half-made epic (#2708).
 */
export function resolveMainSha(run = exec) {
  const out = run('git', ['ls-remote', 'origin', 'refs/heads/main'])
  const sha = (out.split(/\s+/)[0] || '').trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`cannot resolve origin main (ls-remote said: ${out || 'nothing'})`)
  return sha
}

/** Create the branch at main's sha on the remote, idempotently (never a duplicate). */
function ensureBranch(branch, sha) {
  if (exec('git', ['ls-remote', '--heads', 'origin', branch])) return false
  // Fetch main explicitly so the object exists locally, then push the SHA — not `origin/main`.
  exec('git', ['fetch', 'origin', 'main'])
  exec('git', ['push', 'origin', `${sha}:refs/heads/${branch}`])
  return true
}

/** Labels the plan uses that the repo taxonomy doesn't have — an unknown one fails creation midway. */
export function unknownPlanLabels(plan, knownLabels) {
  if (!knownLabels.length) return []
  const used = [...plan.labels, ...plan.children.flatMap(c => c.labels.filter(l => l.startsWith('pkg:')))]
  return [...new Set(used)].filter(l => !knownLabels.includes(l))
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
  // PRECONDITIONS first: nothing is created until labels and the remote branch base check out.
  const missing = unknownPlanLabels(plan, knownLabels)
  if (missing.length) {
    console.error(`epic-scaffold: unknown label(s) on the epic: ${missing.join(', ')} — nothing was created`)
    process.exit(1)
  }
  let sha
  try { sha = resolveMainSha() } catch (e) {
    console.error(`epic-scaffold: ${e.message} — nothing was created`)
    process.exit(1)
  }
  const dir = process.env.RUNNER_TEMP || '/tmp'
  const bodyFile = `${dir}/epic-scaffold-body.md`
  writeFileSync(bodyFile, plan.body)
  const epic = ghCreateIssue(exec, repo, { title: plan.title, file: bodyFile, labels: plan.labels })
  const url = `https://github.com/${repo}/issues/${epic}`
  const branch = epicBranch(epic, plan.slug)
  // From here the epic EXISTS: any failure must say so and what is left, not just throw.
  let made = false
  let summary = { created: [] }
  try {
    // Branch BEFORE any child exists, so no worker can start against a missing epic branch.
    made = ensureBranch(branch, sha)
    summary = runActions(scaffoldActions(plan, { epic, knownLabels }), { repo })
  } catch (e) {
    console.error(`epic-scaffold: FAILED after creating epic #${epic} (${url}): ${e.message}`)
    console.error(`  branch ${branch}: ${made ? 'created' : 'NOT created (or already existed)'}`)
    console.error(`  children created: ${summary.created.length}/${plan.children.length} — finish the rest by hand, or close #${epic} and re-run`)
    process.exit(1)
  }
  console.log(JSON.stringify({ epic, url, branch, branchCreated: made, ...summary }, null, 2))
  if (summary.created.length !== plan.children.length) {
    console.error(`epic-scaffold: not every child was created for epic #${epic}`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2))
