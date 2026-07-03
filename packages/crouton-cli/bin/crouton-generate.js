#!/usr/bin/env node

import { createJiti } from 'jiti'
import { defineCommand, runMain } from 'citty'
import consola from 'consola'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Use jiti to load TypeScript files with proper ESM named exports
const jiti = createJiti(import.meta.url)
async function tsImport(specifier) {
  const mod = await jiti.import(specifier)
  // Handle CJS default-export interop: if only `default` key, unwrap it
  if (mod && typeof mod === 'object' && 'default' in mod && Object.keys(mod).length === 1) {
    return mod.default
  }
  return mod
}

// Read version from package.json
const pkgPath = join(__dirname, '..', 'package.json')
const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))

// ─── Helper: detect crouton.config.{ts,js,mjs,cjs} ────────────────

function detectConfigFile() {
  const extensions = ['.ts', '.js', '.mjs', '.cjs']
  for (const ext of extensions) {
    const p = `./crouton.config${ext}`
    if (existsSync(p)) return p
  }
  return null
}

// ─── generate ──────────────────────────────────────────────────────

const generate = defineCommand({
  meta: { name: 'generate', description: 'Generate a CRUD collection' },
  args: {
    layer: { type: 'positional', description: 'Target layer', required: false },
    collection: { type: 'positional', description: 'Collection name', required: false },
    fieldsFile: { type: 'string', alias: 'f', description: 'Path to JSON schema file' },
    config: { type: 'string', alias: 'c', description: 'Use config file instead of CLI args' },
    dialect: { type: 'string', alias: 'd', description: 'Database dialect (sqlite|pg)', default: 'sqlite' },
    autoRelations: { type: 'boolean', description: 'Add relation stubs in comments' },
    dryRun: { type: 'boolean', description: 'Preview without writing' },
    noTranslations: { type: 'boolean', description: 'Skip translation fields' },
    force: { type: 'boolean', description: 'Force generation despite missing dependencies' },
    noDb: { type: 'boolean', description: 'Skip database table creation' },
    hierarchy: { type: 'boolean', description: 'Enable hierarchy support (parentId, path, depth, order)' },
    seed: { type: 'boolean', description: 'Generate seed data file using drizzle-seed' },
    count: { type: 'string', description: 'Number of seed records (default: 25)', default: '25' },
    tests: { type: 'boolean', description: 'Generate a per-collection schema-smoke test (use --no-tests to skip)', default: true },
    noAutoMerge: { type: 'boolean', description: 'Skip auto-merging package collections from manifests' },
  },
  async run({ args }) {
    // If --config is provided, delegate to config mode
    if (args.config) {
      const { runConfig } = await tsImport(join(__dirname, '..', 'lib', 'generate-collection.ts'))
      await runConfig({
        configPath: args.config,
        force: args.force,
        dryRun: args.dryRun,
        noTests: args.tests === false,
        noAutoMerge: args.noAutoMerge,
      })
      return
    }

    // Auto-detect config file if no layer/collection provided
    if (!args.layer && !args.collection) {
      const configPath = detectConfigFile()
      if (configPath) {
        const { runConfig } = await tsImport(join(__dirname, '..', 'lib', 'generate-collection.ts'))
        await runConfig({
          configPath,
          force: args.force,
          dryRun: args.dryRun,
          noTests: args.tests === false,
          noAutoMerge: args.noAutoMerge,
        })
        return
      }
      consola.error('No crouton.config.js found in current directory')
      console.log('\nTo generate collections, either:')
      console.log('  1. Create a crouton.config.js file in this directory')
      console.log('  2. Use explicit arguments: crouton generate <layer> <collection> --fields-file=schema.json')
      process.exit(1)
    }

    // Validate both layer and collection are provided
    if (!args.layer || !args.collection) {
      consola.error('Both layer and collection are required')
      console.log('\nUsage: crouton generate <layer> <collection> --fields-file=schema.json')
      console.log('   Or: crouton generate (auto-detects crouton.config.js)')
      process.exit(1)
    }

    const { runGenerate } = await tsImport(join(__dirname, '..', 'lib', 'generate-collection.ts'))
    await runGenerate({
      layer: args.layer,
      collection: args.collection,
      fieldsFile: args.fieldsFile,
      dialect: args.dialect || 'sqlite',
      autoRelations: args.autoRelations,
      dryRun: args.dryRun,
      noDb: args.noDb,
      force: args.force,
      noTranslations: args.noTranslations,
      hierarchy: args.hierarchy,
      seed: args.seed,
      seedCount: parseInt(args.count || '25', 10),
      noTests: args.tests === false,
    })
  }
})

