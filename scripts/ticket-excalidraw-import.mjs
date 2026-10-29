#!/usr/bin/env node
// layer: harness
/**
 * ticket-excalidraw-import — the round-trip IN. Pull a human-edited Excalidraw scene back
 * into the repo from a comment attachment, with zero Finder/git on their side.
 *
 *   node scripts/ticket-excalidraw-import.mjs <png|excalidraw  path-or-URL> --slug <slug> [--out-dir DIR]
 *
 * Input is either:
 *   - a **scene-embedded PNG** — what Excalidraw exports with "Embed scene" ON (the mobile-
 *     friendly path: GitHub allows PNG attachments, so the human drops it in a comment and
 *     passes its URL here), or
 *   - a raw **.excalidraw** file (path or URL).
 *
 * It decodes the scene, re-renders the PNG **from the scene itself** (so boxes the human
 * dragged stay where they put them — unlike regenerating from the graph), re-embeds the scene
 * in that PNG, and writes the committed <slug>.png. Commit it and the diagram reflects their
 * edits. The PNG carries its own editable scene, so no separate .excalidraw is needed.
 *
 * Pairs with the PR watch: on a comment with an attached edited PNG, run this → commit → the
 * sticky refreshes. See the `ticket-diagram` skill.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { sceneToHtml } from './lib/excalidraw.mjs'
import { extractScene, embedScene } from './lib/excalidraw-png.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const argv = process.argv.slice(2)
function opt(flag, def) {
  const i = argv.indexOf(flag)
  if (i === -1) return def
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
const outDir = opt('--out-dir', 'writeups/diagrams')
const slug = opt('--slug', null)
const dumpExcalidraw = argv.includes('--excalidraw')
if (dumpExcalidraw) argv.splice(argv.indexOf('--excalidraw'), 1)
const [input] = argv.filter((a) => !a.startsWith('--'))

if (!input || !slug) {
  console.error(
    'Usage: ticket-excalidraw-import.mjs <png|excalidraw path-or-URL> --slug <slug> [--out-dir DIR] [--excalidraw]\n' +
      '  --slug        output filename stem (which diagram this replaces)\n' +
      '  --excalidraw  also write the loose <slug>.excalidraw (default: scene lives only in the PNG)',
  )
  process.exit(1)
}

// ── Load the bytes (URL or local path) ───────────────────────────────────────
async function loadBytes(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src)
    if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${src}`)
    return Buffer.from(await res.arrayBuffer())
  }
  return readFileSync(resolve(src))
}

const bytes = await loadBytes(input)

// ── Decode the scene (embedded-PNG or raw .excalidraw) ───────────────────────
let scene
if (bytes.length > 8 && bytes.subarray(0, 8).equals(PNG_SIG)) {
  scene = extractScene(bytes) // throws a clear message if "Embed scene" was off
  console.log('✓ decoded scene from embedded PNG')
} else {
  try {
    scene = JSON.parse(bytes.toString('utf8'))
    console.log('✓ read scene from .excalidraw JSON')
  } catch {
    throw new Error('Input is neither a PNG nor valid .excalidraw JSON.')
  }
}
if (!scene || scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) {
  throw new Error('Decoded data is not a valid Excalidraw scene (need type:"excalidraw" + elements[]).')
}
const live = scene.elements.filter((e) => e && !e.isDeleted).length
console.log(`  ${live} element${live === 1 ? '' : 's'} in the scene`)

// ── Render the PNG FROM the scene (preserve the human's layout), then re-embed ──
mkdirSync(resolve(REPO_ROOT, outDir), { recursive: true })
const pngPath = join(outDir, `${slug}.png`)
const htmlPath = join(tmpdir(), `ticket-import-${slug}.html`)
const tmpPng = join(tmpdir(), `ticket-import-${slug}.png`)
writeFileSync(htmlPath, sceneToHtml(scene))

const renderer = join('.claude', 'skills', 'ui-proposal', 'render.mjs')
const r = spawnSync(process.execPath, [renderer, htmlPath, tmpPng], { cwd: REPO_ROOT, stdio: 'inherit' })
if (r.status !== 0) {
  console.error(`\n⚠ PNG render failed (exit ${r.status}).`)
  process.exit(r.status || 1)
}
const rendered = readFileSync(tmpPng)
const finalPng = embedScene(rendered, scene) // PNG carries its own editable scene
writeFileSync(resolve(REPO_ROOT, pngPath), finalPng)
console.log(`✓ png   → ${pngPath}  (re-rendered from the edited scene; scene re-embedded)`)

if (dumpExcalidraw) {
  const exPath = join(outDir, `${slug}.excalidraw`)
  writeFileSync(resolve(REPO_ROOT, exPath), JSON.stringify(scene, null, 2) + '\n')
  console.log(`✓ scene → ${exPath}`)
}

console.log('\n→ Commit the PNG; the diagram now reflects the edited scene.')
