#!/usr/bin/env node
// Rule (#3184): the docs Worker loads only modules that are in the bundle.
// Run after `NITRO_PRESET=cloudflare_module nuxt build`:
//   node docs/scripts/check-worker-bundle.mjs [path-to-.output/server]
// Fails if the llms runtime still uses the runtime `import(name)` loader
// (which 500s on /llms-full.txt in Workers) or if the two modules it needs
// were not bundled.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] || join(import.meta.dirname, '..', '.output', 'server')

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(m?js)$/.test(f)) yield p
  }
}

if (!existsSync(root)) {
  console.error(`worker-bundle check FAILED: ${root} missing - run the cloudflare_module build first`)
  process.exit(1)
}

let loader = false
let visit = false
let mdc = false
let scanned = 0
for (const file of walk(root)) {
  scanned++
  const src = readFileSync(file, 'utf8')
  if (/importExternalPackage\s*=\s*async\s*\(\s*name\s*\)\s*=>\s*await\s+import\(\s*name\s*\)/.test(src)) loader = true
  if (/\bvisit\b/.test(src) && /unist-util-visit/.test(src)) visit = true
  if (/stringifyMarkdown/.test(src)) mdc = true
}

const errors = []
if (!scanned) errors.push(`no .js files under ${root} - build first`)
if (loader) errors.push('runtime import(name) loader still present')
if (!visit) errors.push('unist-util-visit not found in bundle')
if (!mdc) errors.push('@nuxtjs/mdc/runtime (stringifyMarkdown) not found in bundle')

if (errors.length) {
  console.error('worker-bundle check FAILED:\n- ' + errors.join('\n- '))
  process.exit(1)
}
console.log(`worker-bundle check OK (${scanned} files scanned)`)