// ─── config ────────────────────────────────────────────────────────

const configCmd = defineCommand({
  meta: { name: 'config', description: 'Generate collections using a config file' },
  args: {
    configPath: { type: 'positional', description: 'Config file path', required: false },
    only: { type: 'string', description: 'Generate only a specific collection' },
    dryRun: { type: 'boolean', description: 'Preview without writing' },
    force: { type: 'boolean', description: 'Force generation' },
    tests: { type: 'boolean', description: 'Generate per-collection schema-smoke tests (use --no-tests to skip)', default: true },
    noAutoMerge: { type: 'boolean', description: 'Skip auto-merging package collections' },
  },
  async run({ args }) {
    let configPath = args.configPath
    if (!configPath) {
      configPath = detectConfigFile()
      if (!configPath) configPath = './crouton.config.js'
    }

    const { runConfig } = await tsImport(join(__dirname, '..', 'lib', 'generate-collection.ts'))
    await runConfig({
      configPath,
      force: args.force,
      dryRun: args.dryRun,
      only: args.only,
      noTests: args.tests === false,
      noAutoMerge: args.noAutoMerge,
    })
  }
})

// ─── install ───────────────────────────────────────────────────────

const installCmd = defineCommand({
  meta: { name: 'install', description: 'Install required Nuxt modules' },
  args: {},
  async run() {
    const installModulesPath = join(__dirname, '..', 'lib', 'install-modules.ts')
    if (!existsSync(installModulesPath)) {
      consola.error('Install script not found')
      console.log('Please install modules manually:')
      console.log('  pnpm add @fyit/crouton')
      process.exit(1)
    }
    // install-modules.ts is self-executing on import
    await tsImport(installModulesPath)
  }
})

// ─── init ──────────────────────────────────────────────────────────

const initCmd = defineCommand({
  meta: { name: 'init', description: 'Create a new crouton app end-to-end (scaffold → generate → doctor → summary)' },
  args: {
    name: { type: 'positional', description: 'App name', required: true },
    features: { type: 'string', description: 'Comma-separated feature names (e.g., bookings,pages,editor)', default: '' },
    theme: { type: 'string', description: 'Theme to wire into extends (e.g., ko)' },
    dialect: { type: 'string', alias: 'd', description: 'Database dialect (sqlite or pg)', default: 'sqlite' },
    noCf: { type: 'boolean', description: 'Skip Cloudflare-specific config (wrangler.jsonc, CF stubs)' },
    domain: { type: 'string', description: 'Cloudflare zone for custom-domain routes (e.g. pmcp.dev → <app>.pmcp.dev / <app>-preview.pmcp.dev)' },
    dryRun: { type: 'boolean', description: 'Preview what will be generated without writing files' },
  },
  async run({ args }) {
    const initPath = join(__dirname, '..', 'lib', 'init-app.ts')
    const { initApp } = await tsImport(initPath)

    const features = args.features
      ? args.features.split(',').map(f => f.trim()).filter(Boolean)
      : []

    await initApp(args.name, {
      features,
      theme: args.theme,
      dialect: args.dialect,
      cf: !args.noCf,
      domain: args.domain,
      dryRun: args.dryRun,
    })
  }
})

// ─── add ───────────────────────────────────────────────────────────

