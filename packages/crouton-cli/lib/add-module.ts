// Add crouton modules to a project
// Usage: crouton add bookings i18n

import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import consola from 'consola'

import { getModule, listModules } from './module-registry.ts'
import { detectPackageManager, getInstallCommand } from './utils/detect-package-manager.ts'
import { addToNuxtConfigExtends, isInNuxtConfigExtends } from './utils/update-nuxt-config.ts'
import { manualMigrationSteps } from './utils/generate-migrations.ts'
import { findPackagesDir } from './utils/manifest-loader.ts'

interface AddModuleOptions {
  skipInstall?: boolean
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

const SCHEMA_DIRS = ['server/database/schema', 'server/db/schema']
const SCHEMA_FILE = 'server/db/schema.ts'

/**
 * True when a package directory ships at least one Drizzle schema file —
 * the single file `server/db/schema.ts` (which NuxtHub picks up on its own,
 * e.g. crouton-flow / crouton-printing), or a `.ts` file in
 * `server/database/schema/` or `server/db/schema/` (test files and
 * `__tests__` folders not counted).
 */
export function shipsSchemaFiles(packageDir: string): boolean {
  const hasTs = (dir: string): boolean => {
    if (!existsSync(dir)) return false
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && hasTs(join(dir, entry.name))) return true
      } else if (entry.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(entry.name)) {
        return true
      }
    }
    return false
  }
  if (existsSync(join(packageDir, SCHEMA_FILE))) return true
  return SCHEMA_DIRS.some(d => hasTs(join(packageDir, d)))
}

/**
 * Does this package bring database tables? Yes when its manifest lists
 * collections (`hasSchema`) or it ships a schema folder (e.g. crouton-layout
 * has `layoutConfigs.ts` but no collections). The package is looked up where
 * manifest discovery looks: `node_modules/<pkg>` in the app, then the
 * monorepo `packages/` dir.
 */
export async function packageHasTables(module: Record<string, any>, cwd: string = process.cwd()): Promise<boolean> {
  if (module.hasSchema) return true
  const packageName: string = module.package
  const candidates = [join(cwd, 'node_modules', packageName)]
  const packagesDir = await findPackagesDir(cwd)
  if (packagesDir) candidates.push(join(packagesDir, packageName.split('/').pop()!))
  return candidates.some(dir => existsSync(dir) && shipsSchemaFiles(dir))
}

/**
 * Add a single module to the project
 */
export async function addModule(moduleName: string, options: AddModuleOptions = {}): Promise<{ success: boolean, message: string }> {
  const { skipInstall, dryRun, force } = options
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

  // Step 3: Tell the user how to create the package's tables (#3998).
  // `crouton add` does not create them itself — it prints the commands.
  // "Has tables" = manifest collections OR a shipped schema folder.
  if (await packageHasTables(module, cwd)) {
    console.log('   • This package has database tables — crouton add does not create them. Run next:')
    for (const step of manualMigrationSteps()) console.log(`     ${step}`)
  }

  // Success message
  console.log()
  consola.success(`✅ ${moduleName} module added successfully!`)

  console.log()
  consola.info('Next steps:')
  console.log('  1. Restart your dev server: pnpm dev')

  // Module-specific hints
  if (moduleName === 'auth') {
    console.log('  2. Set BETTER_AUTH_SECRET and BETTER_AUTH_URL in .env')
    console.log('  3. Configure OAuth providers if needed')
  } else if (moduleName === 'i18n') {
    console.log('  2. Configure locales in nuxt.config.ts')
  } else if (moduleName === 'assets') {
    console.log('  2. Enable hub.blob in nuxt.config.ts')
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
  console.log()
}
