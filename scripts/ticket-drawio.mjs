#!/usr/bin/env node
// layer: harness
/**
 * ticket-drawio — emit an epic diagram as draw.io (diagrams.net) files. SPIKE for #502.
 *
 *   node scripts/ticket-drawio.mjs <graph.json> [--out-dir DIR]
 *
 * Writes, from the same graph + layout as the Excalidraw generator:
 *   <slug>.drawio       the editable mxGraphModel XML (draw.io opens/saves this in GitHub mode)
 *   <slug>.drawio.png   our render with the draw.io XML embedded (renders in the issue body AND
 *                       re-opens editable in draw.io — drop it on the canvas or open via GitHub mode)
 *
 * Why draw.io: its GitHub mode commits edits straight back to the repo, so the human edits on a
 * phone and Save = a commit. No export/attach/importer like the Excalidraw round-trip.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { toHtml } from './lib/excalidraw.mjs'
import { toDrawioXml } from './lib/drawio.mjs'
import { embedTextChunk } from './lib/excalidraw-png.mjs'

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
const outDir = opt('--out-dir', 'writeups/diagrams')
const [input] = argv.filter((a) => !a.startsWith('--'))
if (!input) {
  console.error('Usage: ticket-drawio.mjs <graph.json> [--out-dir DIR]')
  process.exit(1)
}

const graph = JSON.parse(readFileSync(resolve(input), 'utf8'))
if (!graph.slug || !Array.isArray(graph.nodes)) {
  console.error('Graph needs a "slug" and a "nodes" array.')
  process.exit(1)
}
const slug = graph.slug
mkdirSync(resolve(REPO_ROOT, outDir), { recursive: true })

// 1 · editable mxGraphModel XML
const xml = toDrawioXml(graph)
const drawioPath = join(outDir, `${slug}.drawio`)
writeFileSync(resolve(REPO_ROOT, drawioPath), xml)
console.log(`✓ drawio → ${drawioPath}  (editable — open in draw.io GitHub mode)`)

// 2 · our render → PNG, then embed the draw.io XML (keyword "mxfile", URL-encoded)
const htmlPath = join(tmpdir(), `ticket-drawio-${slug}.html`)
const pngPath = join(outDir, `${slug}.drawio.png`)
writeFileSync(htmlPath, toHtml(graph))
const renderer = join('.claude', 'skills', 'ui-proposal', 'render.mjs')
const r = spawnSync(process.execPath, [renderer, htmlPath, pngPath], { cwd: REPO_ROOT, stdio: 'inherit' })
if (r.status !== 0) {
  console.error(`\n⚠ PNG render failed (exit ${r.status}).`)
  process.exit(r.status || 1)
}
const rendered = readFileSync(resolve(REPO_ROOT, pngPath))
const withXml = embedTextChunk(rendered, 'mxfile', encodeURIComponent(xml))
writeFileSync(resolve(REPO_ROOT, pngPath), withXml)
console.log(`✓ png    → ${pngPath}  (renders in the issue body + re-opens editable in draw.io)`)
