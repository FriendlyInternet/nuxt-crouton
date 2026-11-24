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
 * What init's step 2 (generate) and step 3 (migrations) report (#4377). "No collections"
 * is said only when the config really has none; a thrown error is reported as a failure.
 */
export function describeGenerateStep({ collectionCount, error }: { collectionCount: number, error?: unknown }): { generated: boolean, step2: string, step3: string } {
  if (collectionCount === 0) {
    return { generated: false, step2: 'Step 2/4 — Generate skipped (no collections in config yet)', step3: 'Step 3/4 — No collections generated, skipping migrations' }
  }
  if (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      generated: false,
      step2: `Step 2/4 — Generate failed (${collectionCount} collections): ${message}`,
      step3: 'Step 3/4 — Generate failed — skipping migrations (fix the error above, then run `crouton config` and `pnpm db:generate`)'
    }
  }
  return { generated: true, step2: 'Step 2/4 — Collections generated', step3: '' }
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
  const { migrate: collectionsGenerated, step3Skip } = await runGenerateStep(appPath)

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
    if (step3Skip.includes('Generate failed')) consola.warn(step3Skip)
    else console.log(`  ${step3Skip}`)
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

/**
 * Step 2: generate from the app's crouton.config.js. Returns whether migrations should run
 * and the step-3 line to print when they don't (#4377).
 */
async function runGenerateStep(appPath: string): Promise<{ migrate: boolean, step3Skip: string }> {
  const configPath = join(appPath, 'crouton.config.js')
  if (!await access(configPath).then(() => true).catch(() => false)) {
    console.log('  Step 2/4 — No crouton.config.js found, skipping generate')
    return { migrate: false, step3Skip: 'Step 3/4 — No collections generated, skipping migrations' }
  }
  consola.start('Step 2/4 — Generating collections from config...')
  const { loadCroutonConfig } = await import('./doctor.ts')
  const config = await loadCroutonConfig(appPath)
  const collectionCount = Array.isArray(config?.collections) ? config!.collections.length : 0
  const error = await runConfigInApp(appPath, configPath)
  const step = describeGenerateStep({ collectionCount, error })
  if (step.generated) consola.success(step.step2)
  else consola.warn(step.step2)
  // A config with no collections still migrates the base schema (auth, translations-ui)
  // when generate ran cleanly (#523) — only a thrown error skips migrations.
  return { migrate: !error, step3Skip: step.step3 }
}

/** Run generate from inside the app (generated files land in cwd); the thrown error, if any. */
async function runConfigInApp(appPath: string, configPath: string): Promise<unknown> {
  const callerCwd = process.cwd()
  try {
    const { runConfig } = await import('./generate-collection.ts')
    process.chdir(appPath)
    await runConfig({ configPath })
    return undefined
  } catch (e) {
    return e ?? new Error('unknown error')
  } finally {
    process.chdir(callerCwd)
  }
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
