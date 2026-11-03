// db-pull.ts — Pull production D1 data into local dev
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import consola from 'consola'
import Database from 'better-sqlite3'

interface D1Database {
  binding: string
  database_name: string
  database_id: string
}

interface WranglerConfig {
  d1_databases?: D1Database[]
  env?: Record<string, { d1_databases?: D1Database[] }>
}

interface DbPullOptions {
  env?: string
  config?: string
  keepSql?: boolean
  dryRun?: boolean
}

const SEED_FILE = '.db-pull-seed.sql'
const LOCAL_D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
const NUXTHUB_DB_DIR = '.data/db'
const NUXTHUB_DB_FILE = '.data/db/sqlite.db'

/**
 * Detect wrangler config file in cwd or use provided path.
 */
function detectWranglerConfig(configPath?: string): string {
  if (configPath) {
    const resolved = resolve(configPath)
    if (!existsSync(resolved)) {
      throw new Error(`Wrangler config not found: ${resolved}`)
    }
    return resolved
  }

  const candidates = ['wrangler.toml', 'wrangler.jsonc', 'wrangler.json']
  for (const name of candidates) {
    if (existsSync(name)) return resolve(name)
  }

  throw new Error(
    'No wrangler config found. Expected one of: wrangler.toml, wrangler.jsonc, wrangler.json'
  )
}

/**
 * Parse wrangler config (TOML or JSON/JSONC).
 */
function parseWranglerConfig(configPath: string): WranglerConfig {
  const content = readFileSync(configPath, 'utf-8')

  if (configPath.endsWith('.toml')) {
    return parseToml(content)
  }

  // JSON/JSONC — strip comments then parse
  const stripped = content
    .replace(/\/\/.*$/gm, '') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/,\s*([}\]])/g, '$1') // trailing commas
  return JSON.parse(stripped)
}

/**
 * Minimal TOML parser — extracts d1_databases entries and env blocks.
 */
