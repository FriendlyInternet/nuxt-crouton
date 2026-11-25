#!/usr/bin/env node
// Every package-shipped collection create/edit route must validate its body (#3377).
//
// Package collections (packages/*/collections/*) were generated before the generator learned
// to emit `readValidatedBody`, then moved in verbatim, so they accepted any body. They are no
// longer regenerated, so this guard is what catches a route falling back to raw `readBody`.
//
// Checked: `index.post.ts` and single-item `[<x>Id].patch.ts` under server/api.
// Out of scope: `reorder.patch.ts` / `move.patch.ts` — the generator emits `readBody` for those too.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Exceptions: repo-relative posix path -> reason. A listed path that validates or is gone fails.
export const ALLOW = {}

const OUT_OF_SCOPE = /(^|\/)(reorder|move)\.patch\.ts$/

export function isCheckedRoute(path) {
  if (OUT_OF_SCOPE.test(path)) return false
  if (!/\/collections\/[^/]+\/server\/api\//.test(path)) return false
  return /\/index\.post\.ts$/.test(path) || /\/\[[A-Za-z]+Id\]\.patch\.ts$/.test(path)
}

/** files: { repoRelativePosixPath: contents | null }  (null = file is gone) */
function routeProblem(path, src, allow) {
  const validates = src.includes('readValidatedBody(')
  if (path in allow) return validates ? `${path}: allow-listed but now validates its body — remove it from ALLOW` : null
  return validates ? null : `${path}: reads the body without readValidatedBody(...)`
}

function goneAllowProblems(files, allow) {
  return Object.keys(allow)
    .filter(path => files[path] == null)
    .map(path => `${path}: allow-listed but the file is gone — remove it from ALLOW`)
}

export function findViolations(files, allow = ALLOW) {
  const out = Object.entries(files)
    .filter(([path, src]) => src !== null && isCheckedRoute(path))
    .map(([path, src]) => routeProblem(path, src, allow))
    .filter(Boolean)
  return [...out, ...goneAllowProblems(files, allow)]
}

export function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.nuxt' || name === 'dist' || name === '.output') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

export function scanRepo(root) {
  const files = {}
  const pkgs = join(root, 'packages')
  if (!existsSync(pkgs)) return files
  for (const pkg of readdirSync(pkgs)) {
    const col = join(pkgs, pkg, 'collections')
    if (!existsSync(col)) continue
    for (const f of walk(col)) {
      const rel = relative(root, f).split(sep).join('/')
      if (isCheckedRoute(rel)) files[rel] = readFileSync(f, 'utf8')
    }
  }
  for (const p of Object.keys(ALLOW)) if (!(p in files)) files[p] = existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null
  return files
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const files = scanRepo(root)
  const n = Object.keys(files).length
  const bad = findViolations(files)
  if (bad.length) {
    console.error(`check-collection-body-validation: ${bad.length} problem(s) in ${n} route(s)\n${bad.join('\n')}`)
    process.exit(1)
  }
  console.log(`check-collection-body-validation: ${n} package collection create/edit routes all validate their body`)
}