const addCmd = defineCommand({
  meta: { name: 'add', description: 'Add Crouton modules or features to your project' },
  args: {
    skipMigrations: { type: 'boolean', description: 'Skip migration generation and application' },
    skipInstall: { type: 'boolean', description: 'Skip package installation (assume already installed)' },
    dryRun: { type: 'boolean', description: 'Preview what will be done without making changes' },
    force: { type: 'boolean', description: 'Force reinstall even if already installed' },
    list: { type: 'boolean', description: 'List all available modules' },
  },
  async run({ args, rawArgs }) {
    // Extract module names from rawArgs (non-flag args after the subcommand)
    const items = rawArgs.filter(a => !a.startsWith('-'))

    // Handle --list flag or no items
    if (args.list || items.length === 0) {
      const addModulePath = join(__dirname, '..', 'lib', 'add-module.ts')
      const { listAvailableModules } = await tsImport(addModulePath)
      await listAvailableModules()
      return
    }

    // Import module registry to check if items are modules
    const registryPath = join(__dirname, '..', 'lib', 'module-registry.ts')
    const { getModule } = await tsImport(registryPath)

    // Separate modules from features
    const modules = []
    const features = []

    for (const item of items) {
      if (await getModule(item)) {
        modules.push(item)
      } else if (item === 'events') {
        features.push(item)
      } else {
        modules.push(item)
      }
    }

    // Add modules if any
    if (modules.length > 0) {
      const addModulePath = join(__dirname, '..', 'lib', 'add-module.ts')
      const { addModules } = await tsImport(addModulePath)

      const result = await addModules(modules, {
        skipInstall: args.skipInstall,
        skipMigrations: args.skipMigrations,
        dryRun: args.dryRun,
        force: args.force,
      })

      if (!result.success) {
        process.exit(1)
      }
    }

    // Add features if any
    for (const feature of features) {
      if (feature === 'events') {
        const addEventsPath = join(__dirname, '..', 'lib', 'add-events.ts')
        if (!existsSync(addEventsPath)) {
          consola.error('add-events script not found. Please ensure the package is properly installed.')
          process.exit(1)
        }
        const { addEvents } = await tsImport(addEventsPath)
        await addEvents({ dryRun: args.dryRun, force: args.force })
      }
    }
  }
})

// ─── rollback ──────────────────────────────────────────────────────

const rollbackCmd = defineCommand({
  meta: { name: 'rollback', description: 'Rollback/remove a generated collection' },
  args: {
    layer: { type: 'positional', description: 'Layer name', required: true },
    collection: { type: 'positional', description: 'Collection name', required: true },
    dryRun: { type: 'boolean', description: 'Preview what will be removed' },
    keepFiles: { type: 'boolean', description: 'Keep generated files, only clean configs' },
    force: { type: 'boolean', description: 'Skip confirmation prompts' },
  },
  async run({ args }) {
    const { rollbackCollection, checkForCollectionFiles } = await tsImport(
      join(__dirname, '..', 'lib', 'rollback-collection.ts')
    )

    const { exists } = await checkForCollectionFiles(args.layer, args.collection)
    if (!exists) {
      consola.warn(`Collection not found at layers/${args.layer}/collections/${args.collection}`)
      return
    }

    await rollbackCollection({
      layer: args.layer,
      collection: args.collection,
      dryRun: args.dryRun,
      keepFiles: args.keepFiles,
      force: args.force,
    })
  }
})

// ─── rollback-bulk ─────────────────────────────────────────────────