function parseToml(content: string): WranglerConfig {
  const config: WranglerConfig = {}
  const databases: D1Database[] = []

  // Match [[d1_databases]] blocks
  const d1Regex = /\[\[d1_databases\]\]([\s\S]*?)(?=\[\[|\[(?!\[)|\s*$)/g
  let match
  while ((match = d1Regex.exec(content)) !== null) {
    const block = match[1]
    const db: Partial<D1Database> = {}
    const bindingMatch = block.match(/binding\s*=\s*"([^"]+)"/)
    const nameMatch = block.match(/database_name\s*=\s*"([^"]+)"/)
    const idMatch = block.match(/database_id\s*=\s*"([^"]+)"/)
    if (bindingMatch) db.binding = bindingMatch[1]
    if (nameMatch) db.database_name = nameMatch[1]
    if (idMatch) db.database_id = idMatch[1]
    if (db.database_name && db.database_id) {
      databases.push(db as D1Database)
    }
  }
  if (databases.length > 0) config.d1_databases = databases

  // Match [env.<name>] blocks with [[env.<name>.d1_databases]]
  const envDbRegex = /\[env\.(\w+)\][\s\S]*?\[\[env\.\1\.d1_databases\]\]([\s\S]*?)(?=\[\[|\[(?!\[)|\s*$)/g
  while ((match = envDbRegex.exec(content)) !== null) {
    const envName = match[1]
    const block = match[2]
    const db: Partial<D1Database> = {}
    const bindingMatch = block.match(/binding\s*=\s*"([^"]+)"/)
    const nameMatch = block.match(/database_name\s*=\s*"([^"]+)"/)
    const idMatch = block.match(/database_id\s*=\s*"([^"]+)"/)
    if (bindingMatch) db.binding = bindingMatch[1]
    if (nameMatch) db.database_name = nameMatch[1]
    if (idMatch) db.database_id = idMatch[1]
    if (db.database_name && db.database_id) {
      if (!config.env) config.env = {}
      config.env[envName] = { d1_databases: [db as D1Database] }
    }
  }

  return config
}

/**
 * Get D1 database info for the given environment.
 */
function getD1Database(config: WranglerConfig, envName?: string): D1Database {
  let databases: D1Database[] | undefined

  if (envName) {
    databases = config.env?.[envName]?.d1_databases
    if (!databases || databases.length === 0) {
      throw new Error(`No d1_databases found in env "${envName}"`)
    }
  } else {
    databases = config.d1_databases
    if (!databases || databases.length === 0) {
      throw new Error('No d1_databases found in wrangler config')
    }
  }

  // Use the first D1 database (most apps only have one)
  return databases[0]
}

/**
 * Find the local SQLite database file.
 */
function findLocalDb(d1Dir: string): string {
  if (!existsSync(d1Dir)) {
    throw new Error(
      `Local D1 directory not found: ${d1Dir}\nRun 'pnpm dev' at least once to initialize the local database.`
    )
  }

  const files = readdirSync(d1Dir).filter(f => f.endsWith('.sqlite'))
  if (files.length === 0) {
    throw new Error(
      `No .sqlite files found in ${d1Dir}\nRun 'pnpm dev' at least once to initialize the local database.`
    )
  }

  return join(d1Dir, files[0])
}

/**
 * Pull remote D1 database to local dev.
 */
export async function dbPull(options: DbPullOptions = {}): Promise<void> {
  const { env, config: configPath, keepSql, dryRun } = options

  // Step 1: Detect and parse wrangler config
  const wranglerPath = detectWranglerConfig(configPath)
  consola.info(`Using wrangler config: ${wranglerPath}`)

  const wranglerConfig = parseWranglerConfig(wranglerPath)
  const db = getD1Database(wranglerConfig, env)

  consola.info(`Database: ${db.database_name} (${db.database_id})`)
  if (env) consola.info(`Environment: ${env}`)

  if (dryRun) {
    consola.box(
      [
        'Dry run — would execute:',
        '',
        `1. Export remote DB: wrangler d1 export ${db.database_name} --remote --output=${SEED_FILE}${env ? ` --env=${env}` : ''}`,
        `2. Clear local D1: rm -rf ${LOCAL_D1_DIR}/*`,
        `3. Import: wrangler d1 execute --local --file=${SEED_FILE}`,
        `4. Copy to NuxtHub dev DB: ${NUXTHUB_DB_FILE}`,
        `5. Mark NuxtHub migrations as applied`,
        keepSql ? `6. Keep ${SEED_FILE}` : `6. Clean up ${SEED_FILE}`,
      ].join('\n')
    )
    return
  }

  // Step 2: Export remote DB via wrangler
  consola.start('Exporting remote database...')
  const exportArgs = [
    'wrangler', 'd1', 'export',
    db.database_name,
    '--remote',
    `--output=${SEED_FILE}`,
    ...(env ? [`--env=${env}`] : []),
  ]

  // A non-zero exit means the export is untrustworthy — never import a partial file.
  try {
    execFileSync('npx', exportArgs, { stdio: 'inherit' })
  } catch {
    rmSync(SEED_FILE, { force: true })
    throw new Error(
      `Failed to export remote database. Make sure you're logged in to Cloudflare (npx wrangler login).`
    )
  }

  if (!existsSync(SEED_FILE)) {
    throw new Error(`Export file not created: ${SEED_FILE}`)
  }
  consola.success('Remote database exported')

  // Step 3: Clear local D1 directory
  consola.start('Clearing local database...')
  const d1Dir = resolve(LOCAL_D1_DIR)
  if (existsSync(d1Dir)) {
    rmSync(d1Dir, { recursive: true, force: true })
    consola.success('Local database cleared')
  } else {
    consola.warn('Local D1 directory not found — will be created on import')
  }

  // Step 4: Reinitialize local DB and import
  // After clearing, we need to run dev once or create the dir.
  // Instead, use wrangler d1 execute to import locally which handles DB creation.
  consola.start('Importing into local database...')
  const importArgs = [
    'wrangler', 'd1', 'execute',
    db.database_name,
    '--local',
    `--file=${SEED_FILE}`,
    '--yes',
  ]

  try {
    execFileSync('npx', importArgs, { stdio: 'inherit' })
  } catch {
    // Fallback: try sqlite3 direct import if wrangler d1 execute fails
    consola.warn('wrangler d1 execute failed, trying sqlite3 direct import...')
    try {
      const localDb = findLocalDb(d1Dir)
      execFileSync('sqlite3', [localDb], { input: readFileSync(SEED_FILE), stdio: ['pipe', 'inherit', 'inherit'] })
    } catch {
      throw new Error(
        'Failed to import database. Ensure sqlite3 is installed and wrangler is configured correctly.'
      )
    }
  }
  consola.success('Database imported successfully')

  // Step 5: Copy to NuxtHub dev location (.data/db/sqlite.db)
  // NuxtHub reads from .data/db/ in dev, not from the wrangler D1 directory
  try {
    const localDb = findLocalDb(resolve(LOCAL_D1_DIR))
    mkdirSync(resolve(NUXTHUB_DB_DIR), { recursive: true })
    copyFileSync(localDb, resolve(NUXTHUB_DB_FILE))
    consola.success(`Copied to NuxtHub dev database: ${NUXTHUB_DB_FILE}`)
  } catch (err) {
    consola.warn(`Could not copy to NuxtHub location: ${err}`)
    consola.info(`You may need to manually copy the DB to ${NUXTHUB_DB_FILE}`)
  }

  // Step 6: Mark NuxtHub migrations as applied
  // The pulled DB already has all tables, so we mark all migrations as done
  // to prevent NuxtHub from re-running them on dev startup
  const migrationsDir = resolve(NUXTHUB_DB_DIR, 'migrations/sqlite')
  if (existsSync(migrationsDir)) {
    const migrations = readdirSync(migrationsDir).filter(f => f.endsWith('.sql'))
    if (migrations.length > 0) {
      consola.start('Marking NuxtHub migrations as applied...')
      try {
        const hubDb = new Database(resolve(NUXTHUB_DB_FILE))
        try {
          hubDb.exec(`CREATE TABLE IF NOT EXISTS _hub_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, applied_at TEXT DEFAULT (datetime('now')))`)
          const insert = hubDb.prepare('INSERT OR IGNORE INTO _hub_migrations (name) VALUES (?)')
          hubDb.transaction((names: string[]) => names.forEach(name => insert.run(name)))(migrations)
        } finally {
          hubDb.close()
        }
        consola.success(`Marked ${migrations.length} migrations as applied`)
      } catch (err) {
        consola.warn(`Could not mark migrations: ${err}`)
        consola.info('You may need to run: npx nuxt db mark-as-migrated <migration-name>')
      }
    }
  }

  // Step 7: Clean up
  if (!keepSql) {
    unlinkSync(SEED_FILE)
    consola.info(`Cleaned up ${SEED_FILE}`)
  } else {
    consola.info(`Kept export file: ${SEED_FILE}`)
  }

  consola.success(`Local database synced with remote${env ? ` (${env})` : ''}`)
}
