/**
 * inject-wrangler-env.mjs — shared implementation behind each app's
 * `scripts/inject-wrangler-env.mjs` shim (#1238). Apps scaffolded OUTSIDE this
 * monorepo get the full self-contained copy from
 * packages/crouton-cli/lib/templates/wrangler/inject-wrangler-env.mjs — keep the
 * two in sync when the logic changes.
 *
 * NuxtHub/Nitro regenerate `.output/server/wrangler.json` on every build and
 * DROP named environments (nitro#3429), so `wrangler deploy --env staging`
 * has nothing to target. This re-merges the `env` block from the source
 * `wrangler.jsonc` into the generated config after the build.
 *
 * Each env inherits `main` / `assets` / `compatibility_*` from the generated
 * top-level config when it doesn't set them, so a named env is self-contained.
 *
 * Run after `nuxt build`, before `wrangler ... deploy --env <name>`.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Minimal JSONC → JSON (strips // and block comments + trailing commas, keeps strings). */
function parseJsonc(text) {
  const noComments = text.replace(
    /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_m, str) => str ?? ''
  )
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, '$1'))
}

// fallow-ignore-next-line complexity — moved verbatim from the per-app copies (#1238); flagged only because the path is new
export function injectWranglerEnv(appDir) {
  const sourcePath = join(appDir, 'wrangler.jsonc')
  const targetPath = join(appDir, '.output/server/wrangler.json')
  const redirectPath = join(appDir, '.wrangler/deploy/config.json')

  if (!existsSync(targetPath)) {
    console.error(`[inject-wrangler-env] ${targetPath} not found — run \`nuxt build\` first.`)
    process.exit(1)
  }

  const source = parseJsonc(readFileSync(sourcePath, 'utf8'))
  if (!source.env || Object.keys(source.env).length === 0) {
    console.log('[inject-wrangler-env] no `env` block in wrangler.jsonc — nothing to inject.')
    process.exit(0)
  }

  const target = JSON.parse(readFileSync(targetPath, 'utf8'))
  const inherit = ['main', 'assets', 'compatibility_date', 'compatibility_flags']
  target.env = target.env || {}

  for (const [name, env] of Object.entries(source.env)) {
    const merged = { ...env }
    for (const key of inherit) {
      if (merged[key] === undefined && target[key] !== undefined) merged[key] = target[key]
    }
    target.env[name] = merged
  }

  writeFileSync(targetPath, JSON.stringify(target, null, 2))
  console.log(
    `[inject-wrangler-env] injected env: ${Object.keys(source.env).join(', ')} → .output/server/wrangler.json`
  )

  // Wrangler rejects `env` blocks in a *redirected* configuration
  // (.wrangler/deploy/config.json). Now that we've added one, remove the redirect
  // so the deploy reads .output/server/wrangler.json directly via an explicit
  // `--config` flag (where named environments are allowed).
  if (existsSync(redirectPath)) {
    rmSync(redirectPath)
    console.log(
      '[inject-wrangler-env] removed .wrangler/deploy/config.json — deploy with `--config .output/server/wrangler.json`'
    )
  }
}
