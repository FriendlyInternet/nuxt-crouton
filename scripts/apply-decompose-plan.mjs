#!/usr/bin/env node
// apply-decompose-plan.mjs — WS3 redesign (#1696): pi PLANS, code APPLIES.
//
// WHY. The event-driven decomposer had pi hand-build `gh issue create` commands with rich issue
// bodies (emoji/backticks/parens) via shell heredocs. On the #1706 live run that broke exactly as
// the #1001 trap predicts — `BODY=$(cat <<'EOF' … )` → `unexpected EOF while looking for matching
// ')'`, exit 2, zero issues created — and pi then *fabricated* success under the "must produce a
// deliverable" pressure (caught red by the artifact-gate). The fix removes BOTH failure modes:
//   • pi no longer runs any `gh`/shell mutation — it only emits a PLAN (JSON: leaf-ness + child
//     specs). No fragile shell in the model's hands.
//   • a deterministic step (this file) creates/links/labels the issues via execFile array-args
//     (NO shell parsing, so no quoting bug), injecting the WS2 pipeline block itself. Because code
//     creates the issues, there is nothing for pi to fabricate — they exist or this step fails loud.
//
// THE PLAN pi writes (validated by parsePlan):
//   { "leaf": true }                                   // the target issue is a single leaf
//   { "leaf": false, "children": [                     // split into these children
//       { "title": "...", "body": "...",               // plain markdown body (no pipeline block —
//         "labels": ["type:chore","meta:agents"],      //   this step injects it)
//         "needsSplit": false }                         // false → a leaf child (work-this);
//   ] }                                                //   true → needs more decomposition (delegate-pi)
//
// The PURE core (parsePlan / planToActions / buildChildBody) is unit-tested (…test.mjs). The I/O
// (runActions → gh via execFileSync) is a thin executor injected for tests.

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { writePipelineBlock } from './pipeline-context.mjs'
import { labelForChild, MAX_CHILDREN, MAX_DEPTH, WORKER_TRIGGER } from './pipeline-loop-guard.mjs'

export class PlanError extends Error {}

/** Parse + validate the plan pi wrote. Throws PlanError on anything malformed (→ honest failure). */
export function parsePlan(raw) {
  let p
  if (typeof raw === 'string') {
    try { p = JSON.parse(raw) } catch (e) { throw new PlanError(`plan is not valid JSON: ${e.message}`) }
  } else { p = raw }
  if (!p || typeof p !== 'object') throw new PlanError('plan must be an object')
  if (typeof p.leaf !== 'boolean') throw new PlanError('plan.leaf must be a boolean')
  if (p.leaf) return { leaf: true, children: [] }
  if (!Array.isArray(p.children) || p.children.length === 0) {
    throw new PlanError('a non-leaf plan must have a non-empty children array')
  }
  if (p.children.length > MAX_CHILDREN) {
    throw new PlanError(`too many children (${p.children.length} > MAX_CHILDREN ${MAX_CHILDREN}) — slices too thin`)
  }
  const children = p.children.map((c, i) => {
    if (!c || typeof c.title !== 'string' || !c.title.trim()) throw new PlanError(`child[${i}] needs a non-empty title`)
    if (typeof c.body !== 'string' || !c.body.trim()) throw new PlanError(`child[${i}] needs a non-empty body`)
    return {
      title: c.title.trim(),
      body: c.body,
      labels: Array.isArray(c.labels) ? c.labels.filter(l => typeof l === 'string' && l) : [],
      needsSplit: !!c.needsSplit,
    }
  })
  return { leaf: false, children }
}

/** Keep only labels that actually exist in the repo taxonomy — an unknown label fails `gh issue
 *  create`, which is how pi's fabrication started. Drops (with a returned note) instead of failing. */
export function sanitizeLabels(labels = [], known = []) {
  const knownSet = new Set(known)
  const kept = [], dropped = []
  for (const l of labels) (knownSet.has(l) ? kept : dropped).push(l)
  return { kept, dropped }
}

/** The child's final body = its markdown + the WS2 pipeline block at childDepth. Pure. */
export function buildChildBody(body, { epic, childDepth, epic_branch }) {
  return writePipelineBlock(body, { epic, depth: childDepth, epic_branch })
}

/**
 * PURE: given a validated plan + context + the repo's known labels, produce the ordered list of
 * gh operations to perform. Deterministic and fully unit-testable; runActions executes it.
 *   ctx = { target, epic, depth, epic_branch, knownLabels }
 * childDepth = depth + 1. The depth cap (labelForChild) forces `work-this` at MAX_DEPTH so a
 * delegate-pi chain always terminates.
 */
export function planToActions(plan, ctx) {
  const { target, epic, depth = 0, epic_branch, knownLabels = [] } = ctx
  const childDepth = (Number.isFinite(depth) ? depth : 0) + 1
  const actions = []
  if (plan.leaf) {
    // The target itself is the leaf: stamp the block at ITS depth, then label it work-this.
    actions.push({ type: 'edit-body', issue: target, ctx: { epic, depth, epic_branch } })
    actions.push({ type: 'add-label', issue: target, label: WORKER_TRIGGER })
    return actions
  }
  plan.children.forEach((c, i) => {
    const ref = `child${i}`
    const { kept, dropped } = sanitizeLabels(c.labels, knownLabels)
    actions.push({
      type: 'create', ref,
      title: c.title,
      body: buildChildBody(c.body, { epic, childDepth, epic_branch }),
      labels: kept, droppedLabels: dropped,
    })
    actions.push({ type: 'link', parent: target, ref })
    actions.push({ type: 'trigger-label', ref, label: labelForChild({ depth: childDepth, isLeaf: !c.needsSplit, maxDepth: MAX_DEPTH }) })
  })
  return actions
}

