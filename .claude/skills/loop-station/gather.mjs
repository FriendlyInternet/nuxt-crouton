#!/usr/bin/env node
/**
 * Deterministic context-budget inventory for the Loop Station (WS1, #927).
 *
 *   node .claude/skills/loop-station/gather.mjs            # → JSON record on stdout
 *   node .claude/skills/loop-station/gather.mjs --pretty   # human-readable summary too
 *
 * Walks the always-on harness surface — root CLAUDE.md + every skill + every
 * agent + each CI workflow's `prompt:` block — counts tokens (count_tokens when
 * ANTHROPIC_API_KEY is set, deterministic heuristic otherwise), measures lexical
 * shingle redundancy, grades a threshold scorecard, and totals what each
 * LLM-running CI workflow cold-writes per run. Emits ONE record.
 *
 * No LLM in this path (count_tokens is free tokenization, not generation) and no
 * deps. Mirrors the gather→render shape of the epic-digest / housekeeping skills.
 *
 * The record is appended to writeups/loop-station/history.jsonl by
 * append-history.mjs — this script only computes and prints; it never writes.
 *
 * Env:
 *   ANTHROPIC_API_KEY        use count_tokens (free); falls back to heuristic if unset/unhealthy
 *   LOOP_STATION_FORCE_HEURISTIC=1   force the heuristic (deterministic CI tests)
 *   LOOP_STATION_PR          PR number that caused this run (CI sets it)
 *   LOOP_STATION_COMMIT      commit sha (defaults to `git rev-parse HEAD`)
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { makeCounter } from './lib/tokens.mjs'
import { redundancy } from './lib/redundancy.mjs'
import { scorecard } from './lib/scorecard.mjs'
import { resolveImports } from './lib/imports.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const rel = (p) => relative(ROOT, p).split('\\').join('/')
const read = (p) => readFileSync(p, 'utf8')
const PRETTY = process.argv.includes('--pretty')


// ── collect the artifacts ─────────────────────────────────────────────────────

/** Recursively list files under dir matching `test(name)`. */
function walk(dir, test, out = []) {
  if (!existsSync(dir)) return out
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) walk(p, test, out)
    else if (test(ent.name)) out.push(p)
  }
  return out
}

// Harness layer (method | stage | stack) of a skill/agent, read from its `layer:`
// frontmatter (epic #952 / WS1). The classification source of truth is the tags
// themselves + scripts/harness-layers.mjs; the OVERRIDES below mirror that script's
// for the two legacy single-file skills that carry no frontmatter. Keep in sync.
const LAYER_OVERRIDES = { crouton: 'stack', 'i18n-audit': 'stack' }
const LAYERS = ['method', 'stage', 'stack']
function layerOf(text, name) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (m) {
    const mm = m[1].match(/^layer:\s*(.+)$/m)
    if (mm) {
      const v = mm[1].replace(/^["']|["']$/g, '').trim()
      if (LAYERS.includes(v)) return v
    }
  }
  return LAYER_OVERRIDES[name] || null
}

function collectArtifacts() {
  const arts = []

  // Root CLAUDE.md — the always-on context — PLUS everything it imports (#2387).
  // Claude Code inlines a line that is just `@<path>` (e.g. `@AGENTS.md`) into the
  // session context, so an imported file is as always-on as CLAUDE.md itself. Each
  // import is its own artifact row (kind `claudemd`, alwaysOn) so the table still
  // shows them separately; `totals.alwaysOnTokens` is their sum. No layer — this is
  // the constitution itself.
  const rootClaude = join(ROOT, 'CLAUDE.md')
  if (existsSync(rootClaude)) {
    for (const p of resolveImports(rootClaude, { root: ROOT })) {
      arts.push({ path: rel(p), kind: 'claudemd', alwaysOn: true, text: read(p) })
    }
  }

  // Skills: a skill is either a top-level `.claude/skills/<name>.md` (single-file)
  // or `.claude/skills/<name>/SKILL.md` (dir form). Sub-docs inside a skill dir
  // are NOT separate skills — we measure the entry doc only.
  const skillsDir = join(ROOT, '.claude/skills')
  if (existsSync(skillsDir)) {
    for (const ent of readdirSync(skillsDir, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.endsWith('.md')) {
        const p = join(skillsDir, ent.name)
        const name = ent.name.replace(/\.md$/, '')
        const text = read(p)
        arts.push({ path: rel(p), kind: 'skill', name, layer: layerOf(text, name), text })
      } else if (ent.isDirectory()) {
        const p = join(skillsDir, ent.name, 'SKILL.md')
        if (existsSync(p)) {
          const text = read(p)
          arts.push({ path: rel(p), kind: 'skill', name: ent.name, layer: layerOf(text, ent.name), text })
        }
      }
    }
  }

  // Agents: `.claude/agents/**/*.md` (real personas; CLAUDE.md is folder guidance,
  // not an agent — exclude it so the agent inventory is just the personas).
  const agentsDir = join(ROOT, '.claude/agents')
  for (const p of walk(agentsDir, (n) => n.endsWith('.md') && n !== 'CLAUDE.md')) {
    const name = rel(p).split('/').pop().replace(/\.md$/, '')
    const text = read(p)
    arts.push({ path: rel(p), kind: 'agent', name, layer: layerOf(text, name), text })
  }

  return arts.sort((a, b) => a.path.localeCompare(b.path))
}

// ── CI workflow prompt blocks + cold-write detection ──────────────────────────

/**
 * A workflow that runs `claude-code-action` cold-writes the always-on context
 * (CLAUDE.md) into its model on every run, plus any inline `prompt:` block. We
 * extract the prompt text (a YAML block scalar) so its tokens can be added on top.
 */
function collectWorkflows() {
  const wfDir = join(ROOT, '.github/workflows')
  const out = []
  for (const p of walk(wfDir, (n) => n.endsWith('.yml') || n.endsWith('.yaml'))) {
    const text = read(p)
    const usesLlm = /claude-code-action|anthropics\/claude/.test(text)
    if (!usesLlm) continue
    out.push({ path: rel(p), name: rel(p).split('/').pop(), prompt: extractPrompt(text) })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** Pull the `prompt: |`/`>` block scalar out of a workflow (best-effort, dep-free). */
function extractPrompt(yaml) {
  const lines = yaml.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)prompt:\s*[|>][+-]?\s*$/)
    if (!m) continue
    const indent = m[1].length
    const body = []
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim() === '') { body.push(''); continue }
      const lead = line.match(/^\s*/)[0].length
      if (lead <= indent) break // dedent → block ended
      body.push(line.slice(indent + 2))
    }
    return body.join('\n').trim()
  }
  return ''
}

