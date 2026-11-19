#!/usr/bin/env node
/**
 * Check Documentation
 *
 * Verifies all packages have CLAUDE.md files, and reports (without failing)
 * backticked file paths in those CLAUDE.md files that no longer exist (#3570).
 * Used in CI to ensure AI documentation stays complete.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPathIndex, findStaleDocPaths } from './lib/doc-paths.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootArg = process.argv.indexOf('--root')
const projectRoot = rootArg !== -1 && process.argv[rootArg + 1]
  ? resolve(process.argv[rootArg + 1])
  : join(__dirname, '..')
const packagesDir = join(projectRoot, 'packages')
const allowPath = join(__dirname, 'doc-paths.allow.json')

function reportStalePaths(packages) {
  let files
  try {
    files = execFileSync('git', ['ls-files'], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(Boolean)
  } catch {
    console.log('⚠️ stale doc paths: skipped (git ls-files failed)\n')
    return
  }
  let allow = []
  try {
    allow = JSON.parse(readFileSync(allowPath, 'utf8'))
  } catch {}
  const index = buildPathIndex(files)
  const hits = []
  for (const pkg of packages) {
    const text = readFileSync(join(packagesDir, pkg, 'CLAUDE.md'), 'utf8')
    hits.push(...findStaleDocPaths({ pkg, text, index, allow }))
  }
  if (hits.length === 0) {
    console.log('📎 0 stale doc paths\n')
    return
  }
  console.log('📎 Stale paths in package CLAUDE.md (report only):')
  for (const h of hits) console.log(`   ${h.pkg} · packages/${h.pkg}/CLAUDE.md:${h.line} · ${h.name}`)
  console.log(`📎 ${hits.length} stale doc path(s)\n`)
}

function getPackageDirectories() {
  try {
    const entries = readdirSync(packagesDir)
    return entries
      .filter((entry) => {
        const fullPath = join(packagesDir, entry)
        // Check if it's a directory and has a package.json
        return (
          statSync(fullPath).isDirectory() &&
          existsSync(join(fullPath, 'package.json'))
        )
      })
      .sort()
  } catch {
    return []
  }
}

function printUsage() {
  console.log(`Check Documentation

Verifies all packages under packages/ have a CLAUDE.md file. Used in CI to
ensure AI-facing package documentation stays complete.

Usage:
  node scripts/check-docs.mjs [options]

Options:
  --root <dir> Repo root to scan (default: this repo); packages are read
               from <dir>/packages and tracked files from git ls-files in <dir>
  -h, --help   Show this help message and exit

Behavior:
  - Scans packages/ for directories containing a package.json
  - Reports which of those packages have/are missing a CLAUDE.md
  - Reports (never fails on) backticked paths in each CLAUDE.md that start
    with packages/, app/, server/ or lib/ and exist nowhere in the repo —
    one line per hit (package · file:line · name) plus a total. Intentional
    exceptions live in scripts/doc-paths.allow.json
  - Exits 1 if any package is missing CLAUDE.md, or if no packages are found
  - Exits 0 if every package has CLAUDE.md

Environment:
  (none — no environment variables are read)
`)
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  console.log('🔍 Checking package documentation...\n')

  const packages = getPackageDirectories()

  if (packages.length === 0) {
    console.error('❌ No packages found in packages/')
    process.exit(1)
  }

  console.log(`📦 Found ${packages.length} packages\n`)

  const missing = []
  const present = []

  for (const pkg of packages) {
    const claudeMdPath = join(packagesDir, pkg, 'CLAUDE.md')
    if (existsSync(claudeMdPath)) {
      present.push(pkg)
    } else {
      missing.push(pkg)
    }
  }

  // Report results
  if (present.length > 0) {
    console.log(`✅ ${present.length} packages have CLAUDE.md:`)
    for (const pkg of present) {
      console.log(`   - ${pkg}`)
    }
    console.log('')
  }

  reportStalePaths(present)

  if (missing.length > 0) {
    console.log(`❌ ${missing.length} packages MISSING CLAUDE.md:`)
    for (const pkg of missing) {
      console.log(`   - ${pkg}`)
    }
    console.log('')
    console.log('To fix: Create CLAUDE.md for each missing package.')
    console.log('Use an existing package CLAUDE.md as a template.')
    process.exit(1)
  }

  console.log('✅ All packages have CLAUDE.md documentation!')
  process.exit(0)
}

main()
