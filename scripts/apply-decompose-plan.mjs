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
//         "needsSplit": false,                          // false → a leaf child (work-this);
//         "blockedBy": [0] }                            //   true → needs more decomposition (delegate-pi)
//   ] }                                                // blockedBy = sibling INDICES this child waits on
//   { "leaf": false, "steps": [ { "title", "goal", "proves", "blockedBy": [stepIdx], "needsSplit" }, … ],
//     "children": [ { …one child…, "step": 0 } ] }    // ROLLING split (#3846): the step list + ONLY
//                                                      //   step 0's ticket; later tickets are written by hand
//
// ORDERING (#1750). `blockedBy` is how the decomposer expresses that one leaf cannot start until
// another lands. A blocked child is created and linked like any other but gets NO trigger label —
// the EXISTING wave scheduler (schedule-waves.yml → wave-gate.mjs, #283) releases it when its
// last blocker closes. Omit it and children fan out
// in parallel, which stays correct for genuinely independent work. Indices, not issue numbers:
// the children do not exist when the plan is written.
//
// The PURE core (parsePlan / planToActions / buildChildBody) is unit-tested (…test.mjs). The I/O
// (runActions → gh via execFileSync) is a thin executor injected for tests.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { classifyHandoffError } from './lib/handoff.mjs'
import { writePipelineBlock } from './pipeline-context.mjs'
import { shouldReview, APPROVED_LABEL } from './lib/ticket-verdict.mjs'
import { SIGNOFF_MARKER, HOLD_HEADING, signoffRoute } from './lib/signoff-route.mjs'
import { diagramEditUrl, DIAGRAM_BRANCH } from './lib/diagram-edit-link.mjs'
import { saveDiagramScene } from './lib/diagram-branch.mjs'
import { labelForChild, MAX_CHILDREN, MAX_DEPTH, WORKER_TRIGGER } from './pipeline-loop-guard.mjs'
import { PlanError, normalizeBlockedBy, assertNoDependencyCycle, normalizeSteps, renderSteps, stepsComment, ROLLING_LABEL } from './lib/epic-steps.mjs'

// PlanError + the blockedBy checks live in lib/epic-steps.mjs (#3846) so the step list is validated
// by the same code; re-exported so existing imports keep working.
export { PlanError }

/** Parse + validate the plan pi wrote. Throws PlanError on anything malformed (→ honest failure). */
// fallow-ignore-next-line complexity -- unchanged by #2776; the import added above shifted its line, so fallow's position-based attribution now charges this inherited finding to the PR
export function parsePlan(raw) {
  let p
  if (typeof raw === 'string') {
    try { p = JSON.parse(raw) } catch (e) { throw new PlanError(`plan is not valid JSON: ${e.message}`) }
  } else { p = raw }
  if (!p || typeof p !== 'object') throw new PlanError('plan must be an object')
  // Design sign-off hold (#1821, Option C). When an epic has genuine design ambiguity, the
  // decomposer must NOT spawn "decide & sign off" worker children (they deadlock the code worker,
  // which has no render/hold tool). Instead it proposes the design and HOLDS on the epic: we render
  // the artifacts (schema table / diagram / UI mockup) and post them + status:blocked, then the
  // existing lgtm→resume-on-comment loop continues the decomposition into build children.
  if (p.signoff && typeof p.signoff === 'object') {
    const s = p.signoff
    if (typeof s.summary !== 'string' || !s.summary.trim()) throw new PlanError('signoff.summary must be a non-empty string')
    if (!Array.isArray(s.questions) || s.questions.length === 0) throw new PlanError('signoff.questions must be a non-empty array (the forks to decide)')
    const questions = s.questions.filter(q => typeof q === 'string' && q.trim()).map(q => q.trim())
    if (!questions.length) throw new PlanError('signoff.questions must contain at least one non-empty question')
    return {
      signoff: {
        summary: s.summary.trim(),
        questions,
        // Optional rendered artifacts — best-effort; a bad one is skipped, the questions always post.
        schema: (s.schema && typeof s.schema === 'object' && s.schema.fields) ? { collection: String(s.schema.collection || 'collection'), fields: s.schema.fields } : null,
        diagram: (s.diagram && typeof s.diagram === 'object') ? s.diagram : null,
        ui: (typeof s.ui === 'string' && s.ui.trim()) ? s.ui : null,
      },
    }
  }
  if (typeof p.leaf !== 'boolean') throw new PlanError('plan.leaf must be a boolean, or provide a `signoff` object')
  // #3846 (owner decision 2026-11-12 12:54): no step-list-only rewrite run. A wrong step list holds
  // the epic and the orchestrator fixes the step-list comment by hand.
  if (p.step === 'replan') throw new PlanError('step=replan is not supported (#3846): fix the step list by hand')
  if (p.leaf) return { leaf: true, children: [] }
  if (!Array.isArray(p.children) || p.children.length === 0) {
    throw new PlanError('a non-leaf plan must have a non-empty children array')
  }
  if (p.children.length > MAX_CHILDREN) {
    throw new PlanError(`too many children (${p.children.length} > MAX_CHILDREN ${MAX_CHILDREN}) — slices too thin`)
  }
  const approved = normalizePackagesApproved(p.packagesApproved)
  const children = p.children.map((c, i) => {
    if (!c || typeof c.title !== 'string' || !c.title.trim()) throw new PlanError(`child[${i}] needs a non-empty title`)
    if (typeof c.body !== 'string' || !c.body.trim()) throw new PlanError(`child[${i}] needs a non-empty body`)
    return {
      title: c.title.trim(),
      body: withPackagesApproved(c.body, approved),
      labels: withPackageLabels(Array.isArray(c.labels) ? c.labels.filter(l => typeof l === 'string' && l) : [], approved),
      approvedPkgLabels: approved ? approved.labels : [],
      needsSplit: !!c.needsSplit,
      // ORDERING (#1750): sibling INDICES this child depends on. Indices, not issue numbers —
      // at plan time the children do not exist yet, so there is nothing to reference but position.
      blockedBy: normalizeBlockedBy(c.blockedBy, i, p.children.length),
    }
  })
  assertNoDependencyCycle(children)
  if (p.steps !== undefined) return rollingPlan(p, children)
  return { leaf: false, children }
}

