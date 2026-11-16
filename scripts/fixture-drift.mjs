#!/usr/bin/env node
// Drift gate (#3152): fail if <fixture-dir> differs from what is committed
// (changed OR new untracked files). Usage: node scripts/fixture-drift.mjs <dir>
import { execFileSync } from 'node:child_process'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: fixture-drift.mjs <fixture-dir>')
  process.exit(2)
}
const drift = execFileSync('git', ['status', '--porcelain', '--', dir], { encoding: 'utf8' }).trim()
if (drift) {
  console.log(`::error::${dir} drifted from generator output — regenerate (crouton config --force) and commit:`)
  console.log(drift)
  process.exit(1)
}