// ── assemble the record ───────────────────────────────────────────────────────

function gitSha() {
  if (process.env.LOOP_STATION_COMMIT) return process.env.LOOP_STATION_COMMIT
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

async function main() {
  const artifacts = collectArtifacts()
  const workflows = collectWorkflows()

  const { tokenizer, count } = await makeCounter({
    force: process.env.LOOP_STATION_FORCE_HEURISTIC ? 'heuristic' : undefined
  })

  // Token-count every artifact (sequential — count_tokens is free but we don't
  // hammer it; the surface is small, tens of files).
  const counted = []
  for (const a of artifacts) {
    counted.push({
      path: a.path,
      kind: a.kind,
      name: a.name,
      layer: a.layer || null,
      alwaysOn: !!a.alwaysOn,
      bytes: Buffer.byteLength(a.text, 'utf8'),
      lines: a.text.split('\n').length,
      tokens: await count(a.text)
    })
  }

  const alwaysOnTokens = counted.filter((a) => a.alwaysOn).reduce((s, a) => s + a.tokens, 0)
  const byKind = {}
  for (const a of counted) byKind[a.kind] = (byKind[a.kind] || 0) + a.tokens
  // Budget by harness layer (#952): method/stage/stack for tagged skills+agents;
  // untagged artifacts (CLAUDE.md, any new skill missing a tag) bucket as `unlayered`
  // so the per-layer tokens always reconcile against totals.tokens.
  const byLayer = { method: { tokens: 0, count: 0 }, stage: { tokens: 0, count: 0 }, stack: { tokens: 0, count: 0 }, unlayered: { tokens: 0, count: 0 } }
  for (const a of counted) {
    const b = byLayer[a.layer] || byLayer.unlayered
    b.tokens += a.tokens
    b.count += 1
  }
  const totalTokens = counted.reduce((s, a) => s + a.tokens, 0)

  const red = redundancy(artifacts.map((a) => ({ path: a.path, text: a.text })))

  // Cold-writes: each LLM workflow pays the always-on context + its prompt block.
  const coldWrites = []
  for (const w of workflows) {
    const promptTokens = w.prompt ? await count(w.prompt) : 0
    coldWrites.push({
      workflow: w.name,
      path: w.path,
      promptTokens,
      alwaysOnTokens,
      total: alwaysOnTokens + promptTokens
    })
  }

  const card = scorecard({ alwaysOnTokens, artifacts: counted, redundancy: red })

  return {
    schema: 3, // 3: imports of CLAUDE.md count as always-on (#2387)
    generatedAt: process.env.LOOP_STATION_NOW || new Date().toISOString(),
    commit: gitSha(),
    pr: process.env.LOOP_STATION_PR ? Number(process.env.LOOP_STATION_PR) : null,
    tokenizer,
    totals: {
      tokens: totalTokens,
      alwaysOnTokens,
      artifactCount: counted.length,
      byKind,
      byLayer
    },
    scorecard: card,
    redundancy: red,
    coldWrites,
    artifacts: counted
  }
}

const record = await main()
process.stdout.write(JSON.stringify(record) + '\n')

if (PRETTY) {
  const k = (n) => (n / 1000).toFixed(1) + 'k'
  const c = record.scorecard
  process.stderr.write(
    `\n── Loop Station inventory ──────────────────────────────\n` +
      `tokenizer      ${record.tokenizer}\n` +
      `always-on      ${k(record.totals.alwaysOnTokens)} tok  [${c.length.score}]\n` +
      `all artifacts  ${k(record.totals.tokens)} tok across ${record.totals.artifactCount}\n` +
      `redundancy     ${record.redundancy.pct}%  [${c.redundancy.score}]\n` +
      `drift pairs    ${c.driftRisk.pairs}  [${c.driftRisk.score}]\n` +
      `cold-writes    ${record.coldWrites.length} LLM workflows\n` +
      `overall        ${c.overall.toUpperCase()}\n` +
      (c.length.oversized.length
        ? `oversized      ${c.length.oversized.slice(0, 5).map((o) => `${o.path.split('/').pop()} ${k(o.tokens)}`).join(', ')}\n`
        : '') +
      (record.redundancy.topPairs.length
        ? `top restate    ${record.redundancy.topPairs[0].a.split('/').pop()} ↔ ${record.redundancy.topPairs[0].b.split('/').pop()} ${record.redundancy.topPairs[0].containment}%\n`
        : '') +
      `────────────────────────────────────────────────────────\n`
  )
}