/**
 * ROLLING split (#3846): the step list plus ONLY step 0's ticket. Later tickets are written by hand
 * just before they are built, so they can be graded against the epic branch as it is then.
 */
function rollingPlan(p, children) {
  const steps = normalizeSteps(p.steps)
  if (children.length !== 1 || p.children[0].step !== 0) throw new PlanError('a rolling plan (with `steps`) has exactly one child: step 0\'s ticket, with "step": 0')
  if (steps[0].blockedBy.length) throw new PlanError('step 0 cannot wait on another step')
  return { leaf: false, rolling: true, steps, children: [{ ...children[0], blockedBy: [], step: 0 }] }
}

/**
 * The approved-packages list (#2778): the issue's `pkg:*` labels ARE the machine-readable scope the
 * worker, fix-bot and packages-guard read. A plan states it once as `packagesApproved` — either a bare
 * string (legacy: the `Packages-approved:` reason only) or `{ why, packages: ['crouton-assets', …] }`.
 * → { why, labels } | null. Package names may be given with or without the `pkg:` prefix.
 */
export function normalizePackagesApproved(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw === 'string') return raw.trim() ? { why: raw.trim(), labels: [] } : null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new PlanError('packagesApproved must be a string or { why, packages }')
  const why = typeof raw.why === 'string' ? raw.why.trim() : ''
  if (!why) throw new PlanError('packagesApproved.why must be a non-empty string (the `Packages-approved:` reason)')
  if (!Array.isArray(raw.packages) || raw.packages.length === 0) throw new PlanError('packagesApproved.packages must be a non-empty array of package names')
  const labels = [...new Set(raw.packages.map((n) => {
    if (typeof n !== 'string' || !n.trim()) throw new PlanError('packagesApproved.packages entries must be non-empty strings')
    const name = n.trim().replace(/^pkg:/, '')
    return `pkg:${name}`
  }))]
  return { why, labels }
}

/** Append `Packages-approved: <why>` to a body unless it already carries one. */
export function withPackagesApproved(body, approved) {
  if (!approved || typeof body !== 'string' || /^\s*Packages-approved:/im.test(body)) return body
  return `${body.trimEnd()}\n\nPackages-approved: ${approved.why}\n`
}

/** Add one `pkg:*` label per approved package (de-duped). */
export function withPackageLabels(labels, approved) {
  return approved ? [...new Set([...labels, ...approved.labels])] : labels
}

// normalizeBlockedBy / assertNoDependencyCycle (#1750): moved to lib/epic-steps.mjs (#3846). A cycle
// would deadlock the whole tree, so it fails LOUD at plan time — an honest parse failure is
// recoverable, a silent stall is not.

/** Keep only labels that actually exist in the repo taxonomy — an unknown label fails `gh issue
 *  create`, which is how pi's fabrication started. Drops (with a returned note) instead of failing. */
export function sanitizeLabels(labels = [], known = []) {
  const knownSet = new Set(known)
  const kept = [], dropped = []
  for (const l of labels) (knownSet.has(l) ? kept : dropped).push(l)
  return { kept, dropped }
}

/**
 * The `Blocked-by:` line — the on-issue record of an inter-sibling dependency (#1750).
 *
 * This is NOT a new convention: `schedule-waves.yml` has released dependent waves off this exact
 * line since #283, and `wave-gate.mjs`'s `parseBlockers` is its reader. The gap was only that the
 * DECOMPOSER never emitted it — a human hand-wrote the edges (as on the #1713 tree) or they did
 * not exist. So we write the shape the existing scheduler already consumes; `parseBlockedBy` here
 * exists to round-trip-test our own writer, not to become a second parser.
 */
export function formatBlockedBy(numbers) {
  return `Blocked-by: ${numbers.map(n => `#${n}`).join(', ')}`
}

/** Pull every issue number off a body's `Blocked-by:` lines. Tolerant of case/spacing/multiples. */
export function parseBlockedBy(body = '') {
  const out = new Set()
  for (const m of String(body).matchAll(/^\s*blocked[-\s]?by\s*:(.+)$/gim)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out.add(Number(n[1]))
  }
  return [...out].sort((a, b) => a - b)
}

/** The child's final body = its markdown + the WS2 pipeline block at childDepth. Pure. */
export function buildChildBody(body, { epic, childDepth, epic_branch, dispatch = null, step = null }) {
  return writePipelineBlock(body, { epic, depth: childDepth, epic_branch, dispatch, step })
}

