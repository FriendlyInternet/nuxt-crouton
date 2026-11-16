#!/usr/bin/env node
// Fails if any packages/*/dist ships test files (#3673), or if there is no dist to check.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_RE = /(^|\/)__tests__\/|\.test\.|\.spec\./

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, base, out)
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
}

function distDirs(rootDir) {
  const pk = path.join(rootDir, 'packages')
  if (!fs.existsSync(pk)) return []
  return fs.readdirSync(pk)
    .map(n => path.join(pk, n, 'dist'))
    .filter(d => fs.existsSync(d) && fs.statSync(d).isDirectory())
}

export function scanDist(rootDir) {
  const dirs = distDirs(rootDir)
  const bad = []
  let files = 0
  for (const d of dirs) {
    const all = []
    walk(d, rootDir, all)
    files += all.length
    bad.push(...all.filter(f => TEST_RE.test(f)))
  }
  return { bad, files, dirs: dirs.length }
}

export function findTestArtifacts(rootDir) {
  return scanDist(rootDir).bad
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root')
  const root = i > -1 ? path.resolve(process.argv[i + 1]) : process.cwd()
  const { bad, files, dirs } = scanDist(root)
  if (dirs === 0) {
    console.error('no packages/*/dist folder found — nothing was checked')
    process.exit(1)
  }
  if (bad.length) {
    for (const b of bad) console.error(b)
    console.error(`${bad.length} test file(s) in package dist`)
    process.exit(1)
  }
  console.log(`checked ${files} files in ${dirs} dist dirs`)
}
