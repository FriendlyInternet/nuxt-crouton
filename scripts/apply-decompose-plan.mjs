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
//         "dependsOn": [0] }                            //   true → needs more decomposition (delegate-pi)
//   ] }                                                // dependsOn = 0-based sibling indices that must
//                                                      // merge first (#1843): the apply step stamps a
//                                                      // `Blocked-by: #N` line + WITHHOLDS the trigger
//                                                      // label; schedule-waves (#283) releases it when
//                                                      // every blocker closes. [] ⇒ dispatch now.
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
      // Dependency edges (#1843): 0-based indices of SIBLINGS this child depends on. The apply
      // step writes a `Blocked-by: #<num>` line into this child's body and DOESN'T trigger-label
      // it — schedule-waves releases it when every blocker closes. Empty ⇒ dispatch immediately.
      dependsOn: parseDependsOn(c.dependsOn, i, p.children.length),
    }
  })
  assertAcyclic(children)   // a dependency cycle would deadlock those children forever — fail loud now.
  return { leaf: false, children }
}

/** Validate a child's `dependsOn` → a deduped array of in-range sibling indices (not self). */
export function parseDependsOn(raw, selfIndex, childCount) {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new PlanError(`child[${selfIndex}].dependsOn must be an array of sibling indices`)
  const out = []
  for (const d of raw) {
    const n = Number(d)
    if (!Number.isInteger(n) || n < 0 || n >= childCount) {
      throw new PlanError(`child[${selfIndex}].dependsOn has out-of-range index ${JSON.stringify(d)} (valid: 0..${childCount - 1})`)
    }
    if (n === selfIndex) throw new PlanError(`child[${selfIndex}] cannot depend on itself`)
    if (!out.includes(n)) out.push(n)
  }
  return out
}

