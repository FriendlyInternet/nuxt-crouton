#!/usr/bin/env node
/**
 * Check Documentation
 *
 * Verifies all packages have CLAUDE.md files.
 * Used in CI to ensure AI documentation stays complete.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const packagesDir = join(projectRoot, 'packages')

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
  -h, --help   Show this help message and exit

Behavior:
  - Scans packages/ for directories containing a package.json
  - Reports which of those packages have/are missing a CLAUDE.md
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
