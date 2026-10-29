#!/usr/bin/env node
// layer: harness
/**
 * ticket-excalidraw — turn a GitHub epic's sub-issue tree (supplied as a small graph
 * JSON) into an editable Excalidraw scene + a mobile-legible PNG.
 *
 *   node scripts/ticket-excalidraw.mjs <graph.json> [--out-dir DIR] [--no-png]
 *   <some command that prints graph JSON> | node scripts/ticket-excalidraw.mjs -
 *
 * The CALLER (an agent, over the GitHub MCP) reads the epic + sub-issues and builds the
 * graph JSON — this script only does the deterministic graph → artifacts step, so the
 * render stays offline and repeatable. See the `ticket-diagram` skill for the full loop.
 *
 * Graph JSON:
 *   {
 *     "epic": 479,
 *     "slug": "make-tickets-human-readable",
 *     "title": "Make tickets human-readable",
 *     "nodes": [{ "id": 454, "title": "Schemas + config", "status": "done" }],
 *     "edges": [{ "from": 454, "to": 455 }],
 *     "goal": { "label": "library-catalog.pmcp.dev" }
 *   }
 *   status ∈ done | in_progress | blocked | pending   ·   edges[].from blocks edges[].to
 *
 * Outputs (default <out-dir> = writeups/diagrams):
 *   <slug>.excalidraw   the EDITABLE source of truth (bound arrows)
 *   <slug>.html         offline SVG mirror
 *   <slug>.png          rasterised via the shared renderer (.claude/skills/ui-proposal/render.mjs)
 *
 * Dependency-free except the PNG step, which reuses the repo's headless-Chromium renderer.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { toExcalidraw, toHtml } from './lib/excalidraw.mjs'
import { embedScene } from './lib/excalidraw-png.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

const argv = process.argv.slice(2)
function opt(flag, def) {
  const i = argv.indexOf(flag)
  if (i === -1) return def
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
const noPng = argv.includes('--no-png')
if (noPng) argv.splice(argv.indexOf('--no-png'), 1)
// By default the editable scene is embedded INTO the PNG (no separate .excalidraw committed).
// Pass --excalidraw to also dump the loose <slug>.excalidraw for local use.
const dumpExcalidraw = argv.includes('--excalidraw')
if (dumpExcalidraw) argv.splice(argv.indexOf('--excalidraw'), 1)
const outDir = opt('--out-dir', 'writeups/diagrams')
const [input] = argv.filter((a) => !a.startsWith('--'))

if (!input) {
  console.error(
    'Usage: ticket-excalidraw.mjs <graph.json|-> [--out-dir DIR] [--no-png]\n' +
      '  (pass "-" to read the graph JSON from stdin)',
  )
  process.exit(1)
}

const rawJson = input === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(input), 'utf8')
let graph
try {
  graph = JSON.parse(rawJson)
} catch (err) {
  console.error('Invalid graph JSON:', err.message)
  process.exit(1)
}

// ── Validate the graph contract early with actionable messages ───────────────
const errors = []
if (!graph.slug) errors.push('missing "slug" (used for the output filenames)')
if (!Array.isArray(graph.nodes) || graph.nodes.length === 0)
  errors.push('missing/empty "nodes" array')
const VALID = new Set(['done', 'in_progress', 'blocked', 'pending'])
for (const n of graph.nodes || []) {
  if (n.id == null) errors.push(`a node is missing "id" (${JSON.stringify(n)})`)
  if (!VALID.has(n.status))
    errors.push(`node #${n.id}: status "${n.status}" not in done|in_progress|blocked|pending`)
}
const ids = new Set((graph.nodes || []).map((n) => n.id))
for (const e of graph.edges || []) {
  if (!ids.has(e.from) || !ids.has(e.to))
    errors.push(`edge ${e.from}→${e.to} references a node not in "nodes" (skipped at render)`)
}
if (errors.length) {
  console.error('Graph problems:\n  - ' + errors.join('\n  - '))
  // edge-reference issues are non-fatal (layout filters them); bail only on structural ones.
  if (errors.some((e) => !e.includes('skipped at render'))) process.exit(1)
}

const slug = graph.slug
mkdirSync(resolve(REPO_ROOT, outDir), { recursive: true })
const base = join(outDir, slug)
const graphPath = `${base}.graph.json` // the human-auditable INPUT (commit it → reproducible)
const excalidrawPath = `${base}.excalidraw`
const pngPath = `${base}.png`
// The HTML is a throwaway render intermediate — keep it OUT of the repo.
const htmlPath = join(tmpdir(), `ticket-diagram-${slug}.html`)

const scene = toExcalidraw(graph)
writeFileSync(resolve(REPO_ROOT, graphPath), JSON.stringify(graph, null, 2) + '\n')
writeFileSync(htmlPath, toHtml(graph))
console.log(`✓ graph → ${graphPath}  (auditable input — re-run to regenerate)`)
if (dumpExcalidraw) {
  writeFileSync(resolve(REPO_ROOT, excalidrawPath), JSON.stringify(scene, null, 2) + '\n')
  console.log(`✓ scene → ${excalidrawPath}  (${scene.elements.length} elements)`)
}

// ── PNG via the shared offline renderer, with the editable scene EMBEDDED ─────
if (noPng) {
  console.log(`→ PNG (skipped). Render with:`)
  console.log(`    node .claude/skills/ui-proposal/render.mjs ${htmlPath} ${pngPath}`)
} else {
  const renderer = join('.claude', 'skills', 'ui-proposal', 'render.mjs')
  const r = spawnSync(
    process.execPath,
    [renderer, htmlPath, pngPath],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  if (r.status !== 0) {
    console.error(
      `\n⚠ PNG render failed (exit ${r.status}). Render manually with:\n` +
        `    node ${renderer} ${htmlPath} ${pngPath}`,
    )
    process.exit(r.status || 1)
  }
  // Embed the scene into the PNG → the image IS the editable source (open it in Excalidraw).
  const rendered = readFileSync(resolve(REPO_ROOT, pngPath))
  writeFileSync(resolve(REPO_ROOT, pngPath), embedScene(rendered, scene))
  console.log(`✓ png   → ${pngPath}  (render + ${scene.elements.length}-element editable scene embedded)`)
}
