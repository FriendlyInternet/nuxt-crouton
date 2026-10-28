#!/usr/bin/env node
// rollback-bulk.mjs — Bulk rollback operations for layers and config files

import path from 'node:path'
import consola from 'consola'
import { confirm, isCancel } from '@clack/prompts'

// Import utilities
import { rollbackCollection, fileExists, cleanRootNuxtConfig } from './rollback-collection.ts'
import { getAllCollectionsInLayer, getAllLayers } from './utils/layer-discovery.ts'

/**
 * Ask before a destructive rollback. Never proceeds unattended: a closed or
 * non-TTY stdin aborts (pass --force to skip), instead of timing out into a delete.
 */
async function confirmRollback(warning: string, question: string): Promise<boolean> {
  consola.error(warning)
  consola.warn('Run with --dry-run to preview changes first')

  if (!process.stdin.isTTY) {
    consola.error('Not an interactive terminal — aborting. Re-run with --force to confirm.')
    return false
  }

  const ok = await confirm({ message: question, initialValue: false })
  if (isCancel(ok) || !ok) {
    consola.info('Aborted — nothing removed.')
    return false
  }
  return true
}

export async function rollbackLayer({ layer, dryRun = false, keepFiles = false, force = false }: { layer: string; dryRun?: boolean; keepFiles?: boolean; force?: boolean }): Promise<boolean> {
  console.log('\n' + '═'.repeat(60))
  console.log(`  LAYER ROLLBACK: ${layer}`)
  console.log('═'.repeat(60) + '\n')

  // Get all collections in this layer
  const collections = await getAllCollectionsInLayer(layer)

  if (collections.length === 0) {
    consola.error(`No collections found in layer "${layer}"`)
    return false
  }

  consola.info(`Found ${collections.length} collections in layer "${layer}":`)
  collections.forEach(col => console.log(`  • ${col}`))

  // Show what will be removed
  console.log('\n' + '─'.repeat(60))
  console.log('  IMPACT ASSESSMENT')
  console.log('─'.repeat(60) + '\n')

  consola.warn(`This will remove:`)
  console.log(`  • ${collections.length} collections`)
  if (!keepFiles) {
    console.log(`  • All collection files in layers/${layer}/collections/`)
  }
  console.log(`  • Schema index exports for all collections`)
  console.log(`  • app.config.ts entries for all collections`)
  console.log(`  • Layer "${layer}" from root nuxt.config.ts`)

  // Confirmation prompt (unless force or dry-run)
  if (!force && !dryRun
    && !await confirmRollback('⚠️  WARNING: This will remove ALL collections in this layer!', `Remove ALL ${collections.length} collections in layer "${layer}"?`)) {
    return false
  }

  console.log('\n' + '─'.repeat(60))
  console.log('  EXECUTING BULK ROLLBACK')
  console.log('─'.repeat(60) + '\n')

  let totalChangesMade = false

  // Rollback each collection
  for (let i = 0; i < collections.length; i++) {
    const collection = collections[i]
    console.log(`\n[${i + 1}/${collections.length}] ${collection}`)

    const changesMade = await rollbackCollection({
      layer,
      collection,
      dryRun,
      keepFiles,
      silent: true
    })

    if (changesMade) {
      totalChangesMade = true
      consola.success(`Rolled back ${collection}`)
    } else {
      console.log(`  ! No changes for ${collection}`)
    }
  }

  // Remove layer from root config
  console.log('\n' + '─'.repeat(60))
  console.log('  CLEANING ROOT CONFIG')
  console.log('─'.repeat(60) + '\n')

  if (await cleanRootNuxtConfig(layer, dryRun, true)) {
    totalChangesMade = true
  }

  // Summary
  console.log('\n' + '═'.repeat(60))
  if (dryRun) {
    console.log('  DRY RUN COMPLETE')
    console.log('═'.repeat(60) + '\n')
    consola.warn('No changes were made. Run without --dry-run to execute.')
  } else {
    console.log('  BULK ROLLBACK COMPLETE')
    console.log('═'.repeat(60) + '\n')

    if (totalChangesMade) {
      consola.success(`Successfully rolled back ${collections.length} collections from layer "${layer}"`)
      consola.warn('\n⚠️  Next steps:')
      console.log('  1. Run: pnpm db:generate (to update database schema)')
      console.log('  2. Restart your Nuxt dev server')
    } else {
      consola.warn('No changes were made')
    }
  }

  console.log()
  return totalChangesMade
}

