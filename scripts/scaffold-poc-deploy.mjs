#!/usr/bin/env node
// scaffold-poc-deploy.mjs — opt a POC into Cloudflare Workers preview deploys.
//
// Part of epic #265 ("build X → testable preview URL"), reworked under #481.
//
// It used to emit a per-POC `.github/workflows/deploy-<name>.yml`. That hit a wall:
// the agent pipeline's GitHub-App token lacks the `workflows` scope, so it can't push
// anything under `.github/workflows/` (this blocked library-catalog, #457). So instead
// this writes a small **config-as-data** file the bot CAN push — `pocs/<name>/deploy.config.json`
// — which the ONE generic, already-committed `.github/workflows/deploy-pocs.yml` reads to
// deploy any changed/dispatched POC. No per-POC workflow file, ever.
//
// Usage:  node scripts/scaffold-poc-deploy.mjs <name>
//         pnpm poc:scaffold-deploy <name>
//
// The preview is stable at https://<name>.pmcp.dev (the #133 staging domain), so
// BETTER_AUTH_URL is predictable and auth works. The POC's wrangler.jsonc (env.staging
// route + id-less D1) is produced by the app scaffold; this script only writes the
// deploy config and sanity-checks the wrangler.
//
// Review overlay (#590/#596): scaffolded apps declare @fyit/crouton-devtools in their
// nuxt.config `modules` (scaffold-app.ts), so the overlay is active on every POC staging
// preview — every preview URL is review-ready. deploy-app.yml always builds the devtools
// dist before `nuxt prepare` (#745), so it loads regardless of this script's layerPackages
// default. A PR-tied deploy also gets the /api/_feedback bridge wired (deploy-app.yml's
// review-pr input + the NUXT_CROUTON_REVIEW_GITHUB_APP_* repo secrets → GitHub App PR
// commenting as nuxt-harness[bot]).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// #4142: the stagingUrl must equal the host the wrangler `env.staging` route binds — the
// CLI writes `<name>.<zone>` for a `--poc`, older apps (crate/gallery) use `<name>-staging.<zone>`.
// Order: the env.staging route → an existing non-empty stagingUrl → the `<name>.pmcp.dev` default.
export function resolveStagingUrl(name, wranglerText, prev = {}) {
  const stagingIdx = wranglerText ? wranglerText.search(/"staging"\s*:/) : -1
  if (stagingIdx >= 0) {
    const m = wranglerText.slice(stagingIdx).match(/"pattern"\s*:\s*"([^"]+)"/)
    if (m) return `https://${m[1]}`
  }
  if (prev && typeof prev.stagingUrl === 'string' && prev.stagingUrl) return prev.stagingUrl
  return `https://${name}.pmcp.dev`
}

function main() {
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Usage: node scripts/scaffold-poc-deploy.mjs <name>   (lowercase, kebab-case)')
  process.exit(1)
}

const pocDir = resolve(repoRoot, 'pocs', name)
if (!existsSync(pocDir)) {
  console.error(`✗ pocs/${name} does not exist — scaffold the POC app first (it lives in pocs/, not apps/).`)
  process.exit(1)
}

// Sanity-check the wrangler.jsonc has a staging env (built by the app scaffold).
const wranglerPath = resolve(pocDir, 'wrangler.jsonc')
let wranglerText = ''
if (!existsSync(wranglerPath)) {
  console.warn(`⚠ pocs/${name}/wrangler.jsonc missing — the app scaffold should create it (\`crouton init ${name} --poc --domain pmcp.dev\`: id-less D1 + an env.staging route equal to stagingUrl).`)
} else {
  wranglerText = readFileSync(wranglerPath, 'utf8')
  if (!/"staging"\s*:/.test(wranglerText)) {
    console.warn(`⚠ pocs/${name}/wrangler.jsonc has no env.staging block — staging deploy needs one (a route equal to stagingUrl, e.g. "${name}.pmcp.dev", id-less ${name}-staging-db).`)
  }
}

// The deploy config the generic deploy-pocs.yml reads. Its PRESENCE opts the POC in.
// Keep it minimal — app name + workspace are implicit (the dir), and prod is never a POC.
const config = {
  // keys map 1:1 to deploy-app.yml inputs (staging-url / layer-packages).
  stagingUrl: `https://${name}.pmcp.dev`, // resolved below from the wrangler route (#4142)
  // Space-separated pnpm filter names of dist-consumed framework packages built before
  // the app (pure source layers without a build script are skipped automatically).
  layerPackages: '@fyit/crouton-core @fyit/crouton-auth @fyit/crouton-i18n',
}

const outPath = resolve(pocDir, 'deploy.config.json')
const existed = existsSync(outPath)
let prev = {}
// Preserve a hand-tuned layerPackages if the file already exists.
if (existed) {
  try {
    prev = JSON.parse(readFileSync(outPath, 'utf8'))
    if (prev.layerPackages) config.layerPackages = prev.layerPackages
  } catch { /* overwrite a malformed file */ }
}
config.stagingUrl = resolveStagingUrl(name, wranglerText, prev)
writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n')

console.log(`${existed ? '↻ updated' : '✓ created'} pocs/${name}/deploy.config.json`)
console.log(`  → the generic .github/workflows/deploy-pocs.yml deploys this POC on a PR touching pocs/${name}/**`)
console.log(`     (or via workflow_dispatch with app=${name}); preview at ${config.stagingUrl}.`)
console.log(`  → no per-POC workflow file is needed; the bot can commit this config (it's under pocs/, not .github/).`)
console.log(`  → needs the CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN CI secrets + the pmcp.dev zone.`)
console.log(`  → review overlay is ON for all POC staging deploys (#596): the in-page click-to-comment`)
console.log(`     overlay is active at the preview URL. For PR commenting to work, set the`)
console.log(`     NUXT_CROUTON_REVIEW_GITHUB_APP_* repo-level secrets (see writeups/setup/review-bridge-token-setup.md).`)
}

// Run only as a CLI — importing the module (the test) must not execute it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