const rollbackBulkCmd = defineCommand({
  meta: { name: 'rollback-bulk', description: 'Bulk rollback operations (layer, config, or multiple collections)' },
  args: {
    layer: { type: 'string', description: 'Rollback entire layer' },
    config: { type: 'string', description: 'Rollback using config file' },
    dryRun: { type: 'boolean', description: 'Preview what will be removed' },
    keepFiles: { type: 'boolean', description: 'Keep generated files, only clean configs' },
    force: { type: 'boolean', description: 'Skip confirmation prompts' },
  },
  async run({ args }) {
    if (!args.layer && !args.config) {
      consola.error('Must specify either --layer or --config')
      console.log('\nExamples:')
      console.log('  crouton rollback-bulk --layer=shop')
      console.log('  crouton rollback-bulk --config=./crouton.config.js')
      process.exit(1)
    }

    const { rollbackLayer, rollbackFromConfig } = await tsImport(
      join(__dirname, '..', 'lib', 'rollback-bulk.ts')
    )

    if (args.layer) {
      await rollbackLayer({
        layer: args.layer,
        dryRun: args.dryRun,
        keepFiles: args.keepFiles,
        force: args.force,
      })
    } else if (args.config) {
      await rollbackFromConfig({
        configPath: args.config,
        dryRun: args.dryRun,
        keepFiles: args.keepFiles,
        force: args.force,
      })
    }
  }
})

// ─── rollback-interactive ──────────────────────────────────────────

const rollbackInteractiveCmd = defineCommand({
  meta: { name: 'rollback-interactive', description: 'Interactive rollback with selection UI' },
  args: {
    dryRun: { type: 'boolean', description: 'Preview what will be removed' },
    keepFiles: { type: 'boolean', description: 'Keep generated files, only clean configs' },
  },
  async run({ args }) {
    const { interactiveRollback } = await tsImport(
      join(__dirname, '..', 'lib', 'rollback-interactive.ts')
    )
    await interactiveRollback({ dryRun: args.dryRun, keepFiles: args.keepFiles })
  }
})

// ─── doctor ────────────────────────────────────────────────────────

const doctorCmd = defineCommand({
  meta: { name: 'doctor', description: 'Validate an existing crouton app (checks deps, wrangler, stubs, schema)' },
  args: {
    dir: { type: 'positional', description: 'App directory to check', required: false },
  },
  async run({ args }) {
    const doctorPath = join(__dirname, '..', 'lib', 'doctor.ts')
    const { doctor, printReport } = await tsImport(doctorPath)

    const appDir = args.dir || process.cwd()
    const result = await doctor(appDir)
    printReport(result)

    if (!result.ok) {
      process.exit(1)
    }
  }
})

// ─── scaffold-app ──────────────────────────────────────────────────

const scaffoldAppCmd = defineCommand({
  meta: { name: 'scaffold-app', description: 'Create a new crouton app with all boilerplate files' },
  args: {
    name: { type: 'positional', description: 'App name', required: true },
    features: { type: 'string', description: 'Comma-separated feature names (e.g., bookings,pages,editor)', default: '' },
    theme: { type: 'string', description: 'Theme to wire into extends (e.g., ko)' },
    dialect: { type: 'string', alias: 'd', description: 'Database dialect (sqlite or pg)', default: 'sqlite' },
    noCf: { type: 'boolean', description: 'Skip Cloudflare-specific config (wrangler.jsonc, CF stubs)' },
    domain: { type: 'string', description: 'Cloudflare zone for custom-domain routes (e.g. pmcp.dev → <app>.pmcp.dev / <app>-preview.pmcp.dev)' },
    dryRun: { type: 'boolean', description: 'Preview what will be generated without writing files' },
  },
  async run({ args }) {
    const scaffoldPath = join(__dirname, '..', 'lib', 'scaffold-app.ts')
    const { scaffoldApp } = await tsImport(scaffoldPath)

    const features = args.features
      ? args.features.split(',').map(f => f.trim()).filter(Boolean)
      : []

    await scaffoldApp(args.name, {
      features,
      theme: args.theme,
      dialect: args.dialect,
      cf: !args.noCf,
      domain: args.domain,
      dryRun: args.dryRun,
    })
  }
})

// ─── seed-translations ─────────────────────────────────────────────