export async function rollbackFromConfig({ configPath, dryRun = false, keepFiles = false, force = false }: { configPath: string; dryRun?: boolean; keepFiles?: boolean; force?: boolean }): Promise<boolean> {
  console.log('\n' + '═'.repeat(60))
  console.log('  CONFIG-BASED ROLLBACK')
  console.log('═'.repeat(60) + '\n')

  consola.info(`Config file: ${configPath}`)

  // Load config file
  const resolvedPath = path.resolve(configPath)

  if (!await fileExists(resolvedPath)) {
    throw new Error(`Config file not found: ${configPath}`)
  }

  let config: Record<string, any>
  try {
    config = (await import(resolvedPath)).default
  } catch (error) {
    throw new Error(`Error loading config: ${error.message}`, { cause: error })
  }

  if (!config || !config.targets) {
    throw new Error('Invalid config: missing targets')
  }

  // Count total collections
  let totalCollections = 0
  const layerCollectionMap: Record<string, string[]> = {}

  for (const target of config.targets) {
    if (!target.layer || !target.collections) continue

    layerCollectionMap[target.layer] = target.collections
    totalCollections += target.collections.length
  }

  consola.success(`Found ${config.targets.length} layers, ${totalCollections} collections`)

  // Show what will be removed
  console.log('\n' + '─'.repeat(60))
  console.log('  COLLECTIONS TO ROLLBACK')
  console.log('─'.repeat(60) + '\n')

  for (const [layer, collections] of Object.entries(layerCollectionMap)) {
    consola.info(`${layer}:`)
    collections.forEach(col => console.log(`  • ${col}`))
  }

  console.log('\n' + '─'.repeat(60))
  console.log('  IMPACT ASSESSMENT')
  console.log('─'.repeat(60) + '\n')

  consola.warn(`This will remove:`)
  console.log(`  • ${totalCollections} collections across ${config.targets.length} layers`)
  if (!keepFiles) {
    console.log(`  • All collection files`)
  }
  console.log(`  • All schema index exports`)
  console.log(`  • All app.config.ts entries`)
  console.log(`  • All affected layers from root nuxt.config.ts`)

  // Confirmation prompt (unless force or dry-run)
  if (!force && !dryRun
    && !await confirmRollback('⚠️  WARNING: This will remove ALL collections defined in this config!', 'Remove ALL collections defined in this config?')) {
    return false
  }

  console.log('\n' + '─'.repeat(60))
  console.log('  EXECUTING CONFIG-BASED ROLLBACK')
  console.log('─'.repeat(60) + '\n')

  let totalChangesMade = false
  let processedCount = 0

  // Process each target
  for (const target of config.targets) {
    if (!target.layer || !target.collections) continue

    console.log(`\n${'═'.repeat(60)}`)
    console.log(`  LAYER: ${target.layer}`)
    console.log('═'.repeat(60))

    for (const collection of target.collections) {
      processedCount++
      console.log(`\n[${processedCount}/${totalCollections}] ${target.layer}/${collection}`)

      const changesMade = await rollbackCollection({
        layer: target.layer,
        collection,
        dryRun,
        keepFiles,
        silent: true
      })

      if (changesMade) {
        totalChangesMade = true
        consola.success(`Rolled back ${collection}`)
      } else {
        console.log(`  ! No changes for ${collection}`)
      }
    }

    // Clean up layer from root config
    console.log('\n  Checking root config...')
    await cleanRootNuxtConfig(target.layer, dryRun, true)
  }

  // Summary
  console.log('\n' + '═'.repeat(60))
  if (dryRun) {
    console.log('  DRY RUN COMPLETE')
    console.log('═'.repeat(60) + '\n')
    consola.warn('No changes were made. Run without --dry-run to execute.')
  } else {
    console.log('  CONFIG-BASED ROLLBACK COMPLETE')
    console.log('═'.repeat(60) + '\n')

    if (totalChangesMade) {
      consola.success(`Successfully rolled back ${totalCollections} collections`)
      consola.warn('\n⚠️  Next steps:')
      console.log('  1. Run: pnpm db:generate (to update database schema)')
      console.log('  2. Restart your Nuxt dev server')
    } else {
      consola.warn('No changes were made')
    }
  }

  console.log()
  return totalChangesMade
}

