/**
 * CLI: before a PR preview's `wrangler deploy`, reuse storage that already exists under the
 * preview's names, so a deploy that once died half-way can't block every later one (#2608).
 * See scripts/lib/pr-preview-reuse.mjs for why.
 *
 *   node scripts/pr-preview-reuse.mjs <built-wrangler.json>
 *
 * cwd must be the app dir, so `wrangler` resolves the same account the deploy uses.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { wranglerJson } from './lib/sync-wrangler-ids.mjs'
import { reuseExisting } from './lib/pr-preview-reuse.mjs'

const [file] = process.argv.slice(2)
if (!file) {
  console.error('usage: pr-preview-reuse.mjs <built-wrangler.json>')
  process.exit(2)
}
if (!existsSync(file)) {
  console.error(`pr-preview-reuse: ${file} not found — run the build and pr-preview-wrangler first.`)
  process.exit(1)
}

const config = JSON.parse(readFileSync(file, 'utf8'))
const hasD1 = (config.d1_databases || []).length > 0
const hasKv = (config.kv_namespaces || []).length > 0
if (!hasD1 && !hasKv) {
  console.log('pr-preview-reuse: no D1/KV bindings — nothing to reuse.')
  process.exit(0)
}

// PR_PREVIEW_D1_LIST / PR_PREVIEW_KV_LIST let this run without Cloudflare (the same hook
// pr-preview-db-id uses); in CI they are unset and the real wrangler lists run.
const d1List = hasD1 ? wranglerJson(process.cwd(), ['d1', 'list', '--json'], 'PR_PREVIEW_D1_LIST') : []
const kvList = hasKv ? wranglerJson(process.cwd(), ['kv', 'namespace', 'list'], 'PR_PREVIEW_KV_LIST') : []
const { reused, fresh } = reuseExisting(config, { d1List, kvList })

for (const r of reused) console.log(`  reusing ${r}`)
for (const f of fresh) console.log(`  ${f}: none yet — wrangler will create it`)
if (reused.length) writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
console.log(`pr-preview-reuse: ${reused.length} reused, ${fresh.length} to create`)
