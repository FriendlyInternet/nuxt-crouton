// Add crouton modules to a project
// Usage: crouton add bookings i18n --skip-migrations

import { execSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import consola from 'consola'

import { loadModules, getModule, listModules } from './module-registry.ts'
import { detectPackageManager, getInstallCommand } from './utils/detect-package-manager.ts'
import { addToNuxtConfigExtends, isInNuxtConfigExtends } from './utils/update-nuxt-config.ts'
import { addSchemaExport, getSchemaPath } from './utils/update-schema-index.ts'
import { generateMigrations, manualMigrationSteps } from './utils/generate-migrations.ts'

interface AddModuleOptions {
  skipInstall?: boolean
  skipMigrations?: boolean
  dryRun?: boolean
  force?: boolean
}

/**
 * Check if a package is installed
 */
async function isPackageInstalled(packageName: string, cwd: string = process.cwd()): Promise<boolean> {
  try {
    const packageJson = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf-8'))
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    }
    return packageName in deps
  } catch {
    return false
  }
}

/**
 * Check if required dependencies are installed
 */
async function checkDependencies(dependencies: string[], cwd: string = process.cwd()): Promise<{ missing: string[], installed: string[] }> {
  const missing: string[] = []
  const installed: string[] = []

  for (const dep of dependencies) {
    const module = await getModule(dep)
    if (!module) continue

    if (await isPackageInstalled(module.package, cwd)) {
      installed.push(dep)
    } else {
      missing.push(dep)
    }
  }

  return { missing, installed }
}

/**
 * Add a single module to the project
 */
export async function addModule(moduleName: string, options: AddModuleOptions = {}): Promise<{ success: boolean, message: string }> {
  const { skipInstall, skipMigrations, dryRun, force } = options
  const cwd = process.cwd()

  // Get module info
  const module = await getModule(moduleName)
  if (!module) {
    const available = (await listModules()).map(m => m.alias).join(', ')
    return {
      success: false,
      message: `Unknown module: ${moduleName}\nAvailable modules: ${available}`
    }
  }

  const packageName = module.package

  console.log()
  consola.info(`📦 Adding ${moduleName} (${packageName})`)
  console.log(`   ${module.description}`)
  console.log()

  if (dryRun) {
    consola.warn('   [DRY RUN] The following actions would be performed:')
  }

  // Check if already installed
  const alreadyInstalled = await isPackageInstalled(packageName, cwd)
  if (alreadyInstalled && !force) {
    const alreadyInConfig = await isInNuxtConfigExtends(join(cwd, 'nuxt.config.ts'), packageName)
    if (alreadyInConfig) {
      consola.warn(`   ⚠️  ${packageName} is already installed and configured`)
      console.log('   Use --force to reinstall')
      return { success: true, message: 'Already installed' }
    }
  }

  // Check dependencies
  if (module.dependencies && module.dependencies.length > 0) {
    const { missing } = await checkDependencies(module.dependencies, cwd)
    if (missing.length > 0) {
      consola.error(`   ❌ Missing required dependencies: ${missing.join(', ')}`)
      consola.warn(`   Run: crouton add ${missing.join(' ')} ${moduleName}`)
      return {
        success: false,
        message: `Missing dependencies: ${missing.join(', ')}`
      }
    }
  }

  // Step 1: Install package
  if (!skipInstall) {
    const pm = detectPackageManager(cwd)
    const installCmd = getInstallCommand(pm, packageName)

    if (dryRun) {
      console.log(`   • Would run: ${installCmd}`)
    } else {
      consola.start(`Installing ${packageName}...`)
      try {
        execSync(installCmd, { cwd, stdio: 'pipe' })
        consola.success(`Installed ${packageName}`)
      } catch (error) {
        consola.error(`Failed to install ${packageName}`)
        console.error(`   ${error.message}`)
        return { success: false, message: 'Installation failed' }
      }
    }
  } else {
    console.log('   • Skipping package installation')
  }

  // Step 2: Update nuxt.config.ts
  const configPath = join(cwd, 'nuxt.config.ts')
  if (dryRun) {
    console.log(`   • Would add '${packageName}' to extends in nuxt.config.ts`)
  } else {
    consola.start('Updating nuxt.config.ts...')
    const result = await addToNuxtConfigExtends(configPath, packageName)

    if (result.added) {
      consola.success('Updated nuxt.config.ts')
    } else if (result.reason === 'already in config') {
      consola.success('Already in nuxt.config.ts')
    } else {
      consola.error(`Could not update nuxt.config.ts: ${result.reason}`)
      consola.warn(`   Please manually add '${packageName}' to extends array`)
    }
  }

  // Step 3: Update schema index (if module has schema)
  if (module.schemaExport) {
    const schemaPath = await getSchemaPath(cwd)

    if (dryRun) {
      console.log(`   • Would add schema export to ${schemaPath}`)
    } else {
      consola.start('Updating schema index...')
      const result = await addSchemaExport(schemaPath, module.schemaExport)

      if (result.added) {
        if (result.created) {
          consola.success(`Created ${schemaPath} with schema export`)
        } else {
          consola.success('Added schema export')
        }
      } else if (result.reason === 'already exported') {
        consola.success('Schema already exported')
      } else {
        consola.error(`Could not update schema: ${result.reason}`)
      }
    }
  }

  // Step 4: Generate & apply migrations (if module has tables)
  if (!skipMigrations && module.schemaExport && module.tables && module.tables.length > 0) {
    if (dryRun) {
      console.log('   • Would run: db:generate (drizzle-kit, no Nuxt build)')
      console.log('   • Would run: npx nuxt db:migrate')
    } else {
      // Generate migrations directly — drizzle-kit resolves the schema from the
      // app's layer graph (no Nuxt process, #1445 WS2). A duplicate-table clash
      // throws (propagates non-zero); an unresolvable layer defers with a recipe.
      const genResult = await generateMigrations(cwd)
      const migrationsGenerated = genResult.generated
      if (!genResult.generated) {
        consola.warn(`Could not generate migrations (${genResult.reason})`)
        if (genResult.reason === 'generate-failed' && genResult.detail) console.log(`   ${genResult.detail}`)
        console.log('   Run manually when ready:')
        for (const step of manualMigrationSteps()) console.log(`     ${step}`)
      }

      // Apply migrations (only if we actually generated some)
      if (!migrationsGenerated) {
        console.log('   • Skipping migrate (no migrations generated)')
      } else {
        consola.start('Applying migrations...')
        try {
          const migrateResult = spawnSync('npx', ['nuxt', 'db:migrate'], {
            cwd,
            stdio: 'pipe',
            encoding: 'utf-8'
          })

          if (migrateResult.status !== 0) {
            consola.warn('Migration application may have issues')
            if (migrateResult.stderr) {
              console.log(`   ${migrateResult.stderr.trim()}`)
            }
          } else {
            consola.success('Applied migrations')
          }
        } catch (error) {
          consola.warn('Could not apply migrations')
          console.log(`   ${error.message}`)
        }
      }
    }
  } else if (module.schemaExport) {
    console.log('   • Skipping migrations (build the schema bundle, then run db:generate && db:migrate when ready)')
  }

  // Success message
  console.log()
  consola.success(`✅ ${moduleName} module added successfully!`)

  if (module.tables && module.tables.length > 0) {
    console.log(`   Tables: ${module.tables.join(', ')}`)
  }

  console.log()
  consola.info('Next steps:')
  console.log('  1. Restart your dev server: pnpm dev')

  // Module-specific hints
  if (moduleName === 'auth') {
    console.log('  2. Set BETTER_AUTH_SECRET and BETTER_AUTH_URL in .env')
    console.log('  3. Configure OAuth providers if needed')
  } else if (moduleName === 'i18n') {
    console.log('  2. Configure locales in nuxt.config.ts')
  } else if (moduleName === 'bookings') {
    console.log('  2. Generate booking collections with crouton config')
  } else if (moduleName === 'assets') {
    console.log('  2. Enable hub.blob in nuxt.config.ts')
    console.log('  3. Generate assets collection with crouton config')
  }

  return { success: true, message: 'Module added successfully' }
}

