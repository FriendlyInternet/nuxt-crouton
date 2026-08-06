#!/usr/bin/env node
/**
 * CLI: write the provisioned D1 ids into a per-PR preview's BUILT wrangler config (#2085).
 * Runs BETWEEN `wrangler deploy` (which provisions) and `d1 migrations apply` (which needs
 * the id). See scripts/lib/pr-preview-db-id.mjs for why the gap exists.
 *
 *   node scripts/pr-preview-db-id.mjs <built-wrangler.json>
 *
 * cwd must be the app dir, so `wrangler` resolves the same account the deploy used.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { wranglerJson } from './lib/sync-wrangler-ids.mjs'
import { applyD1Ids } from './lib/pr-preview-db-id.mjs'

const [file] = process.argv.slice(2)
if (!file) {
  console.error('usage: pr-preview-db-id.mjs <built-wrangler.json>')
  process.exit(2)
}
if (!existsSync(file)) {
  console.error(`pr-preview-db-id: ${file} not found — run the build + deploy first.`)
  process.exit(1)
}

const config = JSON.parse(readFileSync(file, 'utf8'))
if (!(config.d1_databases || []).length) {
  console.log('pr-preview-db-id: no d1 bindings — nothing to resolve.')
  process.exit(0)
}

// PR_PREVIEW_D1_LIST lets this be exercised without Cloudflare (the same injection hook
// sync-wrangler-ids uses); in CI it is unset and the real `wrangler d1 list` runs.
const d1List = wranglerJson(process.cwd(), ['d1', 'list', '--json'], 'PR_PREVIEW_D1_LIST')
const { resolved, missing, alreadySet } = applyD1Ids(config, d1List)

for (const r of resolved) console.log(`  resolved ${r}`)
for (const a of alreadySet) console.log(`  ${a} already had an id — left alone`)

if (missing.length) {
  console.error(`::error::No provisioned D1 found for: ${missing.join(', ')}`)
  console.error(`::error::Available: ${(d1List || []).map((d) => d.name).join(', ') || '(none)'}`)
  console.error('::error::Refusing to continue — migrating nothing would leave the preview')
  console.error('::error::with an empty database behind a link that looks fine (#2078/#2085).')
  process.exit(1)
}

if (resolved.length) writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
console.log(`pr-preview-db-id: ${resolved.length} id(s) written to ${file}`)