/** Throw PlanError if the children's dependsOn graph has a cycle (DFS with a recursion stack). */
export function assertAcyclic(children) {
  const state = new Array(children.length).fill(0) // 0=unseen 1=on-stack 2=done
  const visit = (i, path) => {
    if (state[i] === 1) throw new PlanError(`dependency cycle: ${[...path, i].map(n => `child${n}`).join(' → ')}`)
    if (state[i] === 2) return
    state[i] = 1
    for (const dep of children[i].dependsOn) visit(dep, [...path, i])
    state[i] = 2
  }
  for (let i = 0; i < children.length; i++) visit(i, [])
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
  // BATCHED ordering (#1843): every `create` runs before any `set-blocked-by`, because the latter
  // resolves sibling refs → issue numbers (populated by create at execution time). So: create all →
  // stamp Blocked-by on the blocked ones → link all → trigger-label ONLY the unblocked ones. A child
  // with `dependsOn` gets NO trigger label here; schedule-waves (#283) releases it (adds `delegate`)
  // once every blocker closes. That's the missing wave-sequencing edge (#1843).
  const creates = [], blocks = [], links = [], triggers = []
  plan.children.forEach((c, i) => {
    const ref = `child${i}`
    const { kept, dropped } = sanitizeLabels(c.labels, knownLabels)
    const body = buildChildBody(c.body, { epic, childDepth, epic_branch })
    creates.push({ type: 'create', ref, title: c.title, body, labels: kept, droppedLabels: dropped })
    links.push({ type: 'link', parent: target, ref })
    const deps = c.dependsOn || []   // parsePlan sets this; tolerate a raw literal without it.
    if (deps.length) {
      // Carry the just-built body forward so the handler prepends `Blocked-by:` without re-fetching it.
      blocks.push({ type: 'set-blocked-by', ref, blockerRefs: deps.map(j => `child${j}`), baseBody: body })
    } else {
      triggers.push({ type: 'trigger-label', ref, label: labelForChild({ depth: childDepth, isLeaf: !c.needsSplit, maxDepth: MAX_DEPTH }) })
    }
  })
  return [...creates, ...blocks, ...links, ...triggers]
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
  const state = { repo, exec, writeBody, log, refToNumber: {}, created: [], labelled: [], held: [], blocked: [], artifacts: [] }
  for (const a of actions) {
    const handler = ACTION_HANDLERS[a.type]
    if (!handler) throw new Error(`unknown action type: ${a.type}`)
    handler(a, state)
  }
  return { created: state.created, labelled: state.labelled, held: state.held, blocked: state.blocked, artifacts: state.artifacts }
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
        tryRender('schema-png', () => { state.exec('node', ['.claude/skills/ui-proposal/render.mjs', html, png]); if (existsSync(png)) { state.artifacts.push(png); out.images.push({ label: `Schema — ${col}`, path: png }) } })
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
      if (newest && !before.has(newest)) { state.artifacts.push(newest); out.images.push({ label: 'Diagram', path: newest }) }
    })
  }
  if (signoff.ui) {
    tryRender('ui', () => {
      const hf = `${tmp}/signoff-ui.html`
      writeFileSync(hf, signoff.ui)
      mkdirSync('writeups/ui-mockups', { recursive: true })
      const png = 'writeups/ui-mockups/signoff-ui.png'
      state.exec('node', ['.claude/skills/ui-proposal/render.mjs', hf, png])
      if (existsSync(png)) { state.artifacts.push(png); out.images.push({ label: 'UI mockup', path: png }) }
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
  // Wave edge (#1843): stamp a machine-readable `Blocked-by: #N, #M` line onto a dependent child's
  // body so schedule-waves (#283) releases it only when every blocker closes. Runs AFTER all creates,
  // so refToNumber holds the blocker numbers. The child got NO trigger label (see planToActions), so
  // it sits dormant until released — no premature dispatch that would hold on a missing dependency.
  'set-blocked-by'(a, state) {
    const { repo, exec, writeBody, refToNumber, blocked, log } = state
    const nums = a.blockerRefs.map(r => refToNumber[r]).filter(Number.isFinite)
    const child = refToNumber[a.ref]
    if (!Number.isFinite(child)) { log(`⚠️  set-blocked-by: no number for ${a.ref} — skipping`); return }
    if (!nums.length) { log(`⚠️  set-blocked-by: no resolved blockers for ${a.ref} — skipping`); return }
    // The `Blocked-by:` line MUST match wave-gate's parser (/Blocked-by:\s*([#\d,\s]+)/i) — plain
    // `#N, #M`, no markdown between the colon and the refs. Prepend it to the just-built body.
    const line = `Blocked-by: ${nums.map(n => `#${n}`).join(', ')}`
    const note = `${line}\n\n_⛓️ Waiting on the above to merge — the wave scheduler (#283) releases this when they close (#1843)._`
    const f = writeBody(`blocked-${child}`, `${note}\n\n${a.baseBody}`)
    exec('gh', ['issue', 'edit', String(child), '--repo', repo, '--body-file', f])
    blocked.push({ issue: child, blockers: nums })
  },
  // Design sign-off hold (#1821): render the proposed artifacts, post them + the forks on the epic,
  // and add status:blocked. Creates NO children — the lgtm→resume-on-comment loop continues later.
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
    // this the comment + status:blocked land silently and the hold waits on someone noticing it.
    // Per CLAUDE.md an @mention is a request for action, which is exactly what this is.
    lines.push('@pmcp — reply **`lgtm`** / **`approve`** to proceed to build, or answer the forks above and I\'ll revise. Holding on `status:blocked`.')
    const f = writeBody(`signoff-${a.issue}`, lines.join('\n'))
    exec('gh', ['issue', 'comment', String(a.issue), '--repo', repo, '--body-file', f])
    try { exec('gh', ['issue', 'edit', String(a.issue), '--repo', repo, '--add-label', 'status:blocked']) } catch (e) { state.log(`addLabel status:blocked: ${e.message}`) }
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
    // A design sign-off hold IS the deliverable (status:blocked + the posted forks/artifacts);
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