/**
 * PURE: given a validated plan + context + the repo's known labels, produce the ordered list of
 * gh operations to perform. Deterministic and fully unit-testable; runActions executes it.
 *   ctx = { target, epic, depth, epic_branch, knownLabels }
 * childDepth = depth + 1. The depth cap (labelForChild) forces `work-this` at MAX_DEPTH so a
 * delegate-pi chain always terminates.
 */
export function planToActions(plan, ctx) {
  const { target, epic, depth = 0, epic_branch, knownLabels = [], reviewTickets = false } = ctx
  const childDepth = (Number.isFinite(depth) ? depth : 0) + 1
  const actions = []
  if (plan.signoff) {
    // Hold on the epic (target) for a design sign-off — no children are created (#1821).
    return [{ type: 'signoff-hold', issue: target, epic_branch, signoff: plan.signoff }]
  }
  if (plan.leaf) {
    // The target itself is the leaf: stamp the block at ITS depth, then label it work-this.
    actions.push({ type: 'edit-body', issue: target, ctx: { epic, depth, epic_branch } })
    actions.push({ type: 'add-label', issue: target, label: WORKER_TRIGGER })
    return actions
  }
  // The target is being SPLIT, so it IS an epic — say so on the label (#2501). Every child got its
  // labels here; the parent never did, so `/close-epic` (gated on `epic`, #856), the ready-to-close
  // labeller (#763) and the digests all skipped pipeline-built epics. #2413: two `/close-epic`
  // comments did nothing until the label was added by hand. `ensure-label`, not `add-label`:
  // this must not force a fresh `labeled` event (that remove-then-add is for trigger labels).
  actions.push({ type: 'ensure-label', issue: target, label: 'epic' })
  if (plan.rolling) return rollingActions(plan, { target, epic, childDepth, epic_branch, knownLabels }, actions)
  // ORDERING (#1750). Two passes, and the split matters: a `Blocked-by: #N` line can only be
  // written once N exists, so EVERY child must be created before ANY dependency is recorded or
  // any worker dispatched. The old interleaved create→link→label loop dispatched child 0's worker
  // while child 1 was still uncreated — which is how three workers for one package started within
  // five seconds, two of them against preconditions that did not exist yet.
  plan.children.forEach((c, i) => {
    const { kept, dropped } = sanitizeLabels(c.labels, knownLabels)
    // An approved package whose label is missing would be silently dropped — and the fix-bot would
    // then ask the owner again (#2778). Fail loudly instead.
    const lostPkg = dropped.filter(l => (c.approvedPkgLabels || []).includes(l))
    if (lostPkg.length) throw new PlanError(`child "${c.title}": unknown package label(s) ${lostPkg.join(', ')} — add to .github/labels.yml`)
    // The trigger label this child WOULD get if it were not blocked. For an unblocked child it is
    // applied directly below; for a blocked one it is recorded on the pipeline block (#1923) so the
    // wave scheduler can release it with the right label instead of falling back to `delegate` and
    // spending a decompose run re-deriving a classification we already made here.
    const dispatch = labelForChild({ depth: childDepth, isLeaf: !c.needsSplit, maxDepth: MAX_DEPTH })
    const isBlocked = (c.blockedBy || []).length > 0
    actions.push({
      type: 'create', ref: `child${i}`,
      title: c.title,
      body: buildChildBody(c.body, { epic, childDepth, epic_branch, dispatch: isBlocked || reviewTickets ? dispatch : null }),
      labels: kept, droppedLabels: dropped,
    })
    actions.push({ type: 'link', parent: target, ref: `child${i}` })
  })
  // Pass 2: record dependencies, then dispatch ONLY the children with none. A blocked child gets
  // no trigger label at all — the wave scheduler releases it when its last blocker closes. That
  // is the whole point: an unbuildable leaf should never consume a pi run (and its subscription quota).
  plan.children.forEach((c, i) => {
    const deps = c.blockedBy || []
    if (deps.length) {
      actions.push({ type: 'note-blocked', ref: `child${i}`, blockedByRefs: deps.map(d => `child${d}`) })
    }
  })
  // TICKET REVIEW (#2776): an unreviewed epic starts nothing. The unblocked children keep their
  // recorded `dispatch=` and wait; ticket-review.yml releases them once the tickets are approved.
  // A ROLLING split (#3846, rollingActions below) creates only step 0's ticket, posts the step list
  // and asks for ONE plan review (`subject=plan`); later tickets are written by hand and reviewed alone.
  if (reviewTickets) {
    actions.push({ type: 'request-ticket-review', epic: target })
    return actions
  }
  plan.children.forEach((c, i) => {
    if ((c.blockedBy || []).length) return
    actions.push({ type: 'trigger-label', ref: `child${i}`, label: labelForChild({ depth: childDepth, isLeaf: !c.needsSplit, maxDepth: MAX_DEPTH }) })
  })
  // NB the label in `dispatch=` (recorded above) and the one applied here are the SAME expression —
  // a blocked child must be released with exactly what it would have been dispatched with.
  return actions
}

/**
 * PURE. The rolling split's actions (#3846): label the epic `tickets:rolling`, create + link ONLY step
 * 0's ticket (its `dispatch=` recorded, `step=0` in its block, NO trigger label), post the step list
 * with that ticket's number, then ask for one plan review. Nothing starts until the review says go.
 */
