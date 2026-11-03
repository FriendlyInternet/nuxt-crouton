#!/usr/bin/env node
/**
 * teardown-on-removal.mjs — the FACT-GATHERING half of auto-teardown (#2865, epic #2858).
 *
 * Given two commits, finds which `pocs/<app>` / `apps/<app>` folders the range deleted and asks
 * scripts/teardown-plan.mjs what must go. Prints the plan as JSON on stdout. No Cloudflare, no
 * GitHub — teardown-on-removal.yml acts on the plan.
 *
 *   node scripts/teardown-on-removal.mjs --before <sha> --after <sha>
 */
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { planTeardown } from './teardown-plan.mjs'

const git = args => {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(r.stderr || `git ${args[0]} failed`)
  return r.stdout
}

const lines = out => out.split('\n').filter(Boolean)

/** Plan for the deletions between `before` and `after`. `run(args)` returns git stdout — injectable. */
export function planForRange(before, after, run = git) {
  // Renames count as a delete of the old path, so a move to another root is seen as a promotion
  // by teardown-plan (same app name still present) rather than a removal.
  const deletedPaths = lines(run(['diff', '--no-renames', '--name-only', '--diff-filter=D', before, after, '--', 'pocs', 'apps']))
  const remainingPaths = lines(run(['ls-tree', '-r', '--name-only', after, 'pocs', 'apps']))
  const configsByApp = {}
  for (const p of deletedPaths) {
    const m = /^(pocs|apps)\/([^/]+)\/wrangler\.jsonc$/.exec(p)
    if (!m) continue
    try { configsByApp[m[2]] = run(['show', `${before}:${p}`]) } catch { /* plan falls back to convention */ }
  }
  return planTeardown({ deletedPaths, remainingPaths, configsByApp })
}

function main() {
  const argv = process.argv.slice(2)
  const get = flag => argv[argv.indexOf(flag) + 1]
  const before = get('--before')
  const after = get('--after')
  if (!before || !after || before.startsWith('--') || after.startsWith('--')) {
    console.error('Usage: teardown-on-removal.mjs --before <sha> --after <sha>')
    process.exit(1)
  }
  console.log(JSON.stringify(planForRange(before, after), null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
