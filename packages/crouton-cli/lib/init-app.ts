// init-app.ts — Orchestrate the full app creation pipeline:
// scaffold-app → generate → doctor → summary
import { join } from 'node:path'
import { access } from 'node:fs/promises'
import consola from 'consola'

import { generateMigrations, manualMigrationSteps } from './utils/generate-migrations.ts'

interface InitAppOptions {
  features?: string[]
  theme?: string
  dialect?: string
  cf?: boolean
  domain?: string
  dryRun?: boolean
  /** Target directory for the app. Defaults to `apps/<name>`; pass `pocs/<name>` for a POC. */
  out?: string
}

/**
 * Run the full init pipeline: scaffold -> generate -> doctor -> summary.
 */
export async function initApp(name: string, options: InitAppOptions = {}): Promise<void> {
  const { features = [], theme, dialect = 'sqlite', cf = true, domain, dryRun = false, out } = options

  console.log(`\n  crouton init — creating ${name}${out ? ` in ${out}` : ''}\n`)

  // ── Step 1: scaffold-app ──────────────────────────────────────────────
  console.log('  Step 1/3 — Scaffolding app...\n')
  let appDir
  try {
    const { scaffoldApp } = await import('./scaffold-app.ts')
    const result = await scaffoldApp(name, { features, theme, dialect, cf, domain, dryRun, outDir: out })
    appDir = result.appDir
  } catch (error) {
    consola.error('Step 1/3 — Scaffold failed')
    throw error
  }

  if (dryRun) {
    consola.warn('Dry run — skipping generate and doctor.\n')
    return
  }

  // ── Step 2: generate (config-based) ───────────────────────────────────
  const configPath = join(appDir, 'crouton.config.js')
  const hasConfig = await access(configPath).then(() => true).catch(() => false)
  let collectionsGenerated = false

  if (hasConfig) {
    consola.start('Step 2/4 — Generating collections from config...')
    try {
      const { runConfig } = await import('./generate-collection.ts')
      process.chdir(appDir)
      await runConfig({ configPath })
      collectionsGenerated = true
      consola.success('Step 2/4 — Collections generated')
    } catch (error) {
      consola.warn('Step 2/4 — Generate skipped (no collections in config yet)')
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
    const result = await generateMigrations(appDir)
    if (result.generated) {
      consola.success('Step 3/4 — Migrations generated')
    } else if (result.reason === 'deps-missing') {
      needsManualMigrations = true
      consola.info('Step 3/4 — Migrations deferred (install deps first; see next steps)')
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
    const result = await doctor(appDir)
    consola.success('Step 4/4 — Doctor complete')
    printReport(result)
  } catch (error) {
    consola.warn('Step 4/4 — Doctor skipped (could not validate)')
  }

  // ── Summary ───────────────────────────────────────────────────────────
  printSummary(name, appDir, cf, needsManualMigrations)
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
