// Validate crouton.config.js before collection generation

import fsp from 'node:fs/promises'
import path from 'node:path'
import { detectRequiredDependencies } from './module-detector.ts'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export async function validateConfig(config: Record<string, any> | null): Promise<ValidationResult> {
  const errors = []
  const warnings = []

  console.log('\n' + '═'.repeat(60))
  console.log('  VALIDATION')
  console.log('═'.repeat(60) + '\n')

  // Check if config file exists and is valid
  if (!config) {
    errors.push('Configuration file is empty or invalid')
    return { valid: false, errors, warnings }
  }

  // A freshly scaffolded app has no schema/collections yet — that's the
  // documented next step, not a validation failure. Route it to a neutral
  // success message instead of the "Validation failed" ❌ path (#1741).
  const isEmptyScaffold = !config.schemaPath
    && Array.isArray(config.collections) && config.collections.length === 0
    && (!config.targets || config.targets.length === 0)
  if (isEmptyScaffold) {
    console.log('  ✓ Scaffolded — add a schema to `schemas/`, list it in `crouton.config.js`, then run `crouton config`')
    console.log('\n' + '─'.repeat(60) + '\n')
    return { valid: true, errors, warnings }
  }

  // Validate schema files exist
  if (config.collections && Array.isArray(config.collections)) {
    // Enhanced format with multiple schemas
    for (const col of config.collections) {
      if (!col.fieldsFile) {
        errors.push(`Collection '${col.name}' is missing fieldsFile path`)
        continue
      }

      // Resolve path relative to config file directory if _configDir is set
      const schemaPath = config._configDir && !path.isAbsolute(col.fieldsFile)
        ? path.resolve(config._configDir, col.fieldsFile)
        : path.resolve(col.fieldsFile)
      try {
        await fsp.access(schemaPath)
        console.log(`  ✓ Schema: ${col.fieldsFile}`)
      } catch {
        errors.push(`❌ Schema file not found for collection '${col.name}': ${col.fieldsFile}`)
      }
    }
  } else if (config.schemaPath) {
    // Simple format with single schema
    const schemaPath = path.resolve(config.schemaPath)
    try {
      const stats = await fsp.stat(schemaPath)
      if (stats.isDirectory()) {
        errors.push(
          `schemaPath '${config.schemaPath}' is a directory, not a file.\n`
          + `   When using targets[], use the enhanced format with a collections[] array\n`
          + `   where each collection specifies its own fieldsFile:\n\n`
          + `   collections: [\n`
          + `     { name: 'products', fieldsFile: '${config.schemaPath}/products.json' },\n`
          + `     { name: 'categories', fieldsFile: '${config.schemaPath}/categories.json' },\n`
          + `   ],\n`
          + `   targets: [...]\n`
        )
      } else {
        console.log(`✓ Schema file found: ${config.schemaPath}`)
      }
    } catch {
      errors.push(`Schema file not found: ${config.schemaPath}`)
    }
  } else {
    errors.push('No schema configuration found (need either schemaPath or collections array)')
  }

  // Validate targets
  if (!config.targets || !Array.isArray(config.targets) || config.targets.length === 0) {
    errors.push('No targets specified in configuration')
  } else {
    let totalCollections = 0
    for (const target of config.targets) {
      if (!target.layer) {
        errors.push('Target missing layer name')
      }
      if (!target.collections || !Array.isArray(target.collections) || target.collections.length === 0) {
        errors.push(`Target layer '${target.layer}' has no collections`)
      } else {
        totalCollections += target.collections.length
      }
    }
    console.log(`  ✓ Found ${config.targets.length} layers, ${totalCollections} collections`)
  }

  // Validate dialect
  if (config.dialect && !['pg', 'sqlite'].includes(config.dialect)) {
    warnings.push(`Unknown dialect '${config.dialect}', defaulting to 'pg'`)
  }

  // Check if collections in targets match defined collections (for enhanced format)
  if (config.collections && config.targets) {
    const definedCollections = new Set(config.collections.map(c => c.name))
    const usedCollections = new Set()

    for (const target of config.targets) {
      for (const colName of target.collections) {
        usedCollections.add(colName)
        if (!definedCollections.has(colName)) {
          errors.push(`Collection '${colName}' in layer '${target.layer}' is not defined in collections array`)
        }
      }
    }

    // Check for unused defined collections
    for (const colName of definedCollections) {
      if (!usedCollections.has(colName)) {
        warnings.push(`Collection '${colName}' is defined but not used in any target`)
      }
    }
  }

  // Check for write permissions in current directory
  try {
    await fsp.access(process.cwd(), fsp.constants.W_OK)
    console.log(`  ✓ Write permissions verified`)
  } catch {
    errors.push(`No write permissions in current directory: ${process.cwd()}`)
  }

  // Check if layers directory exists or can be created
  const layersPath = path.resolve('layers')
  try {
    await fsp.access(layersPath)
    console.log(`  ✓ Layers directory exists`)
  } catch {
    // Try to check parent directory permissions
    try {
      await fsp.access(process.cwd(), fsp.constants.W_OK)
      console.log(`  ✓ Can create layers directory`)
    } catch {
      errors.push('Cannot create layers directory - check permissions')
    }
  }

  // Check for required dependencies (unless force flag is set)
  if (!config.flags?.force) {
    const dependencies = await detectRequiredDependencies(config)

    if (dependencies.missing.length > 0) {
      warnings.push(`Missing dependencies detected. Run 'crouton-generate install' or use --force to skip`)
      console.log('\n⚠️  Missing dependencies:')
      dependencies.missing.forEach((dep) => {
        console.log(`  • ${dep.name} - ${dep.reason}`)
      })
    }
  }

  // Summary
  console.log('\n' + '─'.repeat(60))

  if (errors.length > 0) {
    console.log('\n❌ Validation failed with errors:\n')
    errors.forEach(err => console.log(`  • ${err}`))
  }

  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:\n')
    warnings.forEach(warn => console.log(`  • ${warn}`))
  }

  if (errors.length === 0) {
    console.log('\n✓ Configuration validated successfully!')

    // Show what will be generated
    console.log('\n' + '═'.repeat(60))
    console.log('  GENERATION PLAN')
    console.log('═'.repeat(60))
    for (const target of config.targets) {
      console.log(`\n  ${target.layer}`)
      for (const col of target.collections) {
        console.log(`    • ${col}`)
      }
    }

    if (config.flags?.dryRun) {
      console.log('\n🔍 DRY RUN MODE - No files will be created')
    }
  }

  console.log('\n' + '─'.repeat(60) + '\n')

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}
