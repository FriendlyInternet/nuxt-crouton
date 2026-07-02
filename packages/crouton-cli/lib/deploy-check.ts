// deploy-check.ts — Validate deployment readiness for a Cloudflare Pages app
// Run from inside the app directory: crouton deploy check

import { join } from 'node:path'
import { readFile, access } from 'node:fs/promises'
import consola from 'consola'
import {
  parseAppConfig,
  getPackagesNeedingBuild,
  findMonorepoRoot,
  type AppConfig,
} from './utils/parse-app-config.ts'

interface DeployCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
}

interface DeployCheckResult {
  ok: boolean
  checks: DeployCheck[]
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// ── Check: Wrangler config exists and has no placeholders ──────────────

function checkWranglerConfig(config: AppConfig): DeployCheck[] {
  const checks: DeployCheck[] = []

  if (!config.wrangler || !config.wranglerFormat) {
    checks.push({
      name: 'wrangler-config',
      status: 'fail',
      message: 'No wrangler config found (wrangler.toml, .jsonc, or .json)',
    })
    return checks
  }

  // Check for placeholder IDs
  const placeholders: string[] = []
  for (const db of config.wrangler.d1Databases) {
    if (db.databaseId.includes('TODO') || db.databaseId.includes('REPLACE')) {
      placeholders.push(`D1 database "${db.databaseName}"`)
    }
  }
  for (const kv of config.wrangler.kvNamespaces) {
    if (kv.id.includes('TODO') || kv.id.includes('REPLACE')) {
      placeholders.push(`KV namespace "${kv.binding}"`)
    }
  }

  if (placeholders.length > 0) {
    checks.push({
      name: 'wrangler-ids',
      status: 'fail',
      message: `Placeholder IDs found: ${placeholders.join(', ')} — deploy once to auto-provision, then run the app's \`sync:ids\` script (or set manually)`,
    })
  } else {
    checks.push({
      name: 'wrangler-ids',
      status: 'pass',
      message: 'Wrangler resource IDs configured',
    })
  }

  return checks
}

// ── Check: Hub config matches wrangler bindings ────────────────────────

function checkHubBindings(config: AppConfig): DeployCheck[] {
  const checks: DeployCheck[] = []
  if (!config.wrangler) return checks

  const hasD1 = config.wrangler.d1Databases.length > 0
  const hasKv = config.wrangler.kvNamespaces.length > 0
  const hasR2 = config.wrangler.r2Buckets.length > 0

  if (config.hub.db && !hasD1) {
    checks.push({
      name: 'hub-d1',
      status: 'fail',
      message: 'hub.db configured but no D1 database in wrangler config',
    })
  }

  if (config.hub.kv && !hasKv) {
    checks.push({
      name: 'hub-kv',
      status: 'warn',
      message: 'hub.kv enabled but no KV namespace in wrangler config',
    })
  }

  if (config.hub.blob && !hasR2) {
    checks.push({
      name: 'hub-r2',
      status: 'warn',
      message: 'hub.blob enabled but no R2 bucket in wrangler config — crouton-core may set blob:true in its layer config',
    })
  }

  if (config.hub.db === 'database:true') {
    checks.push({
      name: 'hub-db',
      status: 'fail',
      message: 'hub uses `database: true` — must be `db: \'sqlite\'`',
    })
  } else if (checks.length === 0) {
    checks.push({
      name: 'hub-bindings',
      status: 'pass',
      message: 'Hub config matches wrangler bindings',
    })
  }

  return checks
}

// ── Check: Nitro preset not hardcoded ──────────────────────────────────

function checkNitroPreset(config: AppConfig): DeployCheck[] {
  if (config.hasHardcodedPreset) {
    return [{
      name: 'nitro-preset',
      status: 'fail',
      message: 'nitro.preset is hardcoded in nuxt.config.ts — use NITRO_PRESET env var instead',
    }]
  }
  return [{
    name: 'nitro-preset',
    status: 'pass',
    message: 'Nitro preset not hardcoded (set via env var)',
  }]
}

// ── Check: CF stubs exist ──────────────────────────────────────────────

function checkCfStubs(config: AppConfig): DeployCheck[] {
  if (!config.hasCfStubs) {
    return [{
      name: 'cf-stubs',
      status: 'fail',
      message: 'CF stubs missing — server/utils/_cf-stubs/{index,client}.ts required for Cloudflare',
    }]
  }
  return [{
    name: 'cf-stubs',
    status: 'pass',
    message: 'CF stubs present',
  }]
}

// ── Check: Passkeys disabled ───────────────────────────────────────────

function checkPasskeys(config: AppConfig): DeployCheck[] {
  if (!config.hasPasskeysDisabled) {
    return [{
      name: 'passkeys',
      status: 'warn',
      message: 'Passkeys not explicitly disabled — will fail on Cloudflare Workers (tsyringe incompatibility)',
    }]
  }
  return [{
    name: 'passkeys',
    status: 'pass',
    message: 'Passkeys disabled for Cloudflare',
  }]
}

// ── Check: CI workflow exists and is correct ───────────────────────────

async function checkCiWorkflow(
  config: AppConfig,
  packagesNeedingBuild: string[],
): Promise<DeployCheck[]> {
  const checks: DeployCheck[] = []

  if (!config.ciWorkflowPath) {
    checks.push({
      name: 'ci-workflow',
      status: 'fail',
      message: `No CI workflow found — expected .github/workflows/deploy-${config.name}.yml`,
    })
    return checks
  }

  const content = await readFile(config.ciWorkflowPath, 'utf-8')

  // Check layer builds
  const missingBuilds: string[] = []
  for (const pkg of packagesNeedingBuild) {
    const filterName = pkg.replace('workspace:', '')
    // Check if the package is referenced in the build step (either as pnpm filter or in cache paths)
    const dirName = pkg.replace('@fyit/', '')
    if (!content.includes(dirName)) {
      missingBuilds.push(pkg)
    }
  }

  if (missingBuilds.length > 0) {
    checks.push({
      name: 'ci-layer-builds',
      status: 'fail',
      message: `CI workflow missing layer builds: ${missingBuilds.join(', ')}`,
    })
  } else {
    checks.push({
      name: 'ci-layer-builds',
      status: 'pass',
      message: 'All layer packages with build scripts included in CI',
    })
  }

  // Check BETTER_AUTH_URL
  if (!content.includes('BETTER_AUTH_URL')) {
    checks.push({
      name: 'ci-auth-url',
      status: 'fail',
      message: 'BETTER_AUTH_URL not set in CI build env — required for auth callbacks',
    })
  } else {
    checks.push({
      name: 'ci-auth-url',
      status: 'pass',
      message: 'BETTER_AUTH_URL configured in CI',
    })
  }

  // Check strip-env step (only needed if wrangler has env block)
  if (config.wrangler?.hasEnvBlock) {
    if (!content.includes('strip') && !content.includes('delete cfg.env')) {
      checks.push({
        name: 'ci-strip-env',
        status: 'warn',
        message: 'Wrangler config has env block but CI has no strip-env post-build step — Wrangler 4.64+ will reject it',
      })
    } else {
      checks.push({
        name: 'ci-strip-env',
        status: 'pass',
        message: 'Strip-env post-build step present',
      })
    }
  }

  // Check NITRO_PRESET in build step
  if (!content.includes('NITRO_PRESET')) {
    checks.push({
      name: 'ci-nitro-preset',
      status: 'fail',
      message: 'NITRO_PRESET not set in CI build step — build will target wrong platform',
    })
  }

  // Check migrations step
  if (!content.includes('migrations apply')) {
    checks.push({
      name: 'ci-migrations',
      status: 'warn',
      message: 'No migration step found in CI workflow',
    })
  }

  return checks
}

// ── Main ───────────────────────────────────────────────────────────────

export async function deployCheck(appDir: string): Promise<DeployCheckResult> {
  const config = await parseAppConfig(appDir)
  const checks: DeployCheck[] = []

  // Find monorepo root for package scanning
  const monorepoRoot = await findMonorepoRoot(appDir)
  const packagesNeedingBuild = monorepoRoot
    ? await getPackagesNeedingBuild(config.extends, monorepoRoot)
    : []

  // Run all checks
  checks.push(...checkWranglerConfig(config))
  checks.push(...checkHubBindings(config))
  checks.push(...checkNitroPreset(config))
  checks.push(...checkCfStubs(config))
  checks.push(...checkPasskeys(config))
  checks.push(...await checkCiWorkflow(config, packagesNeedingBuild))

  const hasFails = checks.some(c => c.status === 'fail')
  return { ok: !hasFails, checks }
}

export function printDeployReport(result: DeployCheckResult): void {
  const icons = { pass: '\x1b[32m✔\x1b[0m', warn: '\x1b[33m⚠\x1b[0m', fail: '\x1b[31m✗\x1b[0m' }

  console.log('\n  Deploy Readiness Check\n')

  for (const check of result.checks) {
    console.log(`  ${icons[check.status]} ${check.message}`)
  }

  const fails = result.checks.filter(c => c.status === 'fail').length
  const warns = result.checks.filter(c => c.status === 'warn').length
  const passes = result.checks.filter(c => c.status === 'pass').length

  console.log()
  if (fails > 0) {
    console.log(`  ${icons.fail} ${fails} blocker(s), ${warns} warning(s), ${passes} passed`)
    console.log()
    console.log('  Fix blockers before deploying. A fresh `crouton init` app ships the full Workers deploy config — copy the missing pieces from a scaffolded app.')
  } else if (warns > 0) {
    console.log(`  ${icons.warn} ${warns} warning(s), ${passes} passed — ready to deploy (review warnings)`)
  } else {
    console.log(`  ${icons.pass} All ${passes} checks passed — ready to deploy!`)
  }
  console.log()
}