function rollingActions(plan, { target, epic, childDepth, epic_branch, knownLabels }, actions) {
  actions.push({ type: 'ensure-label', issue: target, label: ROLLING_LABEL })
  const c = plan.children[0]
  const { kept, dropped } = sanitizeLabels(c.labels, knownLabels)
  const lostPkg = dropped.filter(l => (c.approvedPkgLabels || []).includes(l))
  if (lostPkg.length) throw new PlanError(`child "${c.title}": unknown package label(s) ${lostPkg.join(', ')} — add to .github/labels.yml`)
  const dispatch = labelForChild({ depth: childDepth, isLeaf: !c.needsSplit, maxDepth: MAX_DEPTH })
  actions.push({
    type: 'create', ref: 'child0', title: c.title,
    body: buildChildBody(c.body, { epic, childDepth, epic_branch, dispatch, step: 0 }),
    labels: kept, droppedLabels: dropped,
  })
  actions.push({ type: 'link', parent: target, ref: 'child0' })
  actions.push({ type: 'post-steps', epic: target, steps: plan.steps, ticketRefs: { 0: 'child0' } })
  actions.push({ type: 'request-plan-review', epic: target })
  return actions
}

/**
 * Is this path gitignored? (#1933) `git check-ignore` exits 0 when the path IS ignored, 1 when it
 * is not — so a non-zero exit throws through the injected executor and means "not ignored".
 * Fail OPEN: if git itself is unavailable we assume committable rather than silently dropping a
 * good image, since the .gitignore exceptions are the real fix and this is the backstop.
 */
export function isGitIgnored(path, { exec } = {}) {
  if (!exec) return false
  try {
    exec('git', ['check-ignore', '-q', path])
    return true
  } catch {
    return false
  }
}

// ── I/O executor ──────────────────────────────────────────────────────────────────
// Every gh call uses execFile ARRAY ARGS — the shell never parses the body, so the #1001
// heredoc/quoting failure is structurally impossible. `exec` is injected so tests can assert the
// call sequence without the network.
function realExec(file, args, input) {
  return execFileSync(file, args, { input, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 }).trim()
}

// REST, not GraphQL (#2708): `gh issue create|edit|view|comment` all go through GraphQL, which is
// blocked in interactive Claude sessions. `gh api repos/...` is plain REST and works everywhere.
// `-F body=@file` reads the body file verbatim, so the array-args / no-shell guarantee holds.
export const issueApi = (repo, n, tail = '') => `repos/${repo}/issues/${n}${tail}`
export const ghGetBody = (exec, repo, n) => exec('gh', ['api', issueApi(repo, n), '-q', '.body']) || ''
export const ghAddLabel = (exec, repo, n, label) => exec('gh', ['api', '--method', 'POST', issueApi(repo, n, '/labels'), '-f', `labels[]=${label}`])
/**
 * Run one hand-off call; a GitHub limit / 5xx is recorded as a pending hand-off (replayed hourly,
 * #3306) instead of failing the plan. Anything else rethrows. Synchronous, like the rest of this file.
 */
export function deferHandoff(exec, step, fn, state) {
  const since = new Date(Math.floor((state.now || Date.now)() / 1000) * 1000).toISOString() // before fn() (#3362)
  try { return fn() } catch (e) {
    const c = classifyHandoffError(e)
    if (c.action !== 'defer') throw e
    exec('node', [fileURLToPath(new URL('./handoff-exec.mjs', import.meta.url)), 'record', JSON.stringify({ step: { ...step, since }, reason: c.reason, resetAt: c.resetAt || null })])
    state.pending.push({ issue: step.issue, kind: step.kind, label: step.label || step.workflow, reason: c.reason })
    state.log(`⏳ ${step.kind} on #${step.issue} deferred (${c.reason}) — the hourly sweep replays it`)
  }
}
export const ghRemoveLabel = (exec, repo, n, label) => exec('gh', ['api', '--method', 'DELETE', issueApi(repo, n, `/labels/${encodeURIComponent(label)}`)])
export const ghSetBody = (exec, repo, n, file) => exec('gh', ['api', '--method', 'PATCH', issueApi(repo, n), '-F', `body=@${file}`])
export const ghComment = (exec, repo, n, file) => exec('gh', ['api', '--method', 'POST', issueApi(repo, n, '/comments'), '-F', `body=@${file}`])
/** Create an issue; returns its number. Throws (creating nothing further) if the number can't be read. */
export function ghCreateIssue(exec, repo, { title, file, labels = [] }) {
  const args = ['api', '--method', 'POST', `repos/${repo}/issues`, '-f', `title=${title}`, '-F', `body=@${file}`, '-q', '.number']
  for (const l of labels) args.push('-f', `labels[]=${l}`)
  const out = exec('gh', args)
  const num = Number(out)
  if (!Number.isFinite(num) || num <= 0) throw new Error(`could not parse issue number from create output: ${out}`)
  return num
}

/**
 * Execute the action list. Returns a summary of what was created/labelled. `exec` is injectable.
 * One small handler per action type (a dispatch table) — each closes over the shared run state.
 */
