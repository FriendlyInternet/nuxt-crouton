/**
 * Claude Code `@import` resolution for the always-on inventory (#2387).
 *
 * CLAUDE.md can import files with `@<path>` — on a line of its own (`@AGENTS.md`) or
 * inside a sentence ("see @docs/x.md"); imports inside code spans and fenced code
 * blocks are not evaluated. An imported file is inlined into every session, so it is
 * as always-on as CLAUDE.md itself. This returns the file plus everything it imports,
 * recursively, in load order, without duplicates. A target that does not exist is
 * skipped (so `@fyit/crouton-core` in prose, a package name, imports nothing).
 * Pure apart from reading the files — no deps.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

// `@` at the start of the line or after whitespace, then a path: `~/x`, `./x`, `../x`,
// or a plain relative path. Stops at whitespace and at trailing punctuation.
const IMPORT = /(?:^|\s)@((?:~\/|\.\.?\/)?[\w][\w./-]*)/g

/** Import specs on one line of markdown, with code spans removed. */
export function importSpecs(line) {
  const noCode = line.replace(/`[^`]*`/g, ' ')
  const out = []
  for (const m of noCode.matchAll(IMPORT)) out.push(m[1].replace(/[.,;:)]+$/, ''))
  return out
}

/**
 * @param {string} file absolute path of the importing file
 * @param {{root:string, read?:(p:string)=>string, exists?:(p:string)=>boolean}} opts
 *   `root` resolves `@~/...`; `read`/`exists` are injectable for tests.
 * @returns {string[]} absolute paths, the file first, imports in order of appearance
 */
export function resolveImports(file, opts, seen = new Set()) {
  const read = opts.read || ((p) => readFileSync(p, 'utf8'))
  const exists = opts.exists || existsSync
  const out = []
  if (seen.has(file) || !exists(file)) return out
  seen.add(file)
  out.push(file)
  let inFence = false
  for (const raw of read(file).split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; continue }
    if (inFence) continue
    for (const spec of importSpecs(raw)) {
      const target = spec.startsWith('~/') ? join(opts.root, spec.slice(2)) : join(dirname(file), spec)
      out.push(...resolveImports(target, opts, seen))
    }
  }
  return out
}
