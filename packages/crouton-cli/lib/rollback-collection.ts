#!/usr/bin/env node
// rollback-collection.ts — Safely rollback generated collections

import fsp from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import consola from 'consola'

// Import utilities
import { toCase, toSnakeCase } from './utils/helpers.ts'
import { removeFromNuxtConfigExtends } from './utils/update-nuxt-config.ts'
import { removeSchemaExport, getSchemaPath } from './utils/update-schema-index.ts'
import { removeFromAppConfig } from './utils/update-app-config.ts'
import { generateMigrations } from './utils/generate-migrations.ts'
import { fileExists } from '@fyit/crouton-core/shared/utils/fs'

// Standard crouton app migrations out dir (wrangler migrations_dir / tmplDrizzleConfig `out`).
const APP_MIGRATIONS_OUT = path.join('server', 'db', 'migrations', 'sqlite')

export { fileExists }

export async function removeDirectory(dirPath: string, dryRun: boolean): Promise<boolean> {
  if (await fileExists(dirPath)) {
    if (dryRun) {
      consola.warn(`  [DRY RUN] Would remove: ${dirPath}`)
      return true
    }
    await fsp.rm(dirPath, { recursive: true, force: true })
    consola.success(`  Removed: ${dirPath}`)
    return true
  }
  return false
}

export async function removeFile(filePath: string, dryRun: boolean): Promise<boolean> {
  if (await fileExists(filePath)) {
    if (dryRun) {
      consola.warn(`  [DRY RUN] Would remove: ${filePath}`)
      return true
    }
    await fsp.unlink(filePath)
    consola.success(`  Removed: ${filePath}`)
    return true
  }
  return false
}

export async function cleanSchemaIndex(collectionName: string, layer: string, dryRun: boolean): Promise<boolean> {
  // Route through getSchemaPath (modern server/db/schema.ts → legacy locations) —
  // NOT the hardcoded legacy index.ts, which no-ops on modern apps and leaves a
  // dangling export that crashes the next generate (#1445 WS4).
  const schemaIndexPath = await getSchemaPath()

  if (!await fileExists(schemaIndexPath)) {
    console.log('  ! Schema index not found, skipping')
    return false
  }

  try {
    const cases = toCase(collectionName)
    const layerCamelCase = layer
      .split(/[-_]/)
      .map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
      .join('')
    const exportName = `${layerCamelCase}${cases.pascalCasePlural}`
    const pattern = `${layer}/collections/${cases.plural}`

    const content = await fsp.readFile(schemaIndexPath, 'utf-8')
    if (!content.includes(pattern)) {
      console.log(`  ! Export "${exportName}" not found in schema index`)
      return false
    }

    if (dryRun) {
      consola.warn(`  [DRY RUN] Would remove export "${exportName}" from schema index`)
      return true
    }

    const result = await removeSchemaExport(schemaIndexPath, pattern)
    if (result.removed) {
      consola.success(`  Removed export "${exportName}" from schema index`)
      return true
    }

    console.log(`  ! Export "${exportName}" not found: ${result.reason}`)
    return false
  } catch (error) {
    consola.error(`  ✗ Error cleaning schema index: ${error.message}`)
    return false
  }
}

export async function cleanAppConfig(collectionName: string, layer: string, dryRun: boolean): Promise<boolean> {
  const cases = toCase(collectionName)

  // Check both possible locations for app.config.ts
  const appDirExists = await fileExists(path.resolve('app'))
  const registryPath = appDirExists
    ? path.resolve('app/app.config.ts')
    : path.resolve('app.config.ts')

  if (!await fileExists(registryPath)) {
    console.log('  ! app.config.ts not found, skipping')
    return false
  }

  try {
    const layerCamelCase = layer
      .split(/[-_]/)
      .map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
      .join('')

    const collectionKey = `${layerCamelCase}${cases.pascalCasePlural}`
    const configExportName = `${layerCamelCase}${cases.pascalCasePlural}Config`

    const content = await fsp.readFile(registryPath, 'utf-8')
    if (!content.includes(collectionKey)) {
      console.log(`  ! Collection "${collectionKey}" not found in app.config.ts`)
      return false
    }

    if (dryRun) {
      consola.warn(`  [DRY RUN] Would remove "${collectionKey}" from app.config.ts`)
      consola.warn(`  [DRY RUN] Would remove import for "${configExportName}"`)
      return true
    }

    const result = await removeFromAppConfig(registryPath, collectionKey, configExportName)
    if (result.removed) {
      consola.success(`  Removed "${collectionKey}" from app.config.ts`)
      return true
    }

    console.log(`  ! Could not remove "${collectionKey}": ${result.reason}`)
    return false
  } catch (error) {
    consola.error(`  ✗ Error cleaning app.config.ts: ${error.message}`)
    return false
  }
}

