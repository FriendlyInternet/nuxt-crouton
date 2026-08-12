#!/usr/bin/env node
// verify-touched-compiles.mjs — does the code the worker just TOUCHED actually compile? (#2182)
//
// The pi worker could open a PR whose changed `.vue` doesn't even parse (an unbalanced tag →
// `vite:vue: Element is missing end tag`), and nothing in the flow caught it: the finish gate only
// typechecks the touched APP, so a packages/-only change returned "acceptance: not verified" and
// opened anyway; CI then failed only INDIRECTLY (an E2E dev-server 500 → auth-setup timeout); and
// the auto-fix bot is barred from packages/. So the file that changed was never compiled anywhere.
// (The #2179/#2180 incident: a `#content` wrapper `<div>` with no `</div>`.)
//
// This compiles the TOUCHED FILES THEMSELVES — a deterministic `@vue/compiler-sfc` parse of every
// touched `.vue` (+ its template), which catches an unbalanced tag in ~ms with NO app boot. It is
// the detector behind both the worker's self-heal re-drive and the finish-gate hard-fail.
//
// Usage:
//   node scripts/verify-touched-compiles.mjs <file...>     # check exactly these files
//   node scripts/verify-touched-compiles.mjs               # auto-detect: `git status` changed files
//   node scripts/verify-touched-compiles.mjs --base <ref>  # auto-detect: files changed vs <ref>
//
// Exit 0 when every touched `.vue` compiles (or none were touched). Exit 1 and print
// `<file>: <error>` lines when any fails — the lines are what a self-heal prompt feeds back to pi.

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// ── pure helpers (unit-tested; no I/O) ───────────────────────────────────────

/** Is this path a Vue SFC we should compile? */
export function isVueFile(p) {
  return typeof p === 'string' && p.endsWith('.vue')
}

/** Keep only the `.vue` paths from a mixed list, de-duped, order-stable. */
export function vueFilesOnly(paths) {
  const seen = new Set()
  const out = []
  for (const p of Array.isArray(paths) ? paths : []) {
    if (isVueFile(p) && !seen.has(p)) { seen.add(p); out.push(p) }
  }
  return out
}

/** Normalise a compiler error (object or string) to a single-line message. */
export function errText(e) {
  const msg = (e && typeof e === 'object' && 'message' in e) ? e.message : String(e)
  return String(msg).replace(/\s+/g, ' ').trim()
}

/** Parse an SFC → { descriptor, errors[] }. Never throws (a thrown parse ⇒ one error, no descriptor). */
function parseErrors(source, filename, parse) {
  try {
    const { descriptor, errors } = parse(String(source), { filename })
    return { descriptor, errors: (errors || []).map(errText) }
  } catch (e) {
    return { descriptor: null, errors: [errText(e)] }
  }
}

/** Compile an SFC's `<template>` → error messages[]. Empty when there's no template or it's clean. */
function templateErrors(descriptor, filename, compileTemplate) {
  if (descriptor?.template?.content == null) return []
  try {
    const { errors } = compileTemplate({
      source: descriptor.template.content,
      filename: filename || 'anonymous.vue',
      id: filename || 'anonymous'
    })
    return (errors || []).map(errText)
  } catch (e) {
    return [errText(e)]
  }
}

/**
 * Compile ONE SFC's source and return a list of human error messages (empty ⇒ compiles).
 * Runs the parser (catches template tag-balance / missing end tags — the #2179 case) AND, when a
 * `<template>` is present, the template compiler (catches malformed directives/expressions). Pure:
 * takes the source string, never touches disk. `compiler` is injected so the test can pass the real
 * `@vue/compiler-sfc` without the module needing to bundle it.
 */
export function sfcErrors(source, filename, compiler) {
  const { descriptor, errors } = parseErrors(source, filename, compiler.parse)
  if (!descriptor) return errors
  return [...errors, ...templateErrors(descriptor, filename, compiler.compileTemplate)]
}

// ── runtime (skipped when imported, e.g. by the test) ────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main()

async function main() {
  const files = vueFilesOnly(resolveTargets(process.argv.slice(2)))
  if (files.length === 0) {
    console.log('[verify-compiles] no touched .vue files — nothing to compile')
    return
  }
  const compiler = await import('@vue/compiler-sfc')
  const failures = checkFiles(files, compiler)
  if (failures.length) {
    reportFailures(failures)
    process.exit(1)
  }
  console.log(`[verify-compiles] ${files.length} touched .vue file(s) compile`)
}

/** Compile each existing file, log a ✓/✗ line, and collect the ones that failed. */
function checkFiles(files, compiler) {
  const failures = []
  for (const f of files) {
    if (!existsSync(f)) continue // deleted/renamed away — not ours to compile
    const errors = sfcErrors(readFileSync(f, 'utf8'), f, compiler)
    if (errors.length) failures.push({ file: f, errors })
    console.log(`${errors.length ? '✗' : '✓'} ${f}${errors.length ? ` — ${errors.length} error(s)` : ''}`)
  }
  return failures
}

/** Print each failing file's errors as `  <file>: <error>` (the lines a self-heal prompt feeds pi). */
function reportFailures(failures) {
  console.error('\n[verify-compiles] the following touched file(s) do NOT compile:')
  for (const { file, errors } of failures) {
    for (const e of errors) console.error(`  ${file}: ${e}`)
  }
}

/** Files to check: explicit args (minus flags), else auto-detect from git. */
function resolveTargets(argv) {
  const baseIdx = argv.indexOf('--base')
  if (baseIdx !== -1) return gitDiffFiles(argv[baseIdx + 1])
  const explicit = argv.filter(a => !a.startsWith('--'))
  return explicit.length ? explicit : gitStatusFiles()
}

function gitStatusFiles() {
  return safeGit(['status', '--porcelain', '-uall'])
    .split('\n').map(l => l.slice(3).split(' -> ').pop().trim()).filter(Boolean)
}

function gitDiffFiles(base) {
  if (!base) return gitStatusFiles()
  return safeGit(['diff', '--name-only', `${base}...HEAD`]).split('\n').map(s => s.trim()).filter(Boolean)
}

function safeGit(args) {
  try { return execFileSync('git', args, { encoding: 'utf8' }) } catch { return '' }
}
