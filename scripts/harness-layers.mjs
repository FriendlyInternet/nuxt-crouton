#!/usr/bin/env node
// layer: stack
/**
 * Harness layer inventory — classify every skill + agent by which layer of the
 * harness it belongs to, so a foreign-stack team can see at a glance what they
 * keep vs. what they swap. (Epic #952 / WS1 #953.)
 *
 *   node scripts/harness-layers.mjs            # print the inventory grouped by layer
 *   node scripts/harness-layers.mjs --json     # machine-readable record on stdout
 *   node scripts/harness-layers.mjs --check    # exit 1 if any skill/agent/workflow/script is untagged,
 *                                              # or a harness-tagged file mentions a stack token (#2887)
 *
 * The three layers (see epic #952):
 *   method — portable process / universal practice. Keys off git + GitHub + files,
 *            not the stack. A team on any stack keeps these as-is.
 *   stage  — a lifecycle sign-off gate (schema / UI / test). The layer WS2 (#954) +
 *            WS3 (#955) make declarative (stage → gates) instead of folder-hardcoded.
 *   stack  — crouton / Cloudflare / Drizzle / Nuxt-UI specific tooling. A foreign
 *            team swaps THIS layer; method + stage travel unchanged.
 *
 * Source of truth: each skill/agent's `layer:` frontmatter. Two legacy single-file
 * skills (crouton.md, i18n-audit.md) carry no frontmatter — they're classified in
 * OVERRIDES below. Anything else without a layer lands in "untagged" and --check fails,
 * so a new skill is never silently dropped.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.HARNESS_LAYERS_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, '.claude/skills')
const AGENTS_DIR = join(ROOT, '.claude/agents')

const LAYERS = ['method', 'stage', 'stack']

// Workflows + scripts use their own vocabulary (epic #2882 / WS4 #2887): `harness` is the
// portable pipeline, `stage` the lifecycle gates, `stack` the crouton/Cloudflare flavor.
// The tag is a `# layer: x` (yml/sh) or `// layer: x` (mjs) comment in the first lines.
const FILE_LAYERS = ['harness', 'stage', 'stack']

// A `harness`-tagged file must not name the stack it runs on. Boundary = measurable.
const STACK_TOKENS = [
  'pnpm', 'nuxt', 'nuxthub', 'drizzle', 'crouton', 'wrangler', 'cloudflare', 'vue', 'vite',
  'vitest', 'playwright', 'nitro', 'better-auth', 'tailwind', 'pinia', 'd1', 'h3', 'nuxt-ui'
]
const STACK_RE = new RegExp(`(?<![\\w-])(${STACK_TOKENS.join('|')})(?![\\w])`, 'i')

// Legacy single-file skills with no YAML frontmatter — classified here instead.
// Both are crouton-specific (CRUD generation / crouton-i18n), so: stack.
const OVERRIDES = {
  'crouton': 'stack',
  'i18n-audit': 'stack'
}

// Files under .claude/agents that are documentation, not agents.
// pi-operating-contract.md is a prompt fragment injected verbatim into the pi
// workflows (#1022) — pure prose, no frontmatter by design — not an agent definition.
// A leading `_` marks the same kind of fragment, appended to a pi persona by
// scripts/pipeline-prompt.mjs (#2431): `_pipeline-rules.md`, `_worker-checks.md`.
const AGENT_SKIP = new Set(['CLAUDE.md', 'pi-operating-contract.md'])

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  const fm = {}
  if (m) for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (mm) fm[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim()
  }
  return fm
}

function nameFor(fm, fallback) {
  return fm.name || fallback
}

function discoverSkills() {
  const out = []
  for (const entry of readdirSync(SKILLS_DIR)) {
    const p = join(SKILLS_DIR, entry)
    if (statSync(p).isDirectory()) {
      const f = join(p, 'SKILL.md')
      if (!existsSync(f)) continue
      const fm = parseFrontmatter(readFileSync(f, 'utf8'))
      const name = nameFor(fm, entry)
      out.push({ kind: 'skill', name, layer: fm.layer || OVERRIDES[name] || null })
    } else if (entry.endsWith('.md')) {
      const fm = parseFrontmatter(readFileSync(p, 'utf8'))
      const name = nameFor(fm, entry.replace(/\.md$/, ''))
      out.push({ kind: 'skill', name, layer: fm.layer || OVERRIDES[name] || null })
    }
  }
  return out
}

function discoverAgents() {
  const out = []
  for (const entry of readdirSync(AGENTS_DIR)) {
    if (!entry.endsWith('.md') || AGENT_SKIP.has(entry) || entry.startsWith('_')) continue
    const p = join(AGENTS_DIR, entry)
    const fm = parseFrontmatter(readFileSync(p, 'utf8'))
    const name = nameFor(fm, entry.replace(/\.md$/, ''))
    out.push({ kind: 'agent', name, layer: fm.layer || OVERRIDES[name] || null })
  }
  return out
}

function discoverFiles() {
  const out = []
  const dirs = [['.github/workflows', /\.yml$/, 'workflow'], ['scripts', /\.(mjs|sh)$/, 'script']]
  for (const [dir, ext, kind] of dirs) {
    const base = join(ROOT, dir)
    if (!existsSync(base)) continue
    // scripts/ nests (eval-ledger/, …) — walk it all; the ticket says every .mjs/.sh.
    for (const f of readdirSync(base, { recursive: true })) {
      if (!ext.test(f) || f.split('/').includes('node_modules')) continue
      const text = readFileSync(join(ROOT, dir, f), 'utf8')
      const m = text.split('\n').slice(0, 3).join('\n').match(/^(?:#|\/\/) layer: (\S+)/m)
      const scan = harnessHits(text, f)
      out.push({ kind, name: `${dir}/${f}`, layer: m ? m[1] : null, hits: scan })
    }
  }
  return out
}

function harnessHits(text, f) {
  const hits = new Set()
  for (const line of text.split('\n')) {
    if (/^\s*(#|\/\/) layer: /.test(line)) continue
    const m = line.match(STACK_RE)
    if (m) hits.add(m[1].toLowerCase())
  }
  return [...hits]
}

const files = discoverFiles()
const badFiles = files.filter(f => !FILE_LAYERS.includes(f.layer))
const leaks = files.filter(f => f.layer === 'harness' && f.hits.length)

const items = [...discoverSkills(), ...discoverAgents()].sort((a, b) => a.name.localeCompare(b.name))
const untagged = items.filter(i => !i.layer || !LAYERS.includes(i.layer))

const args = process.argv.slice(2)

if (args.includes('--check')) {
  if (untagged.length) {
    console.error(`✖ ${untagged.length} untagged skill/agent(s) — add a \`layer:\` (method|stage|stack):`)
    for (const i of untagged) console.error(`  - ${i.kind} ${i.name}${i.layer ? ` (invalid layer: ${i.layer})` : ''}`)
    process.exit(1)
  }
  if (badFiles.length || leaks.length) {
    if (badFiles.length) {
      console.error(`✖ ${badFiles.length} workflow/script file(s) without a valid layer — add \`# layer: harness|stage|stack\`:`)
      for (const f of badFiles) console.error(`  - ${f.name}${f.layer ? ` (invalid layer: ${f.layer})` : ''}`)
    }
    if (leaks.length) {
      console.error(`✖ ${leaks.length} harness-tagged file(s) name a stack token — retag as stack/stage or read it from flavor.config.mjs:`)
      for (const f of leaks) console.error(`  - ${f.name}: ${f.hits.join(', ')}`)
    }
    process.exit(1)
  }
  console.error(`✓ all ${items.length} skills + agents and ${files.length} workflows + scripts carry a valid layer; no stack token in harness files`)
  process.exit(0)
}

if (args.includes('--json')) {
  const byLayer = Object.fromEntries(LAYERS.map(l => [l, items.filter(i => i.layer === l).map(i => ({ kind: i.kind, name: i.name }))]))
  const byFileLayer = Object.fromEntries(FILE_LAYERS.map(l => [l, files.filter(f => f.layer === l).map(f => ({ kind: f.kind, name: f.name }))]))
  process.stdout.write(JSON.stringify({ total: items.length, untagged: untagged.length, byLayer, files: { total: files.length, byLayer: byFileLayer } }, null, 2) + '\n')
  process.exit(0)
}

// default: human-readable inventory
const LABEL = {
  method: 'method · portable — keep as-is on any stack',
  stage: 'stage · lifecycle sign-off gates (WS2/WS3 make these declarative)',
  stack: 'stack · crouton/Cloudflare/Drizzle/Nuxt-UI — swap for a foreign stack'
}
console.log(`Harness layer inventory — ${items.length} skills + agents\n`)
for (const layer of LAYERS) {
  const group = items.filter(i => i.layer === layer)
  console.log(`■ ${LABEL[layer]}  (${group.length})`)
  for (const i of group) console.log(`    ${i.kind === 'agent' ? '⚙' : 'ƒ'} ${i.name}`)
  console.log('')
}
console.log(`Workflows + scripts — ${files.length}\n`)
for (const layer of FILE_LAYERS) {
  const group = files.filter(f => f.layer === layer)
  console.log(`■ ${layer}  (${group.length})`)
  for (const f of group) console.log(`    ${f.kind === 'workflow' ? '▶' : '·'} ${f.name}`)
  console.log('')
}
if (badFiles.length) console.log(`⚠ untagged workflows/scripts (${badFiles.length}): ${badFiles.map(f => f.name).join(', ')}\n`)
if (untagged.length) {
  console.log(`⚠ untagged (${untagged.length}) — run --check in CI to block these:`)
  for (const i of untagged) console.log(`    ${i.name}`)
}