export async function cleanLayerRootConfig(layer: string, collectionName: string, dryRun: boolean): Promise<boolean> {
  const cases = toCase(collectionName)
  const configPath = path.resolve('layers', layer, 'nuxt.config.ts')

  if (!await fileExists(configPath)) {
    console.log(`  ! Layer config not found at ${configPath}`)
    return false
  }

  try {
    const content = await fsp.readFile(configPath, 'utf-8')
    const collectionPath = `./collections/${cases.plural}`

    if (!content.includes(collectionPath)) {
      console.log(`  ! Collection not found in layer config`)
      return false
    }

    if (dryRun) {
      consola.warn(`  [DRY RUN] Would remove "'${collectionPath}'" from layer config`)
      return true
    }

    const result = await removeFromNuxtConfigExtends(configPath, collectionPath)
    if (result.removed) {
      consola.success(`  Removed collection from layer config`)
      return true
    }

    console.log(`  ! Could not remove from layer config: ${result.reason}`)
    return false
  } catch (error) {
    consola.error(`  ✗ Error cleaning layer config: ${error.message}`)
    return false
  }
}

export async function cleanRootNuxtConfig(layer: string, dryRun: boolean, forceRemove: boolean = false): Promise<boolean> {
  const rootConfigPath = path.resolve('nuxt.config.ts')

  if (!await fileExists(rootConfigPath)) {
    console.log('  ! Root nuxt.config.ts not found')
    return false
  }

  try {
    const content = await fsp.readFile(rootConfigPath, 'utf-8')
    const layerPath = `./layers/${layer}`

    if (!content.includes(layerPath)) {
      console.log(`  ! Layer "${layer}" not in root config`)
      return false
    }

    // Check if other collections in this layer exist (unless forced)
    if (!forceRemove) {
      const layerDir = path.resolve('layers', layer, 'collections')
      const collectionsExist = await fileExists(layerDir)
      let hasOtherCollections = false

      if (collectionsExist) {
        const collections = await fsp.readdir(layerDir)
        hasOtherCollections = collections.length > 0
      }

      if (hasOtherCollections) {
        consola.warn(`  ! Layer "${layer}" has other collections, keeping in root config`)
        return false
      }
    }

    if (dryRun) {
      consola.warn(`  [DRY RUN] Would remove layer "${layer}" from root config`)
      return true
    }

    const result = await removeFromNuxtConfigExtends(rootConfigPath, layerPath)
    if (result.removed) {
      consola.success(`  Removed layer "${layer}" from root config`)
      return true
    }

    console.log(`  ! Could not remove layer: ${result.reason}`)
    return false
  } catch (error) {
    consola.error(`  ✗ Error cleaning root config: ${error.message}`)
    return false
  }
}

export async function checkForCollectionFiles(layer: string, collection: string): Promise<{ exists: boolean; files: string[] }> {
  const cases = toCase(collection)
  const base = path.resolve('layers', layer, 'collections', cases.plural)

  const exists = await fileExists(base)
  if (!exists) {
    return { exists: false, files: [] }
  }

  const files: string[] = []

  // Check for key files
  const keyPaths = [
    path.join(base, 'app', 'components', '_Form.vue'),
    path.join(base, 'app', 'components', 'List.vue'),
    path.join(base, 'server', 'database', 'schema.ts'),
    path.join(base, 'server', 'database', 'queries.ts')
  ]

  for (const filePath of keyPaths) {
    if (await fileExists(filePath)) {
      files.push(filePath)
    }
  }

  return { exists: true, files }
}

/**
 * The SQL table name of a collection — read from its generated schema (the source
 * of truth), falling back to the generator's derived `<layer>_<plural>` name when
 * the file is already gone. Used to name the orphaned table in rollback output.
 */
