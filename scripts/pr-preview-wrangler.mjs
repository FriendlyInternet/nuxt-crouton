#!/usr/bin/env node
/**
 * CLI for the PR-preview config rewrite (#2020). Rewrites a BUILT wrangler config in place
 * so the deploy lands in its own Worker with its own D1/KV, then prints the derived names
 * for the workflow to reuse — deploy and migrate must agree on the DB name, and deriving it
 * twice is how they drift.
 *
 *   node scripts/pr-preview-wrangler.mjs <built-wrangler.json> <app> <pr>
 *
 * Emits GITHUB_OUTPUT-style lines on stdout: worker=<name>, db=<database_name>.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { toPrPreview } from './lib/pr-preview-wrangler.mjs'

const [file, app, pr] = process.argv.slice(2)
if (!file || !app || !pr) {
  console.error('usage: pr-preview-wrangler.mjs <built-wrangler.json> <app> <pr>')
  process.exit(2)
}

const raw = readFileSync(file, 'utf8')
const { config, name, changed } = toPrPreview(JSON.parse(raw), app, pr)
writeFileSync(file, JSON.stringify(config, null, 2) + '\n')

// Loud by design: this step silently doing nothing would ship a "preview" pointed at
// staging, which is the exact failure #2020 is about.
for (const c of changed) console.error(`  ${c}`)
if (!changed.length) {
  console.error('pr-preview-wrangler: NOTHING CHANGED — refusing to pretend this is isolated')
  process.exit(1)
}

const db = (config.d1_databases || [])[0]?.database_name || ''
console.log(`worker=${name}`)
console.log(`db=${db}`)