/**
 * Add multiple modules to the project
 */
export async function addModules(moduleNames: string[], options: AddModuleOptions = {}): Promise<{ success: boolean, results: Array<{ module: string, success: boolean, message: string }> }> {
  console.log('\n╔══════════════════════════════════════════════════╗')
  console.log('║          Crouton Module Installer                ║')
  console.log('╚══════════════════════════════════════════════════╝')

  const results: Array<{ module: string, success: boolean, message: string }> = []
  let allSuccess = true

  for (const moduleName of moduleNames) {
    const result = await addModule(moduleName, options)
    results.push({
      module: moduleName,
      success: result.success,
      message: result.message
    })

    if (!result.success) {
      allSuccess = false
    }
  }

  // Summary
  console.log('\n══════════════════════════════════════════════════')
  console.log(' Summary')
  console.log('══════════════════════════════════════════════════')

  for (const result of results) {
    const icon = result.success ? '✓' : '✗'
    console.log(`  ${icon} ${result.module}: ${result.message}`)
  }

  console.log()

  return { success: allSuccess, results }
}

/**
 * List all available modules
 */
export async function listAvailableModules(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════╗')
  console.log('║          Available Crouton Modules               ║')
  console.log('╚══════════════════════════════════════════════════╝\n')

  const modules = await listModules()

  for (const mod of modules) {
    const schemaIcon = mod.hasSchema ? '●' : '○'
    console.log(`  ${schemaIcon} ${mod.alias.padEnd(12)} ${mod.description}`)
  }

  console.log()
  console.log('  ● = Has database schema')
  console.log('  ○ = No database tables')
  console.log()
  consola.info('Usage:')
  console.log('  crouton add auth')
  console.log('  crouton add bookings i18n')
  console.log('  crouton add bookings --skip-migrations')
  console.log()
}