export async function orphanTableName(layer: string, collection: string, cwd: string = process.cwd()): Promise<string> {
  const cases = toCase(collection)
  const derived = toSnakeCase(`${layer}_${cases.plural}`)
  const schemaFile = path.resolve(cwd, 'layers', layer, 'collections', cases.plural, 'server', 'database', 'schema.ts')
  try {
    const content = await fsp.readFile(schemaFile, 'utf-8')
    const m = content.match(/(?:sqliteTable|pgTable)\(\s*['"]([^'"]+)['"]/)
    return m ? m[1] : derived
  } catch {
    return derived
  }
}

/** The warning printed after a code-only rollback: the table lingers, next generate drops it. */
export function dropTableWarning(tableName: string): string {
  return `Table \`${tableName}\` still exists in the database and in drizzle's snapshot.\n`
    + `  The next generate (\`crouton config\`) will emit DROP TABLE ${tableName}, bundled into its migration.\n`
    + `  Re-run rollback with --drop-table to emit that DROP now as its own migration.`
}

async function listSql(dir: string): Promise<string[]> {
  try {
    return (await fsp.readdir(dir)).filter(f => f.endsWith('.sql')).sort()
  } catch {
    return []
  }
}

/** Resolve the drizzle-kit binary from the app dir, walking up for a hoisted monorepo bin. */
function resolveDrizzleKitBin(appDir: string): string | null {
  let d = path.resolve(appDir)
  for (;;) {
    const bin = path.join(d, 'node_modules', '.bin', 'drizzle-kit')
    if (existsSync(bin)) return bin
    const parent = path.dirname(d)
    if (parent === d) return null
    d = parent
  }
}

export interface DropMigrationResult { sql: string; wrote: boolean; file?: string }

/**
 * Emit (or preview) the `DROP TABLE` migration for a rolled-back collection.
 *
 * A code-only rollback removes the table from the resolved schema *view* while it
 * still lives in drizzle's `meta/` snapshot, so a generate diffs view∅ vs snapshot✓
 * into a DROP.
 *
 * - **not dry-run:** the caller has already cleaned the barrel — run the WS2
 *   machinery (`generateMigrations`) so the DROP lands in the app's own out dir.
 * - **dry-run:** drizzle-kit's CLI has no dry-run flag (§6 rejects the programmatic
 *   API), so preview via a temp `out`: save the barrel → remove the collection's
 *   export → seed a throwaway out with a copy of the app's `meta/` → `drizzle-kit
 *   generate` there → read the SQL → **restore the barrel byte-for-byte**, discard.
 *   Nothing is written to the app.
 */
export async function generateDropMigration(opts: { appDir?: string; layer: string; collection: string; dryRun?: boolean }): Promise<DropMigrationResult> {
  const appDir = opts.appDir ?? process.cwd()
  const { layer, collection, dryRun = false } = opts
  const cases = toCase(collection)
  const outDir = path.join(appDir, APP_MIGRATIONS_OUT)

  if (!dryRun) {
    // Barrel already cleaned by the rollback steps — just diff & write.
    const before = new Set(await listSql(outDir))
    const res = await generateMigrations(appDir)
    if (res.generated !== true) {
      throw new Error(`drop-table migration was not generated (${JSON.stringify(res)})`)
    }
    const added = (await listSql(outDir)).filter(f => !before.has(f))
    const file = added[0] ? path.join(outDir, added[0]) : undefined
    const sql = file ? await fsp.readFile(file, 'utf-8') : ''
    return { sql, wrote: true, file }
  }

  // Dry-run: temp-out mechanism. The temp out lives INSIDE the app with a
  // RELATIVE `out` — drizzle-kit 0.31 re-reads meta/ via a `./`-join, so an
  // absolute out ENOENTs on the snapshot (and exits 0 anyway — the #1286 disease).
  const barrelPath = await getSchemaPath(appDir)
  const saved = await fsp.readFile(barrelPath, 'utf-8')
  const tmpOut = await fsp.mkdtemp(path.join(appDir, '.crouton-dryrun-'))
  const relOut = path.relative(appDir, tmpOut)
  const tmpCfg = path.join(appDir, 'drizzle.crouton-dryrun.config.ts')
  try {
    await removeSchemaExport(barrelPath, `${layer}/collections/${cases.plural}`)
    const metaSrc = path.join(outDir, 'meta')
    if (await fileExists(metaSrc)) {
      await fsp.cp(metaSrc, path.join(tmpOut, 'meta'), { recursive: true })
    }
    await fsp.writeFile(tmpCfg, [
      `import { defineConfig } from 'drizzle-kit'`,
      `import { resolveSchemaSourcesSync } from '@fyit/crouton-cli/lib/utils/schema-sources.ts'`,
      `export default defineConfig({ dialect: 'sqlite', schema: resolveSchemaSourcesSync(process.cwd()), out: ${JSON.stringify(relOut)} })`,
    ].join('\n') + '\n')
    const bin = resolveDrizzleKitBin(appDir)
    if (!bin) throw new Error('drizzle-kit binary not found (is the app installed?)')
    const run = spawnSync(bin, ['generate', '--config', tmpCfg], { cwd: appDir, encoding: 'utf-8', stdio: 'pipe' })
    const sqls = await listSql(tmpOut)
    // drizzle-kit can print an error to stderr yet exit 0 (#1286). Treat a
    // non-zero exit OR an empty result-with-error as a hard failure, never a
    // silent empty preview.
    if (run.status !== 0 || sqls.length === 0) {
      throw new Error(`drizzle-kit dry-run produced no migration:\n${(run.stderr || run.stdout || '').trim()}`)
    }
    const sql = await fsp.readFile(path.join(tmpOut, sqls[0]), 'utf-8')
    return { sql, wrote: false }
  } finally {
    await fsp.writeFile(barrelPath, saved)
    await fsp.rm(tmpCfg, { force: true })
    await fsp.rm(tmpOut, { recursive: true, force: true })
  }
}

export async function rollbackCollection({ layer, collection, dryRun = false, keepFiles = false, silent = false, dropTable = false }: { layer: string; collection: string; dryRun?: boolean; keepFiles?: boolean; silent?: boolean; dropTable?: boolean }): Promise<boolean> {
  const cases = toCase(collection)
  let changesMade = false
  // Capture the table name BEFORE step 1 removes the collection's schema file.
  const tableName = await orphanTableName(layer, collection)

  if (!silent) {
    console.log('\n' + '─'.repeat(60))
    console.log(`  Rolling back ${layer}/${collection}`)
    console.log('─'.repeat(60) + '\n')
  }

  // Step 1: Remove files (unless --keep-files)
  if (!keepFiles) {
    if (!silent) console.log('1. Removing collection files...')
    const base = path.resolve('layers', layer, 'collections', cases.plural)
    if (await removeDirectory(base, dryRun)) {
      changesMade = true
    }
  } else {
    if (!silent) console.log('1. Keeping collection files (--keep-files)')
  }

  // Step 2: Clean schema index
  if (!silent) console.log('\n2. Cleaning schema index...')
  const schemaCleaned = await cleanSchemaIndex(collection, layer, dryRun)
  if (schemaCleaned) {
    changesMade = true
  }

  // Step 3: Clean app.config.ts
  if (!silent) console.log('\n3. Cleaning app.config.ts...')
  if (await cleanAppConfig(collection, layer, dryRun)) {
    changesMade = true
  }

  // Step 4: Clean layer root config
  if (!silent) console.log('\n4. Cleaning layer root config...')
  if (await cleanLayerRootConfig(layer, collection, dryRun)) {
    changesMade = true
  }

  // Step 5: Check root config (only if no other collections remain)
  if (!silent) console.log('\n5. Checking root nuxt.config.ts...')
  const layerDir = path.resolve('layers', layer, 'collections')
  const collectionsExist = await fileExists(layerDir)

  if (!collectionsExist || !keepFiles) {
    if (await cleanRootNuxtConfig(layer, dryRun)) {
      changesMade = true
    }
  } else {
    if (!silent) console.log('  ! Other collections exist, keeping layer in root config')
  }

  // Step 6: The table story — a code-only rollback removes the collection from the
  // schema view but the table lingers in the DB + drizzle snapshot (#1445 WS4).
  if (dropTable) {
    if (!silent) console.log('\n6. Emitting DROP TABLE migration...')
    try {
      const res = await generateDropMigration({ layer, collection, dryRun })
      if (dryRun) {
        consola.info(`[DRY RUN] Would emit this migration (nothing written):\n${res.sql.trim()}`)
      } else {
        changesMade = true
        consola.success(`Migration generated${res.file ? `: ${path.relative(process.cwd(), res.file)}` : ''}\n${res.sql.trim()}`)
      }
    } catch (error) {
      consola.error(`  ✗ Could not emit DROP migration: ${(error as Error).message}`)
    }
  } else if (!dryRun && schemaCleaned) {
    // Default (code-only) rollback: name the orphan + warn the next generate drops it.
    consola.warn(dropTableWarning(tableName))
  }

  return changesMade
}