export function runActions(actions, { repo, exec = realExec, log = console.error, writeBody = defaultWriteBody } = {}) {
  const state = { repo, exec, writeBody, log, refToNumber: {}, created: [], labelled: [], held: [], artifacts: [], blocked: [], pending: [], stepsPosted: [] }
  for (const a of actions) {
    const handler = ACTION_HANDLERS[a.type]
    if (!handler) throw new Error(`unknown action type: ${a.type}`)
    handler(a, state)
  }
  return { created: state.created, labelled: state.labelled, held: state.held, artifacts: state.artifacts, blocked: state.blocked, pending: state.pending, stepsPosted: state.stepsPosted, mockupMissing: !!state.mockupMissing }
}

// Render the artifacts pi proposed for a design sign-off. BEST-EFFORT: every render is guarded so a
// bad proposal (wrong fieldsFile shape, unrenderable HTML) is skipped and the questions still post.
// Returns { schemaMd, images:[{label,path}] } and pushes committed-artifact paths onto state.artifacts.
// The render scripts are plain `node` (schema-review / ui-proposal / ticket-excalidraw) — pi-runnable.
function renderSignoffArtifacts(signoff, state) {
  const tmp = process.env.RUNNER_TEMP || '/tmp'
  const out = { schemaMd: '', images: [], errors: {} }
  const tryRender = (label, fn) => {
    try { fn() } catch (e) { out.errors[label] = e.message; state.log(`⚠️  signoff render skipped (${label}): ${e.message}`) }
  }
  // Only link an image the repo will actually commit (#1933). `git add` on an ignored path is a
  // SILENT no-op — exit 0, no warning — so #1821's two new artifact dirs were never committed and
  // every hold posted a dead raw.githubusercontent link. A missing image costs a little context;
  // a BROKEN one makes the whole gate look broken. Skipping loudly is the better failure.
  const linkable = (png, label) => {
    if (!existsSync(png)) return false
    if (isGitIgnored(png, state)) {
      state.log(`⚠️  signoff image NOT linked (${label}): ${png} is gitignored — add a '!' exception for its directory`)
      return false
    }
    return true
  }
  if (signoff.schema) {
    tryRender('schema', () => {
      const col = signoff.schema.collection.replace(/[^a-z0-9_-]/gi, '') || 'collection'
      const jf = `${tmp}/signoff-schema-${col}.json`
      writeFileSync(jf, JSON.stringify(signoff.schema.fields, null, 2))
      mkdirSync('writeups/schema-reviews', { recursive: true })
      state.exec('node', ['.claude/skills/schema-review/render-schema.mjs', jf, '--collection', col, '--out-dir', 'writeups/schema-reviews'])
      const md = `writeups/schema-reviews/${col}.md`
      const html = `writeups/schema-reviews/${col}.html`
      if (existsSync(md)) { out.schemaMd = readFileSync(md, 'utf8').trim(); state.artifacts.push(md) }
      if (existsSync(html)) {
        state.artifacts.push(html)
        const png = `writeups/schema-reviews/${col}.png`
        tryRender('schema-png', () => { state.exec('node', ['.claude/skills/ui-proposal/render.mjs', html, png]); if (linkable(png, `Schema — ${col}`)) { state.artifacts.push(png); out.images.push({ label: `Schema — ${col}`, path: png }) } })
      }
    })
  }
  if (signoff.diagram) {
    tryRender('diagram', () => {
      const gf = `${tmp}/signoff-diagram.json`
      writeFileSync(gf, JSON.stringify(signoff.diagram, null, 2))
      const before = new Set(state.artifacts)
      // --excalidraw: also write the loose scene, which the ✏️ Edit link's editor loads (#3690).
      state.exec('node', ['scripts/ticket-excalidraw.mjs', gf, '--out-dir', 'writeups/diagrams', '--excalidraw'])
      // ticket-excalidraw names files by slug; pick up the freshly written .png.
      const dir = 'writeups/diagrams'
      const pngs = (existsSync(dir) ? readdirSync(dir) : []).filter(f => f.endsWith('.png')).map(f => `${dir}/${f}`)
      const newest = pngs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
      if (newest && !before.has(newest) && linkable(newest, 'Diagram')) {
        state.artifacts.push(newest); out.images.push({ label: 'Diagram', path: newest })
        // The scene is saved to the `diagrams` branch by the hold handler, NOT added to artifacts:
        // an epic-branch copy would drift from the owner's saved edits (#3690).
        const slug = basename(newest, '.png')
        const scene = `${dir}/${slug}.excalidraw`
        if (existsSync(scene)) out.diagramScene = { slug, file: scene }
      }
    })
  }
  if (signoff.ui) {
    tryRender('ui', () => {
      const hf = `${tmp}/signoff-ui.html`
      writeFileSync(hf, signoff.ui)
      mkdirSync('writeups/ui-mockups', { recursive: true })
      // A new name per run (#2809): re-holding with the same name collided with the tracked copy on
      // the epic branch, so every revised mockup was silently dropped and the comment kept showing
      // the first one (and raw.githubusercontent would cache it anyway).
      const png = `writeups/ui-mockups/signoff-ui-${process.env.GITHUB_RUN_ID || Date.now()}.png`
      state.exec('node', ['.claude/skills/ui-proposal/render.mjs', hf, png])
      if (linkable(png, 'UI mockup')) { state.artifacts.push(png); out.images.push({ label: 'UI mockup', path: png }) }
    })
  }
  return out
}


