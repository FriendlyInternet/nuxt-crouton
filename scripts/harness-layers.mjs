#!/usr/bin/env node
/**
 * Harness layer inventory — classify every skill + agent by which layer of the
 * harness it belongs to, so a foreign-stack team can see at a glance what they
 * keep vs. what they swap. (Epic #952 / WS1 #953.)
 *
 *   node scripts/harness-layers.mjs            # print the inventory grouped by layer
 *   node scripts/harness-layers.mjs --json     # machine-readable record on stdout
 *   node scripts/harness-layers.mjs --check    # exit 1 if any skill/agent is untagged
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, '.claude/skills')
const AGENTS_DIR = join(ROOT, '.claude/agents')

const LAYERS = ['method', 'stage', 'stack']

// Legacy single-file skills with no YAML frontmatter — classified here instead.
// Both are crouton-specific (CRUD generation / crouton-i18n), so: stack.
const OVERRIDES = {
  'crouton': 'stack',
  'i18n-audit': 'stack'
}

// Files under .claude/agents that are documentation, not agents.
// pi-operating-contract.md is a prompt fragment injected verbatim into the pi
// workflows (#1022) — pure prose, no frontmatter by design — not an agent definition.
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
    if (!entry.endsWith('.md') || AGENT_SKIP.has(entry)) continue
    const p = join(AGENTS_DIR, entry)
    const fm = parseFrontmatter(readFileSync(p, 'utf8'))
    const name = nameFor(fm, entry.replace(/\.md$/, ''))
    out.push({ kind: 'agent', name, layer: fm.layer || OVERRIDES[name] || null })
  }
  return out
}

const items = [...discoverSkills(), ...discoverAgents()].sort((a, b) => a.name.localeCompare(b.name))
const untagged = items.filter(i => !i.layer || !LAYERS.includes(i.layer))

const args = process.argv.slice(2)

if (args.includes('--check')) {
  if (untagged.length) {
    console.error(`✖ ${untagged.length} untagged skill/agent(s) — add a \`layer:\` (method|stage|stack):`)
    for (const i of untagged) console.error(`  - ${i.kind} ${i.name}${i.layer ? ` (invalid layer: ${i.layer})` : ''}`)
    process.exit(1)
  }
  console.error(`✓ all ${items.length} skills + agents carry a valid layer`)
  process.exit(0)
}

if (args.includes('--json')) {
  const byLayer = Object.fromEntries(LAYERS.map(l => [l, items.filter(i => i.layer === l).map(i => ({ kind: i.kind, name: i.name }))]))
  process.stdout.write(JSON.stringify({ total: items.length, untagged: untagged.length, byLayer }, null, 2) + '\n')
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
if (untagged.length) {
  console.log(`⚠ untagged (${untagged.length}) — run --check in CI to block these:`)
  for (const i of untagged) console.log(`    ${i.name}`)
}
