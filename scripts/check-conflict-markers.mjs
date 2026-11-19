#!/usr/bin/env node
/**
 * Refuse any tracked file that carries a conflict-marker line (#4180).
 *
 * A stray `>>>>>>> …` line sat on main for four months (#1373) because the only marker
 * search ran inside the pipeline's own conflict repair. This runs on every PR.
 *
 * Node core only — the CI job installs nothing.
 *   node scripts/check-conflict-markers.mjs   → exit 1 + `path:line: text` per hit, else exit 0
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MARKER } from './conflict-resolution.mjs'

/** contents: path → text. Returns every marker line as { file, line (1-based), text }. */
export function findMarkers(contents) {
  const hits = []
  for (const [file, text] of Object.entries(contents)) {
    const lines = String(text).split(/\r?\n/)
    lines.forEach((l, i) => { if (MARKER.test(l)) hits.push({ file, line: i + 1, text: l }) })
  }
  return hits
}

/** A NUL byte in the first 8000 bytes ⇒ binary (git's own heuristic). */
export function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\0').filter(Boolean)
  const contents = {}
  for (const f of files) {
    let buf
    try { buf = readFileSync(f) } catch { continue } // submodule, deleted path, directory
    if (isBinary(buf)) continue
    contents[f] = buf.toString('utf8')
  }
  const n = Object.keys(contents).length
  if (n === 0) {
    console.log('::error::checked 0 files — git ls-files returned nothing')
    process.exit(1)
  }
  const hits = findMarkers(contents)
  if (hits.length) {
    for (const h of hits) {
      console.log(`${h.file}:${h.line}: ${h.text}`)
      console.log(`::error file=${h.file},line=${h.line}::conflict marker`)
    }
    console.log(`checked ${n} files, ${new Set(hits.map((h) => h.file)).size} with conflict markers`)
    process.exit(1)
  }
  console.log(`checked ${n} files, 0 with conflict markers`)
}