// #2809: a hold that talks about a mockup/UI must show one or say plainly why not. Returns the
// reason string when a UI mockup was expected but no image was linked, else ''.
const MOCKUP_RE = /\b(mock-?up|wireframe|layout|screenshot)\b/i
export function missingMockupReason(signoff, images = [], renderError = '') {
  if (images.some(i => i.label === 'UI mockup')) return ''
  const text = [signoff.summary, ...(signoff.questions || [])].join(' ')
  if (!signoff.ui && !MOCKUP_RE.test(text)) return ''
  if (!signoff.ui) return 'the plan included no `ui` mockup HTML'
  return renderError ? `the mockup render failed (${renderError})` : 'the mockup image was not rendered or not committable (gitignored path?)'
}

/**
 * The design sign-off hold comment (#1821), as a pure string. `editUrl` (from diagramEditUrl, #3690)
 * adds an ✏️ Edit link under the Diagram image; with no `rawBase` (no epic branch) there are no
 * images and so no link.
 */
export function renderSignoffHoldBody({ signoff, art, rawBase, editUrl = null }) {
  // The marker is the FIRST line: label-router and on-comment recognise a real hold by it (#3238).
  const lines = [SIGNOFF_MARKER]
  lines.push('> 🤖 **pi.dev harness** · agent pipeline (CI) · _design sign-off gate (#1821)_')
  lines.push('')
  lines.push(HOLD_HEADING)
  lines.push('')
  lines.push(signoff.summary)
  lines.push('')
  lines.push('### Decide these forks')
  signoff.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`))
  if (art.schemaMd) {
    lines.push('')
    lines.push('### Proposed schema')
    lines.push(art.schemaMd)
  }
  if (art.images.length && rawBase) {
    lines.push('')
    lines.push('### Rendered')
    for (const img of art.images) {
      lines.push(`**${img.label}**\n\n![${img.label}](${rawBase}/${img.path})`)
      if (img.label === 'Diagram' && editUrl) {
        lines.push(`[✏️ Edit this diagram](${editUrl})`)
        lines.push('Saving writes to the `diagrams` branch; nothing is merged from it.')
      }
    }
  }
  const missing = missingMockupReason(signoff, art.images, art.errors?.ui)
  if (missing) {
    lines.push('')
    lines.push(`⚠️ **Mockup missing:** ${missing}. Reply and ask for it, or answer the forks without one.`)
  }
  lines.push('')
  lines.push('---')
  // @mention the owner: a hold is an ASK — it needs action, so it must notify (#1745). Without
  // this the comment + status:blocked land silently and the hold waits on someone noticing it.
  // Per CLAUDE.md an @mention is a request for action, which is exactly what this is.
  lines.push('@pmcp — reply **`lgtm`** / **`approve`** to proceed to build, or answer the forks above and I\'ll revise. Holding on `status:blocked`.')
  return lines.join('\n')
}

const ACTION_HANDLERS = {
  // A leaf: stamp the WS2 block onto the target's CURRENT body (merge, don't clobber prose).
  'edit-body'(a, { repo, exec, writeBody }) {
    const cur = ghGetBody(exec, repo, a.issue)
    ghSetBody(exec, repo, a.issue, writeBody(`edit-${a.issue}`, writePipelineBlock(cur, a.ctx)))
  },
  // Design sign-off hold (#1821): render the proposed artifacts, post them + the forks on the epic,
  // and add status:blocked. Creates NO children — the lgtm→resume-on-comment loop continues later.
  'signoff-hold'(a, state) {
    const { repo, exec, writeBody } = state
    const art = renderSignoffArtifacts(a.signoff, state)
    const rawBase = a.epic_branch ? `https://raw.githubusercontent.com/${repo}/${a.epic_branch}` : null
    // Best-effort (#3690): save the scene to `diagrams` so the ✏️ Edit link opens it. A failed save
    // drops only the link — the hold still posts.
    let editUrl = null
    if (art.diagramScene && rawBase) {
      try {
        saveDiagramScene({ exec, repo, slug: art.diagramScene.slug, file: art.diagramScene.file, issue: a.issue, tmpDir: process.env.RUNNER_TEMP || '/tmp' })
        editUrl = diagramEditUrl({ slug: art.diagramScene.slug, branch: DIAGRAM_BRANCH, issue: a.issue })
      } catch (e) { state.log(`diagram scene save failed: ${e.message}`); editUrl = null }
    }
    const body = renderSignoffHoldBody({ signoff: a.signoff, art, rawBase, editUrl })
    if (missingMockupReason(a.signoff, art.images, art.errors.ui)) state.mockupMissing = true
    const f = writeBody(`signoff-${a.issue}`, body)
    ghComment(exec, repo, a.issue, f)
    try { ghAddLabel(exec, repo, a.issue, 'status:blocked') } catch (e) { state.log(`addLabel status:blocked: ${e.message}`) }
    state.held.push({ issue: a.issue, questions: a.signoff.questions.length, images: art.images.length, diagramEdit: !!editUrl })
  },
  // Plain, idempotent add — for a label that describes the issue (`epic`, #2501), where adding
  // one already present is the desired no-op and no `labeled` event is wanted.
  'ensure-label'(a, { repo, exec, labelled }) {
    ghAddLabel(exec, repo, a.issue, a.label)
    labelled.push({ issue: a.issue, label: a.label })
  },
  'add-label'(a, { repo, exec, labelled, ...st }) {
    // Force a FRESH labeled event (#1764): the leaf target may already carry work-this from a
    // prior run, and a plain --add-label is then a silent no-op that fires NO `labeled` event —
    // so the single-use worker never triggers and the decompose gate sees no `leafDispatched`
    // (exactly the #1741 failure). Remove-then-add guarantees the event fires.
    try { ghRemoveLabel(exec, repo, a.issue, a.label) } catch { /* wasn't present */ }
    deferHandoff(exec, { kind: 'label', issue: a.issue, label: a.label }, () => ghAddLabel(exec, repo, a.issue, a.label), { ...st, pending: st.pending, log: st.log })
    labelled.push({ issue: a.issue, label: a.label })
  },
  'create'(a, { repo, exec, writeBody, log, refToNumber, created }) {
    if (a.droppedLabels?.length) log(`⚠️  dropped unknown labels on "${a.title}": ${a.droppedLabels.join(', ')}`)
    const f = writeBody(a.ref, a.body)
    const num = ghCreateIssue(exec, repo, { title: a.title, file: f, labels: a.labels })
    refToNumber[a.ref] = num
    created.push({ ref: a.ref, number: num, title: a.title })
  },
  'link'(a, { repo, exec, refToNumber }) {
    const child = refToNumber[a.ref]
    const restId = exec('gh', ['api', `repos/${repo}/issues/${child}`, '-q', '.id'])
    exec('gh', ['api', '--method', 'POST', `repos/${repo}/issues/${a.parent}/sub_issues`, '-F', `sub_issue_id=${restId}`])
  },
  'trigger-label'(a, { repo, exec, refToNumber, labelled, ...st }) {
    const child = refToNumber[a.ref]
    deferHandoff(exec, { kind: 'label', issue: child, label: a.label }, () => ghAddLabel(exec, repo, child, a.label), st)
    labelled.push({ issue: child, label: a.label })
  },
  // Hold-then-review (#2776): start the ticket review run, which releases the first tickets on go.
  'request-ticket-review'(a, { repo, exec, log, ...st }) {
    deferHandoff(exec, { kind: 'dispatch', issue: a.epic, workflow: 'ticket-review.yml', inputs: { epic: String(a.epic) } },
      () => exec('gh', ['workflow', 'run', 'ticket-review.yml', '--repo', repo, '-f', `epic=${a.epic}`]), { ...st, log })
    log(`ticket review requested for epic #${a.epic} — no ticket starts until it is approved`)
  },
  // Rolling plan review (#3846): same shape as request-ticket-review, for the step list.
  'request-plan-review'(a, { repo, exec, log, ...st }) {
    deferHandoff(exec, { kind: 'dispatch', issue: a.epic, workflow: 'ticket-review.yml', inputs: { epic: String(a.epic), subject: 'plan' } },
      () => exec('gh', ['workflow', 'run', 'ticket-review.yml', '--repo', repo, '-f', `epic=${a.epic}`, '-f', 'subject=plan']), { ...st, log })
    log(`plan review requested for rolling epic #${a.epic} — no ticket starts until it is approved`)
  },
  // The step list (#3846): one harness-bot comment, edited in place on a re-run of the same split
  // (newest `<!-- epic-steps:v1 -->` bot comment), else posted new. Records the comment it wrote.
  'post-steps'(a, { repo, exec, writeBody, refToNumber, stepsPosted }) {
    const steps = a.steps.map((s) => ({ ...s, ticket: refToNumber[a.ticketRefs?.[s.step]] ?? s.ticket ?? null }))
    const f = writeBody(`steps-${a.epic}`, renderSteps(steps))
    const raw = exec('gh', ['api', '--paginate', issueApi(repo, a.epic, '/comments?per_page=100'), '--jq', '.[] | {id, body, user: {login: .user.login, type: .user.type}}'])
    const comments = String(raw || '').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    const old = stepsComment(comments)
    const id = old
      ? (exec('gh', ['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${old.id}`, '-F', `body=@${f}`, '-q', '.id']), old.id)
      : Number(exec('gh', ['api', '--method', 'POST', issueApi(repo, a.epic, '/comments'), '-F', `body=@${f}`, '-q', '.id']))
    if (id) stepsPosted.push({ epic: a.epic, comment: id })
  },
  // ORDERING (#1750): stamp `Blocked-by: #N` onto a child that must wait. This is the ONLY
  // record of the dependency, and the format is load-bearing, not decoration: the wave scheduler
  // (`wave-gate.mjs` → `parseBlockers`, #283) reads these lines back off the body to decide what a
  // closing issue just released. We deliberately emit the shape it already parses rather than a
  // second mechanism — it also carries the green-branch gate (#1688) any new one would lack.
  'note-blocked'(a, { repo, exec, refToNumber, blocked }) {
    const child = refToNumber[a.ref]
    const blockers = a.blockedByRefs.map(r => refToNumber[r]).filter(Boolean)
    if (!blockers.length) return
    const body = ghGetBody(exec, repo, child)
    const line = formatBlockedBy(blockers)
    exec('gh', ['api', '--method', 'PATCH', issueApi(repo, child), '-f', `body=${line}\n\n${body}`])
    blocked.push({ issue: child, blockers })
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

/** Does the issue carry this label? A failed lookup answers false, so the review runs (fail closed). */
function hasLabel(repo, n, label) {
  try {
    return realExec('gh', ['api', issueApi(repo, n), '-q', '[.labels[].name]|join(",")']).split(',').includes(label)
  } catch { return false }
}

/** Does the issue have sub-issues? A failed lookup answers true (the rolling guard then asks for the label). */
function hasChildren(repo, n) {
  try { return Number(realExec('gh', ['api', issueApi(repo, n, '/sub_issues?per_page=1'), '-q', 'length'])) > 0 } catch { return true }
}

/**
 * #2776: the first split of an epic is reviewed before anything starts (once — `tickets:approved`).
 * #3846: a rolling plan answers 'rolling' (its plan review is requested by the `request-plan-review`
 * action) when the epic has no children yet or already carries `tickets:rolling`. An epic that has
 * children but no label keeps today's whole-set review, so a rolling plan there is refused.
 */
export function needsTicketReview(plan, ctx, { hasLabel: has = () => false, hasChildren: kids = () => true } = {}) {
  if (plan.rolling) {
    if (has(ctx.target, ROLLING_LABEL) || !kids(ctx.target)) return 'rolling'
    throw new PlanError(`a rolling plan on #${ctx.target}, which already has sub-issues: add the \`${ROLLING_LABEL}\` label by hand to opt it in (#3846)`)
  }
  if (plan.leaf || plan.signoff || ctx.depth !== 0 || !shouldReview(plan.children)) return false
  return !has(ctx.target, APPROVED_LABEL)
}

/**
 * #3238: a ticket that asks for "Hold for design sign-off first" must not slip through as a leaf.
 * If the decomposer returned a leaf, no hold was posted yet and the ticket asks for one, turn the
 * plan into a mockup-less sign-off hold (the #2809 rule then flags the missing mockup).
 */
export function applySignoffFallback(plan, { text = '', comments = [] } = {}) {
  if (!plan.leaf || signoffRoute({ text, comments }).route !== 'signoff') return plan
  return {
    signoff: {
      summary: 'This ticket asks for a design sign-off first, but the decomposer returned a single ticket with no mockup.',
      questions: ['Reply `ok` to build without a mockup, or reply asking for one.'],
      schema: null,
      diagram: null,
      ui: null,
    },
  }
}

/** Reads the target issue and applies applySignoffFallback to a leaf plan; never throws (best effort). */
function withSignoffFallback(plan, args) {
  if (!plan.leaf) return plan
  try {
    const issue = JSON.parse(realExec('gh', ['issue', 'view', String(args.target), '--repo', args.repo, '--json', 'title,body,comments']))
    return applySignoffFallback(plan, { text: `${issue.title}\n${issue.body}`, comments: (issue.comments || []).map(c => ({ body: c.body })) })
  } catch (e) {
    console.error(`signoff fallback skipped: ${e.message}`)
    return plan
  }
}

function main(argv) {
  const args = parseArgs(argv)
  if (args._[0] !== 'apply' || !args._[1]) {
    console.error('usage: node scripts/apply-decompose-plan.mjs apply <plan.json> --repo O/R --target N [--epic N --epic-branch B --depth D]')
    process.exit(2)
  }
  const plan = withSignoffFallback(parsePlan(readFileSync(args._[1], 'utf8')), args)
  const target = Number(args.target)
  const ctx = {
    target,
    epic: Number(args.epic || target),
    depth: args.depth != null ? Number(args.depth) : 0,
    epic_branch: args['epic-branch'] || '',
    knownLabels: knownLabelsFromFile(),
  }
  ctx.reviewTickets = needsTicketReview(plan, ctx, { hasLabel: (n, l) => hasLabel(args.repo, n, l), hasChildren: (n) => hasChildren(args.repo, n) }) === true
  const actions = planToActions(plan, ctx)
  const summary = runActions(actions, { repo: args.repo })
  console.log(JSON.stringify(summary, null, 2))
  // A design sign-off hold IS the deliverable (status:blocked + the posted forks/artifacts);
  // the artifact-gate recognises signoffHeld. Emit the rendered files so the workflow commits
  // them to the epic branch (their raw URLs are referenced in the posted comment).
  if (plan.signoff && summary.artifacts.length) console.log(`SIGNOFF_ARTIFACTS ${summary.artifacts.join(' ')}`)
  const failure = applyFailure(plan, summary)
  if (failure) {
    console.error(failure)
    process.exit(1)
  }
}

/** Why this apply must go red (so the artifact-gate stays honest), or null when it produced its deliverable. */
function applyFailure(plan, summary) {
  if (plan.signoff) {
    if (!summary.held.length) return 'signoff plan produced no hold — failing'
    // The hold posted (with a visible warning), but a UI hold without its image is a defect: go red.
    if (summary.mockupMissing) return 'design hold described a mockup but none was linked — failing (#2809)'
    return null
  }
  if (!plan.leaf && summary.created.length === 0) return 'apply produced no children — failing so the artifact-gate stays honest'
  // #3846: check the step list was written rather than assume it.
  if (plan.rolling && summary.stepsPosted.length === 0) return 'rolling plan posted no step list — failing'
  return null
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
}
