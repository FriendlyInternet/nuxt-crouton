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
  // Design sign-off hold (#1821, Option C). When an epic has genuine design ambiguity, the
  // decomposer must NOT spawn "decide & sign off" worker children (they deadlock the code worker,
  // which has no render/hold tool). Instead it proposes the design and HOLDS on the epic: we render
  // the artifacts (schema table / diagram / UI mockup) and post them + status:needs-input, then the
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
      // ORDERING (#1750): sibling INDICES this child depends on. Indices, not issue numbers —
      // at plan time the children do not exist yet, so there is nothing to reference but position.
      blockedBy: normalizeBlockedBy(c.blockedBy, i, p.children.length),
    }
  })
  assertNoDependencyCycle(children)
  return { leaf: false, children }
}

/** Validate one child's `blockedBy` → a sorted, de-duped array of in-range sibling indices. */
function normalizeBlockedBy(raw, self, count) {
  if (raw === undefined || raw === null) return []
  const list = Array.isArray(raw) ? raw : [raw]
  const out = new Set()
  for (const v of list) {
    if (!Number.isInteger(v)) throw new PlanError(`child[${self}].blockedBy must contain sibling indices (integers), got ${JSON.stringify(v)}`)
    if (v === self) throw new PlanError(`child[${self}].blockedBy cannot reference itself`)
    if (v < 0 || v >= count) throw new PlanError(`child[${self}].blockedBy references sibling ${v}, which does not exist (0..${count - 1})`)
    out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * A cycle would deadlock the whole tree: every child waits on another, none is ever dispatched,
 * and the epic silently stalls with no worker and no error. Fail LOUD at plan time instead —
 * an honest parse failure is recoverable, a silent stall is the failure mode this issue is about.
 */
function assertNoDependencyCycle(children) {
  const state = new Array(children.length).fill(0)   // 0 = unvisited, 1 = on stack, 2 = done
  const walk = (i, path) => {
    if (state[i] === 1) throw new PlanError(`child dependency cycle: ${[...path, i].map(n => `child[${n}]`).join(' → ')}`)
    if (state[i] === 2) return
    state[i] = 1
    for (const dep of children[i].blockedBy) walk(dep, [...path, i])
    state[i] = 2
  }
  for (let i = 0; i < children.length; i++) walk(i, [])
}

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
export function buildChildBody(body, { epic, childDepth, epic_branch, dispatch = null }) {
  return writePipelineBlock(body, { epic, depth: childDepth, epic_branch, dispatch })
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
  // ORDERING (#1750). Two passes, and the split matters: a `Blocked-by: #N` line can only be
  // written once N exists, so EVERY child must be created before ANY dependency is recorded or
  // any worker dispatched. The old interleaved create→link→label loop dispatched child 0's worker
  // while child 1 was still uncreated — which is how three workers for one package started within
  // five seconds, two of them against preconditions that did not exist yet.
  plan.children.forEach((c, i) => {
    const { kept, dropped } = sanitizeLabels(c.labels, knownLabels)
    // The trigger label this child WOULD get if it were not blocked. For an unblocked child it is
    // applied directly below; for a blocked one it is recorded on the pipeline block (#1923) so the
    // wave scheduler can release it with the right label instead of falling back to `delegate` and
    // spending a decompose run re-deriving a classification we already made here.
    const dispatch = labelForChild({ depth: childDepth, isLeaf: !c.needsSplit, maxDepth: MAX_DEPTH })
    const isBlocked = (c.blockedBy || []).length > 0
    actions.push({
      type: 'create', ref: `child${i}`,
      title: c.title,
      body: buildChildBody(c.body, { epic, childDepth, epic_branch, dispatch: isBlocked ? dispatch : null }),
      labels: kept, droppedLabels: dropped,
    })
    actions.push({ type: 'link', parent: target, ref: `child${i}` })
  })
  // Pass 2: record dependencies, then dispatch ONLY the children with none. A blocked child gets
  // no trigger label at all — the wave scheduler releases it when its last blocker closes. That
  // is the whole point: an unbuildable leaf should never consume a run on the serial mac-mini.
  plan.children.forEach((c, i) => {
    const deps = c.blockedBy || []
    if (deps.length) {
      actions.push({ type: 'note-blocked', ref: `child${i}`, blockedByRefs: deps.map(d => `child${d}`) })
    }
  })
  plan.children.forEach((c, i) => {
    if ((c.blockedBy || []).length) return
    actions.push({ type: 'trigger-label', ref: `child${i}`, label: labelForChild({ depth: childDepth, isLeaf: !c.needsSplit, maxDepth: MAX_DEPTH }) })
  })
  // NB the label in `dispatch=` (recorded above) and the one applied here are the SAME expression —
  // a blocked child must be released with exactly what it would have been dispatched with.
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

/**
 * Execute the action list. Returns a summary of what was created/labelled. `exec` is injectable.
 * One small handler per action type (a dispatch table) — each closes over the shared run state.
 */
export function runActions(actions, { repo, exec = realExec, log = console.error, writeBody = defaultWriteBody } = {}) {
  const state = { repo, exec, writeBody, log, refToNumber: {}, created: [], labelled: [], held: [], artifacts: [], blocked: [] }
  for (const a of actions) {
    const handler = ACTION_HANDLERS[a.type]
    if (!handler) throw new Error(`unknown action type: ${a.type}`)
    handler(a, state)
  }
  return { created: state.created, labelled: state.labelled, held: state.held, artifacts: state.artifacts, blocked: state.blocked }
}

// Render the artifacts pi proposed for a design sign-off. BEST-EFFORT: every render is guarded so a
// bad proposal (wrong fieldsFile shape, unrenderable HTML) is skipped and the questions still post.
// Returns { schemaMd, images:[{label,path}] } and pushes committed-artifact paths onto state.artifacts.
// The render scripts are plain `node` (schema-review / ui-proposal / ticket-excalidraw) — pi-runnable.
function renderSignoffArtifacts(signoff, state) {
  const tmp = process.env.RUNNER_TEMP || '/tmp'
  const out = { schemaMd: '', images: [] }
  const tryRender = (label, fn) => {
    try { fn() } catch (e) { state.log(`⚠️  signoff render skipped (${label}): ${e.message}`) }
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
      state.exec('node', ['scripts/ticket-excalidraw.mjs', gf, '--out-dir', 'writeups/diagrams'])
      // ticket-excalidraw names files by slug; pick up the freshly written .png.
      const dir = 'writeups/diagrams'
      const pngs = (existsSync(dir) ? readdirSync(dir) : []).filter(f => f.endsWith('.png')).map(f => `${dir}/${f}`)
      const newest = pngs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
      if (newest && !before.has(newest) && linkable(newest, 'Diagram')) { state.artifacts.push(newest); out.images.push({ label: 'Diagram', path: newest }) }
    })
  }
  if (signoff.ui) {
    tryRender('ui', () => {
      const hf = `${tmp}/signoff-ui.html`
      writeFileSync(hf, signoff.ui)
      mkdirSync('writeups/ui-mockups', { recursive: true })
      const png = 'writeups/ui-mockups/signoff-ui.png'
      state.exec('node', ['.claude/skills/ui-proposal/render.mjs', hf, png])
      if (linkable(png, 'UI mockup')) { state.artifacts.push(png); out.images.push({ label: 'UI mockup', path: png }) }
    })
  }
  return out
}


const ACTION_HANDLERS = {
  // A leaf: stamp the WS2 block onto the target's CURRENT body (merge, don't clobber prose).
  'edit-body'(a, { repo, exec, writeBody }) {
    const cur = exec('gh', ['issue', 'view', String(a.issue), '--repo', repo, '--json', 'body', '-q', '.body'])
    const f = writeBody(`edit-${a.issue}`, writePipelineBlock(cur, a.ctx))
    exec('gh', ['issue', 'edit', String(a.issue), '--repo', repo, '--body-file', f])
  },
  // Design sign-off hold (#1821): render the proposed artifacts, post them + the forks on the epic,
  // and add status:needs-input. Creates NO children — the lgtm→resume-on-comment loop continues later.
  'signoff-hold'(a, state) {
    const { repo, exec, writeBody } = state
    const art = renderSignoffArtifacts(a.signoff, state)
    const rawBase = a.epic_branch ? `https://raw.githubusercontent.com/${repo}/${a.epic_branch}` : null
    const lines = []
    lines.push('> 🤖 **pi.dev harness** · agent pipeline (CI · mac-mini) · _design sign-off gate (#1821)_')
    lines.push('')
    lines.push('## 🎨 Design sign-off needed before building')
    lines.push('')
    lines.push(a.signoff.summary)
    lines.push('')
    lines.push('### Decide these forks')
    a.signoff.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`))
    if (art.schemaMd) {
      lines.push('')
      lines.push('### Proposed schema')
      lines.push(art.schemaMd)
    }
    if (art.images.length && rawBase) {
      lines.push('')
      lines.push('### Rendered')
      for (const img of art.images) lines.push(`**${img.label}**\n\n![${img.label}](${rawBase}/${img.path})`)
    }
    lines.push('')
    lines.push('---')
    // @mention the owner: a hold is an ASK — it needs action, so it must notify (#1745). Without
    // this the comment + status:needs-input land silently and the hold waits on someone noticing it.
    // Per CLAUDE.md an @mention is a request for action, which is exactly what this is.
    lines.push('@pmcp — reply **`lgtm`** / **`approve`** to proceed to build, or answer the forks above and I\'ll revise. Holding on `status:needs-input`.')
    const f = writeBody(`signoff-${a.issue}`, lines.join('\n'))
    exec('gh', ['issue', 'comment', String(a.issue), '--repo', repo, '--body-file', f])
    try { exec('gh', ['issue', 'edit', String(a.issue), '--repo', repo, '--add-label', 'status:needs-input']) } catch (e) { state.log(`addLabel status:needs-input: ${e.message}`) }
    state.held.push({ issue: a.issue, questions: a.signoff.questions.length, images: art.images.length })
  },
  'add-label'(a, { repo, exec, labelled }) {
    // Force a FRESH labeled event (#1764): the leaf target may already carry work-this from a
    // prior run, and a plain --add-label is then a silent no-op that fires NO `labeled` event —
    // so the single-use worker never triggers and the decompose gate sees no `leafDispatched`
    // (exactly the #1741 failure). Remove-then-add guarantees the event fires.
    try { exec('gh', ['issue', 'edit', String(a.issue), '--repo', repo, '--remove-label', a.label]) } catch { /* wasn't present */ }
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
  // ORDERING (#1750): stamp `Blocked-by: #N` onto a child that must wait. This is the ONLY
  // record of the dependency, and the format is load-bearing, not decoration: the wave scheduler
  // (`wave-gate.mjs` → `parseBlockers`, #283) reads these lines back off the body to decide what a
  // closing issue just released. We deliberately emit the shape it already parses rather than a
  // second mechanism — it also carries the green-branch gate (#1688) any new one would lack.
  'note-blocked'(a, { repo, exec, refToNumber, blocked }) {
    const child = refToNumber[a.ref]
    const blockers = a.blockedByRefs.map(r => refToNumber[r]).filter(Boolean)
    if (!blockers.length) return
    const body = exec('gh', ['issue', 'view', String(child), '--repo', repo, '--json', 'body', '-q', '.body']) || ''
    const line = formatBlockedBy(blockers)
    exec('gh', ['issue', 'edit', String(child), '--repo', repo, '--body', `${line}\n\n${body}`])
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
  if (plan.signoff) {
    // A design sign-off hold IS the deliverable (status:needs-input + the posted forks/artifacts);
    // the artifact-gate recognises signoffHeld. Emit the rendered files so the workflow commits
    // them to the epic branch (their raw URLs are referenced in the posted comment).
    if (summary.artifacts.length) console.log(`SIGNOFF_ARTIFACTS ${summary.artifacts.join(' ')}`)
    if (!summary.held.length) { console.error('signoff plan produced no hold — failing'); process.exit(1) }
    return
  }
  if (!plan.leaf && summary.created.length === 0) {
    console.error('apply produced no children — failing so the artifact-gate stays honest')
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
}
