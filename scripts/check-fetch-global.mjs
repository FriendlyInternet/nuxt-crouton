#!/usr/bin/env node
// check-fetch-global — prove every client chunk that reads `globalThis.$fetch`
// loads Nuxt's setup (`globalThis.$fetch||=`, the 4.7 `nuxt:fetch-global`
// plugin) before it reads it (#4496).
//
// Usage: node scripts/check-fetch-global.mjs <app>/.output [--expect 5]
//
// A reader site is `globalThis.$fetch(` or `globalThis.$fetch=` (not `||=`).
// A chunk passes if its first setup comes before its first reader, or if its
// static imports (followed transitively) reach a chunk with a setup.
// The run fails if any reader chunk fails, if no setup exists anywhere, or if
// fewer than `expectReaders` reader sites were found (so a renamed/minified
// pattern can't pass by finding nothing).

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SETUP = 'globalThis.$fetch||='
const READER_RE = /globalThis\.\$fetch(\(|=(?!=))/g
const IMPORT_RE = /(?:from\s*|import\s*)["'](#entry|\.\/[^"']+\.js)["']/g

function readerSites (code) {
  const sites = []
  for (const m of code.matchAll(READER_RE)) {
    // `globalThis.$fetch||=` never matches READER_RE (the char after $fetch is `|`).
    sites.push({ index: m.index, kind: m[1] === '(' ? 'call' : 'assign' })
  }
  return sites
}

function importsOf (code, entry) {
  const out = []
  for (const m of code.matchAll(IMPORT_RE)) {
    const spec = m[1]
    if (spec === '#entry') { if (entry) out.push(entry) }
    else out.push(spec.slice(2))
  }
  return out
}

/**
 * @param {{ files: Record<string,string>, entry?: string|null, expectReaders?: number }} opts
 *   files: chunk file name (e.g. "abc.js") → source
 * @returns {{ ok: boolean, sites: Array<{chunk:string,kind:string,ok:boolean,why:string}>, errors: string[] }}
 */
function reachesSetup (files, start, entry) {
  const seen = new Set([start])
  const queue = importsOf(files[start], entry)
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f) || files[f] == null) continue
    seen.add(f)
    if (files[f].includes(SETUP)) return f
    queue.push(...importsOf(files[f], entry))
  }
  return null
}

function judgeChunk (files, chunk, firstReaderAt, entry) {
  const setupAt = files[chunk].indexOf(SETUP)
  if (setupAt !== -1 && setupAt < firstReaderAt) {
    return { ok: true, why: 'setup earlier in same chunk' }
  }
  const via = reachesSetup(files, chunk, entry)
  if (via) return { ok: true, why: `imports setup via ${via}` }
  return { ok: false, why: setupAt !== -1 ? 'read before setup in same chunk' : 'no import path to a setup' }
}

export function checkFetchGlobal ({ files, entry = null, expectReaders = 0 }) {
  const errors = []
  const sites = []
  const hasSetup = Object.keys(files).some(f => files[f].includes(SETUP))
  if (!hasSetup) errors.push(`no "${SETUP}" setup found in any chunk`)

  for (const [chunk, code] of Object.entries(files)) {
    const found = readerSites(code)
    if (!found.length) continue
    const { ok, why } = judgeChunk(files, chunk, found[0].index, entry)
    for (const s of found) sites.push({ chunk, kind: s.kind, ok, why })
    if (!ok) errors.push(`${chunk}: ${why}`)
  }

  if (sites.length < expectReaders) {
    errors.push(`found ${sites.length} reader site(s), expected at least ${expectReaders}`)
  }
  return { ok: errors.length === 0, sites, errors }
}

export function resolveEntry (outputDir) {
  const p = join(outputDir, 'server/chunks/virtual/precomputed.mjs')
  if (!existsSync(p)) return null
  const m = readFileSync(p, 'utf8').match(/file:"([^"]+\.js)",name:"entry"/)
  return m ? m[1] : null
}

function main (argv) {
  const args = argv.slice(2)
  const dir = args.find(a => !a.startsWith('--'))
  const ei = args.indexOf('--expect')
  const expectReaders = ei !== -1 ? Number(args[ei + 1]) : 5
  if (!dir) {
    console.error('usage: node scripts/check-fetch-global.mjs <app>/.output [--expect 5]')
    return 2
  }
  const outputDir = resolve(dir)
  const nuxtDir = join(outputDir, 'public/_nuxt')
  if (!existsSync(nuxtDir)) {
    console.error(`check-fetch-global: ${nuxtDir} not found — build the app first`)
    return 1
  }
  const entry = resolveEntry(outputDir)
  if (!entry) {
    console.error('check-fetch-global: could not resolve #entry from server/chunks/virtual/precomputed.mjs — refusing to guess')
    return 1
  }
  const files = {}
  for (const f of readdirSync(nuxtDir)) {
    if (f.endsWith('.js')) files[f] = readFileSync(join(nuxtDir, f), 'utf8')
  }
  const { ok, sites, errors } = checkFetchGlobal({ files, entry, expectReaders })
  console.log(`entry: ${entry} · ${Object.keys(files).length} chunk(s)`)
  for (const s of sites) console.log(`${s.chunk} · ${s.kind} · ${s.ok ? 'ok' : 'FAIL'} (${s.why})`)
  for (const e of errors) console.error(`✗ ${e}`)
  console.log(`check-fetch-global: ${sites.length} reader site(s), ${ok ? 'all ok' : `${errors.length} problem(s)`}`)
  return ok ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(main(process.argv))
}