// ── I/O executor ──────────────────────────────────────────────────────────────────
// Every gh call uses execFile ARRAY ARGS — the shell never parses the body, so the #1001
// heredoc/quoting failure is structurally impossible. `exec` is injected so tests can assert the
// call sequence without the network.
function realExec(file, args, input) {
  return execFileSync(file, args, { input, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 }).trim()
}

/**
 * Execute the action list. Returns a summary of what was created/labelled. `exec` is injectable.
 * One small handler per action type (a dispatch table) — each closes over the shared run state.
 */
export function runActions(actions, { repo, exec = realExec, log = console.error, writeBody = defaultWriteBody } = {}) {
  const state = { repo, exec, writeBody, log, refToNumber: {}, created: [], labelled: [] }
  for (const a of actions) {
    const handler = ACTION_HANDLERS[a.type]
    if (!handler) throw new Error(`unknown action type: ${a.type}`)
    handler(a, state)
  }
  return { created: state.created, labelled: state.labelled }
}

const ACTION_HANDLERS = {
  // A leaf: stamp the WS2 block onto the target's CURRENT body (merge, don't clobber prose).
  'edit-body'(a, { repo, exec, writeBody }) {
    const cur = exec('gh', ['issue', 'view', String(a.issue), '--repo', repo, '--json', 'body', '-q', '.body'])
    const f = writeBody(`edit-${a.issue}`, writePipelineBlock(cur, a.ctx))
    exec('gh', ['issue', 'edit', String(a.issue), '--repo', repo, '--body-file', f])
  },
  'add-label'(a, { repo, exec, labelled }) {
    exec('gh', ['issue', 'edit', String(a.issue), '--repo', repo, '--add-label', a.label])
    labelled.push({ issue: a.issue, label: a.label })
  },
  'create'(a, { repo, exec, writeBody, log, refToNumber, created }) {
    if (a.droppedLabels?.length) log(`⚠️  dropped unknown labels on "${a.title}": ${a.droppedLabels.join(', ')}`)
    const f = writeBody(a.ref, a.body)
    const args = ['issue', 'create', '--repo', repo, '--title', a.title, '--body-file', f]
    for (const l of a.labels) args.push('--label', l)
    const url = exec('gh', args)
    const num = Number((url.match(/\/issues\/(\d+)/) || [])[1])
    if (!Number.isFinite(num)) throw new Error(`could not parse issue number from create output: ${url}`)
    refToNumber[a.ref] = num
    created.push({ ref: a.ref, number: num, title: a.title })
  },
  'link'(a, { repo, exec, refToNumber }) {
    const child = refToNumber[a.ref]
    const restId = exec('gh', ['api', `repos/${repo}/issues/${child}`, '-q', '.id'])
    exec('gh', ['api', '--method', 'POST', `repos/${repo}/issues/${a.parent}/sub_issues`, '-F', `sub_issue_id=${restId}`])
  },
  'trigger-label'(a, { repo, exec, refToNumber, labelled }) {
    const child = refToNumber[a.ref]
    exec('gh', ['issue', 'edit', String(child), '--repo', repo, '--add-label', a.label])
    labelled.push({ issue: child, label: a.label })
  },
}

let _tmpDir = process.env.RUNNER_TEMP || '/tmp'
function defaultWriteBody(tag, body) {
  const f = `${_tmpDir}/decompose-body-${tag}.md`
  writeFileSync(f, body)
  return f
}

// ── CLI: node scripts/apply-decompose-plan.mjs apply <plan.json> --repo O/R --target N \
//                                                --epic N --epic-branch B --depth D ──────────
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i]
    else out._.push(a)
  }
  return out
}

function knownLabelsFromFile(path = '.github/labels.yml') {
  try {
    const txt = readFileSync(path, 'utf8')
    return [...txt.matchAll(/^-\s*name:\s*["']?([^"'\n]+)["']?\s*$/gim)].map(m => m[1].trim())
  } catch { return [] }
}

function main(argv) {
  const args = parseArgs(argv)
  if (args._[0] !== 'apply' || !args._[1]) {
    console.error('usage: node scripts/apply-decompose-plan.mjs apply <plan.json> --repo O/R --target N [--epic N --epic-branch B --depth D]')
    process.exit(2)
  }
  const plan = parsePlan(readFileSync(args._[1], 'utf8'))
  const target = Number(args.target)
  const ctx = {
    target,
    epic: Number(args.epic || target),
    depth: args.depth != null ? Number(args.depth) : 0,
    epic_branch: args['epic-branch'] || '',
    knownLabels: knownLabelsFromFile(),
  }
  const actions = planToActions(plan, ctx)
  const summary = runActions(actions, { repo: args.repo })
  console.log(JSON.stringify(summary, null, 2))
  if (!plan.leaf && summary.created.length === 0) {
    console.error('apply produced no children — failing so the artifact-gate stays honest')
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
}
