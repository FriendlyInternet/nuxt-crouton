// init-app.ts — Orchestrate the full app creation pipeline:
// scaffold-app → generate → doctor → summary
import { join, resolve } from 'node:path'
import { access } from 'node:fs/promises'
import consola from 'consola'

import { generateMigrations, manualMigrationSteps } from './utils/generate-migrations.ts'

interface InitAppOptions {
  features?: string[]
  /** Add `@fyit/crouton-layout` (default true; `--no-layout` opts out, #3956). */
  layout?: boolean
  theme?: string
  dialect?: string
  cf?: boolean
  domain?: string
  /** Small public site (#4263): one team, one locale with plain addresses; adds `@fyit/crouton-pages`. */
  site?: boolean
  dryRun?: boolean
  /** Target directory for the app. Defaults to `apps/<name>` inside the crouton monorepo, `./<name>` elsewhere; pass `pocs/<name>` for a POC. */
  out?: string
}

/**
 * The feature list `crouton init` scaffolds with: the given features plus
 * `layout` unless opted out (#3956). An explicit `layout` is never duplicated.
 */
export function initFeatures(features: string[] = [], layout = true): string[] {
  return layout && !features.includes('layout') ? [...features, 'layout'] : features
}

/**
 * Run the full init pipeline: scaffold -> generate -> doctor -> summary.
 */
export async function initApp(name: string, options: InitAppOptions = {}): Promise<void> {
  const { features = [], layout = true, theme, dialect = 'sqlite', cf, domain, site, dryRun = false, out } = options

  console.log(`\n  crouton init — creating ${name}${out ? ` in ${out}` : ''}\n`)

  // ── Step 1: scaffold-app ──────────────────────────────────────────────
  console.log('  Step 1/3 — Scaffolding app...\n')
  let appDir
  let resolvedCf = true
  try {
    const { scaffoldApp } = await import('./scaffold-app.ts')
    // The default layout is only added when the module registry can see crouton-layout —
    // outside the monorepo (no packages/ or node_modules/@fyit) it would be an
    // "Unknown feature" and fail a bare `crouton init`. An explicit --features layout still errors.
    let addLayout = layout
    if (addLayout && !features.includes('layout')) {
      const { loadModules } = await import('./module-registry.ts')
      if (!(await loadModules()).layout) {
        consola.warn('crouton-layout not found in the module registry — scaffolding without it (add it later with `crouton add layout`).')
        addLayout = false
      }
    }
    const result = await scaffoldApp(name, { features: initFeatures(features, addLayout), theme, dialect, cf, domain, site, dryRun, outDir: out })
    appDir = result.appDir
    resolvedCf = result.cf
  } catch (error) {
    consola.error('Step 1/3 — Scaffold failed')
    throw error
  }

  if (dryRun) {
    consola.warn('Dry run — skipping generate and doctor.\n')
    return
  }

  // scaffoldApp returns appDir relative to the caller's cwd (`apps/<name>`).
  // Step 2 chdirs into the app, so every path handed to a step must be absolute
  // or it gets resolved a second time against the new cwd (#1357).
  const appPath = resolve(appDir)

  // ── Step 2: generate (config-based) ───────────────────────────────────
  const configPath = join(appPath, 'crouton.config.js')
  const hasConfig = await access(configPath).then(() => true).catch(() => false)
  let collectionsGenerated = false

  if (hasConfig) {
    consola.start('Step 2/4 — Generating collections from config...')
    const callerCwd = process.cwd()
    try {
      const { runConfig } = await import('./generate-collection.ts')
      // generated files land in cwd, so generate from inside the app
      process.chdir(appPath)
      await runConfig({ configPath })
      collectionsGenerated = true
      consola.success('Step 2/4 — Collections generated')
    } catch (error) {
      consola.warn('Step 2/4 — Generate skipped (no collections in config yet)')
    } finally {
      process.chdir(callerCwd)
    }
  } else {
    console.log('  Step 2/4 — No crouton.config.js found, skipping generate')
  }

  // ── Step 3: migrations (build-first) ──────────────────────────────────
  // A scaffold ships a Drizzle schema but no migrations, so the first deploy
  // fails the remote-migrate step ("No migrations present", #523). Generate them
  // build-first IF deps are already installed; on a bare scaffold (no
  // node_modules) we can't build — surface the exact manual sequence instead of
  // silently shipping zero migrations.
  let needsManualMigrations = false
  if (collectionsGenerated) {
    consola.start('Step 3/4 — Generating migrations...')
    const result = await generateMigrations(appPath)
    if (result.generated) {
      consola.success('Step 3/4 — Migrations generated')
    } else if (result.reason === 'deferred') {
      needsManualMigrations = true
      consola.info('Step 3/4 — Migrations deferred (install deps so the layers resolve; see next steps)')
    } else {
      needsManualMigrations = true
      consola.warn(`Step 3/4 — Migrations skipped (${result.reason})`)
      if (result.detail) console.log(`   ${result.detail}`)
    }
  } else {
    console.log('  Step 3/4 — No collections generated, skipping migrations')
  }

  // ── Step 4: doctor ────────────────────────────────────────────────────
  consola.start('Step 4/4 — Running doctor checks...')
  try {
    const { doctor, printReport } = await import('./doctor.ts')
    const result = await doctor(appPath)
    consola.success('Step 4/4 — Doctor complete')
    printReport(result)
  } catch (error) {
    consola.warn('Step 4/4 — Doctor skipped (could not validate)')
  }

  // ── Summary ───────────────────────────────────────────────────────────
  printSummary(name, appDir, resolvedCf, needsManualMigrations)
}

function printSummary(name: string, appDir: string, cf: boolean, needsManualMigrations = false): void {
  console.log('  ─────────────────────────────────────')
  console.log(`  ${name} is ready!\n`)
  console.log('  Next steps:\n')
  console.log(`  1.  cd ${appDir}`)
  console.log('  2.  pnpm install')
  if (needsManualMigrations) {
    console.log('  3.  Generate migrations (needed before first deploy):')
    // pnpm install is already step 2 — show the build-first generate sequence
    for (const step of manualMigrationSteps().slice(1)) console.log(`        ${step}`)
    console.log('  4.  pnpm dev')
  } else {
    console.log('  3.  pnpm dev')
  }
  console.log()
  console.log('  Deploy:')
  if (cf) {
    console.log('  4.  pnpm cf:deploy      (builds, auto-provisions D1+KV, syncs ids, migrates, deploys to Workers)')
    console.log('  5.  pnpm cf:staging     (deploys an isolated, auto-provisioned staging env)')
  } else {
    console.log('       configure your own deploy target')
  }
  console.log()
}