export async function rollbackMultiple({ layer, collections, dryRun = false, keepFiles = false, force = false }: { layer: string; collections: string[]; dryRun?: boolean; keepFiles?: boolean; force?: boolean }): Promise<boolean> {
  console.log('\n' + '═'.repeat(60))
  console.log('  MULTIPLE COLLECTION ROLLBACK')
  console.log('═'.repeat(60) + '\n')

  consola.info(`Layer: ${layer}`)
  consola.info(`Collections: ${collections.join(', ')}`)

  // Show what will be removed
  console.log('\n' + '─'.repeat(60))
  console.log('  IMPACT ASSESSMENT')
  console.log('─'.repeat(60) + '\n')

  consola.warn(`This will remove ${collections.length} collections:`)
  collections.forEach(col => console.log(`  • ${col}`))

  // Confirmation prompt (unless force or dry-run)
  if (!force && !dryRun
    && !await confirmRollback('⚠️  WARNING: This will remove multiple collections!', 'Remove these collections?')) {
    return false
  }

  console.log('\n' + '─'.repeat(60))
  console.log('  EXECUTING ROLLBACK')
  console.log('─'.repeat(60) + '\n')

  let totalChangesMade = false

  // Rollback each collection
  for (let i = 0; i < collections.length; i++) {
    const collection = collections[i]
    console.log(`\n[${i + 1}/${collections.length}] ${collection}`)

    const changesMade = await rollbackCollection({
      layer,
      collection,
      dryRun,
      keepFiles,
      silent: true
    })

    if (changesMade) {
      totalChangesMade = true
      consola.success(`Rolled back ${collection}`)
    } else {
      console.log(`  ! No changes for ${collection}`)
    }
  }

  // Check if layer should be removed from root config
  const layerCollectionsPath = path.resolve('layers', layer, 'collections')
  if (await fileExists(layerCollectionsPath)) {
    const remainingCollections = await getAllCollectionsInLayer(layer)
    if (remainingCollections.length === 0) {
      console.log('\n' + '─'.repeat(60))
      console.log('  CLEANING ROOT CONFIG')
      console.log('─'.repeat(60) + '\n')
      await cleanRootNuxtConfig(layer, dryRun, true)
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60))
  if (dryRun) {
    console.log('  DRY RUN COMPLETE')
    console.log('═'.repeat(60) + '\n')
    consola.warn('No changes were made. Run without --dry-run to execute.')
  } else {
    console.log('  ROLLBACK COMPLETE')
    console.log('═'.repeat(60) + '\n')

    if (totalChangesMade) {
      consola.success(`Successfully rolled back ${collections.length} collections`)
      consola.warn('\n⚠️  Next steps:')
      console.log('  1. Run: pnpm db:generate (to update database schema)')
      console.log('  2. Restart your Nuxt dev server')
    } else {
      consola.warn('No changes were made')
    }
  }

  console.log()
  return totalChangesMade
}