const seedTranslationsCmd = defineCommand({
  meta: { name: 'seed-translations', description: 'Seed translations from JSON locale files to database' },
  args: {
    layer: { type: 'string', description: 'Seed from specific layer only' },
    team: { type: 'string', description: 'Team ID/slug to seed to (default: system)' },
    dryRun: { type: 'boolean', description: 'Preview translations without seeding' },
    force: { type: 'boolean', description: 'Overwrite existing translations' },
    apiUrl: { type: 'string', description: 'API base URL (default: http://localhost:3000)' },
    sql: { type: 'boolean', description: 'Output SQL statements instead of using API' },
  },
  async run({ args }) {
    const seedPath = join(__dirname, '..', 'lib', 'seed-translations.ts')
    if (!existsSync(seedPath)) {
      consola.error('Seed translations script not found. Please ensure the package is properly installed.')
      process.exit(1)
    }

    const { seedTranslationsFromJson } = await tsImport(seedPath)
    await seedTranslationsFromJson({
      layer: args.layer,
      team: args.team,
      dryRun: args.dryRun,
      force: args.force,
      apiUrl: args.apiUrl,
      sql: args.sql,
    })
  }
})

// ─── db-pull ────────────────────────────────────────────────────

const dbPullCmd = defineCommand({
  meta: { name: 'db-pull', description: 'Pull remote D1 database into local dev' },
  args: {
    env: { type: 'string', description: 'Wrangler environment (e.g., preview for staging)' },
    config: { type: 'string', description: 'Custom wrangler config path' },
    keepSql: { type: 'boolean', description: 'Keep the exported SQL file after import' },
    dryRun: { type: 'boolean', description: 'Show what would happen without executing' },
  },
  async run({ args }) {
    const { dbPull } = await tsImport(join(__dirname, '..', 'lib', 'db-pull.ts'))
    await dbPull({
      env: args.env,
      config: args.config,
      keepSql: args.keepSql,
      dryRun: args.dryRun,
    })
  }
})

// ─── deploy-setup ─────────────────────────────────────────────────

// Retired (#1137): this command set up the Cloudflare PAGES deploy the crouton
// standard migrated away from (Workers + auto-provisioning, #108/#114). A fresh
// `crouton init` already ships the Workers setup; a second scaffold path is drift.
const deploySetupCmd = defineCommand({
  meta: { name: 'deploy-setup', description: '(deprecated) Cloudflare Pages setup — retired; use `crouton init` (Workers) instead' },
  async run() {
    console.error('crouton deploy-setup is retired: it set up the deprecated Cloudflare Pages deploy.')
    console.error('The Workers deploy needs no setup command — a fresh `crouton init` app ships the')
    console.error('id-less wrangler.jsonc + cf:deploy/cf:staging scripts, and the first deploy')
    console.error('auto-provisions D1/KV. See the deployment guide: https://nuxt-crouton.dev/guides/deployment')
    process.exit(1)
  }
})

// ─── deploy-check ─────────────────────────────────────────────────

const deployCheckCmd = defineCommand({
  meta: { name: 'deploy-check', description: 'Validate deployment readiness (wrangler config, CI workflow, bindings)' },
  args: {
    dir: { type: 'positional', description: 'App directory to check', required: false },
  },
  async run({ args }) {
    const { deployCheck, printDeployReport } = await tsImport(join(__dirname, '..', 'lib', 'deploy-check.ts'))
    const appDir = args.dir || process.cwd()
    const result = await deployCheck(appDir)
    printDeployReport(result)
    if (!result.ok) process.exit(1)
  }
})

// ─── main ──────────────────────────────────────────────────────────

const main = defineCommand({
  meta: {
    name: 'crouton',
    version: pkg.version || '0.1.0',
    description: 'Generate CRUD collections for Nuxt Crouton',
  },
  subCommands: {
    generate,
    config: configCmd,
    install: installCmd,
    init: initCmd,
    add: addCmd,
    rollback: rollbackCmd,
    'rollback-bulk': rollbackBulkCmd,
    'rollback-interactive': rollbackInteractiveCmd,
    doctor: doctorCmd,
    'deploy-setup': deploySetupCmd,
    'deploy-check': deployCheckCmd,
    'scaffold-app': scaffoldAppCmd,
    'seed-translations': seedTranslationsCmd,
    'db-pull': dbPullCmd,
  },
})

runMain(main)
