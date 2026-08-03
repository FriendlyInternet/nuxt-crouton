#!/usr/bin/env node
// pipeline-context.mjs — WS2 of epic #1685 (#1695): carry the pipeline's
// { epic, depth, epic_branch } context ON the issue, so a fresh single-use run can read it.
//
// WHY this exists. The old in-process pipeline passed `{ epic, depth, epic_branch }` to a
// child decomposer/worker via the `Agent` spawn prompt. The event-driven redesign (#1685)
// has no such channel: `decompose-on-issue-pidev.yml` labels a child and STOPS; a brand-new
// workflow run picks the child up with zero memory of the parent. So the context must live
// on the issue body itself, in a machine-readable block that BOTH the decomposer
// (`decompose-on-issue-pidev`) and the worker (`work-issue-pidev`) parse.
//
// THE FORMAT (canonical — this file is the one place it's defined, per #1695 acceptance):
//
//   <!-- pipeline: epic=1685 depth=2 epic_branch=epic/1685-single-use-pipeline -->
//
//   • An HTML comment, so it renders invisibly in the issue body.
//   • `key=value` tokens, space-separated, in a single line. Keys: epic (int), depth (int),
//     epic_branch (branch name; may contain `/` and `-`, never a space).
//   • Any subset of keys may be present; absent keys parse to null.
//   • Back-compat (#1686): WS1's worker read a bare `pipeline: epic_branch=<name>` line (no
//     HTML-comment wrapper). `parsePipelineBlock` still reads that legacy shape so already-
//     labelled issues keep working; `formatPipelineBlock` always emits the wrapped form.
//
// This module is PURE + unit-tested (pipeline-context.test.mjs). The workflows shell out to
// the CLI at the bottom for the values they need (e.g. `... read epic_branch < body.txt`).

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// The wrapped, canonical block: `<!-- pipeline: k=v k=v ... -->`. Tolerant of extra inner
// whitespace. The legacy fallback below matches the bare `pipeline: ...` line WS1 emitted.
const BLOCK_RE = /<!--\s*pipeline:\s*([^>]*?)\s*-->/i
const LEGACY_RE = /^[ \t]*pipeline:\s*(.+?)\s*$/im

// Keys we understand. Anything else in the block is ignored (forward-compatible).
const INT_KEYS = new Set(['epic', 'depth'])
const STR_KEYS = new Set(['epic_branch'])

/** Parse the `k=v k=v` token string into a typed object. Unknown keys are dropped. */
function parseTokens(tokenStr) {
  const out = { epic: null, depth: null, epic_branch: null }
  if (!tokenStr) return out
  for (const tok of tokenStr.trim().split(/\s+/)) {
    const eq = tok.indexOf('=')
    if (eq < 1) continue
    const key = tok.slice(0, eq)
    const raw = tok.slice(eq + 1)
    if (INT_KEYS.has(key)) {
      const n = Number.parseInt(raw, 10)
      out[key] = Number.isFinite(n) ? n : null
    } else if (STR_KEYS.has(key)) {
      out[key] = raw || null
    }
  }
  return out
}

/**
 * Read the pipeline block out of an issue body.
 * Returns `{ epic, depth, epic_branch }` (each null when absent).
 * Prefers the wrapped `<!-- pipeline: ... -->` form; falls back to the legacy bare line.
 */
export function parsePipelineBlock(body) {
  if (!body || typeof body !== 'string') return { epic: null, depth: null, epic_branch: null }
  const wrapped = body.match(BLOCK_RE)
  if (wrapped) return parseTokens(wrapped[1])
  const legacy = body.match(LEGACY_RE)
  if (legacy) return parseTokens(legacy[1])
  return { epic: null, depth: null, epic_branch: null }
}

/**
 * Render the canonical wrapped block for the given context. Only the keys with a
 * non-null/defined value are emitted, in a stable order (epic, depth, epic_branch).
 * Returns null if nothing is worth writing (so callers can skip an empty block).
 */
export function formatPipelineBlock({ epic, depth, epic_branch } = {}) {
  const toks = []
  if (epic !== null && epic !== undefined && `${epic}` !== '') toks.push(`epic=${epic}`)
  if (depth !== null && depth !== undefined && `${depth}` !== '') toks.push(`depth=${depth}`)
  if (epic_branch) toks.push(`epic_branch=${epic_branch}`)
  if (toks.length === 0) return null
  return `<!-- pipeline: ${toks.join(' ')} -->`
}

/**
 * Upsert the pipeline block into an issue body, idempotently. If a block (wrapped OR legacy)
 * already exists it is REPLACED in place; otherwise the block is appended after a blank line.
 * Passing the same context twice yields byte-identical output (idempotent — #1695 acceptance).
 * If the merged context is empty, the body is returned unchanged (any existing block removed).
 */
export function writePipelineBlock(body, context = {}) {
  const base = typeof body === 'string' ? body : ''
  // Merge onto whatever is already there so a partial update (e.g. only depth) preserves the
  // other keys. `null`/`undefined` in `context` mean "not supplied → keep the base value" (never
  // "clear it") — so both the function contract (undefined) and the CLI write path (parseTokens
  // yields null for absent keys) do a true partial update instead of nulling siblings.
  const merged = { ...parsePipelineBlock(base), ...stripEmpty(context) }
  const block = formatPipelineBlock(merged)

  const hasWrapped = BLOCK_RE.test(base)
  const hasLegacy = !hasWrapped && LEGACY_RE.test(base)

  if (block === null) {
    // Nothing to write — drop any existing block so the body doesn't keep a stale one.
    if (hasWrapped) return base.replace(BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd()
    if (hasLegacy) return base.replace(LEGACY_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd()
    return base
  }
  if (hasWrapped) return base.replace(BLOCK_RE, block)
  if (hasLegacy) return base.replace(LEGACY_RE, block)
  const sep = base.trim() === '' ? '' : `${base.replace(/\s+$/, '')}\n\n`
  return `${sep}${block}`
}

function stripEmpty(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v
  return out
}

// ── CLI ──────────────────────────────────────────────────────────────────────────
// Reads an issue body from stdin (or a file arg after the command), for the workflows.
//   node scripts/pipeline-context.mjs read [<field>]   < body.txt
//     • no field → prints JSON `{ epic, depth, epic_branch }`
//     • field    → prints just that value (empty string when absent) — for `epic_branch=$(...)`
//   node scripts/pipeline-context.mjs write epic=.. depth=.. epic_branch=..  < body.txt
//     • prints the body with the block upserted
function readStdin() {
  try { return readFileSync(0, 'utf8') } catch { return '' }
}

function main(argv) {
  const [cmd, ...rest] = argv
  if (cmd === 'read') {
    const ctx = parsePipelineBlock(readStdin())
    const field = rest[0]
    if (field) {
      const v = ctx[field]
      process.stdout.write(v === null || v === undefined ? '' : String(v))
    } else {
      process.stdout.write(JSON.stringify(ctx))
    }
    return
  }
  if (cmd === 'write') {
    const ctx = parseTokens(rest.join(' '))
    process.stdout.write(writePipelineBlock(readStdin(), ctx))
    return
  }
  console.error('usage: node scripts/pipeline-context.mjs read [<field>] | write <k=v ...>   (body on stdin)')
  process.exit(2)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
}
