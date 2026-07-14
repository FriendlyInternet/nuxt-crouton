/**
 * App-level seed runner (#83).
 *
 * Discovers the seed providers of an app's extended `@fyit/crouton-*` packages,
 * orders them by `dependsOn`, turns their declarative upserts into idempotent
 * SQL, and executes it against the app's D1 — local or remote — via
 * `wrangler d1 execute` (mirroring the `db:migrate` local/remote split).
 *
 * Providers are pure TS modules exported at `<pkg>/seed`; they're loaded with
 * jiti so no build step is required.
 */
import { createJiti } from 'jiti'
import consola from 'consola'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

export interface SeedAppOptions {
  /** App directory (defaults to cwd). */
  dir?: string
  /** D1 database name/binding (e.g. `fanfare-db`). */
  db: string
  /** Target the remote D1 instead of the local one. */
  remote?: boolean
  /** Team slug to seed (defaults to `test1`). */
  team?: string
  /** Locale demo content is authored in (defaults to `nl`). */
  locale?: string
  /** Also seed optional staff/login accounts. */
  withStaff?: boolean
  /** Print the SQL instead of executing it (no wrangler call). */
  dryRun?: boolean
}

interface LoadedProviders {
  providers: Array<{ id: string, dependsOn?: string[], seed: Function }>
  createPageWithBlocks?: Function
}

/**
 * Import a module via jiti, unwrapping a lone CJS `default` export (same
 * interop the main CLI bin uses).
 */
async function tsImport(jiti: ReturnType<typeof createJiti>, specifier: string): Promise<any> {
  const mod: any = await jiti.import(specifier)
  if (mod && typeof mod === 'object' && 'default' in mod && Object.keys(mod).length === 1) {
    return mod.default
  }
  return mod
}

/**
 * The `@fyit/crouton-*` *runtime* dependency names declared in a package.json
 * object — `dependencies` + `peerDependencies` only. `devDependencies` are
 * deliberately excluded: a package contributes runtime tables only if the app
 * actually extends it, whereas build-time devDeps (e.g. `@fyit/crouton-cli` and
 * the `@fyit/crouton-*` packages it transitively pulls in) ship no migrations
 * for this app. Including them made the BFS over-discover providers and emit
 * `INSERT`s into non-existent tables (#303).
 */
function croutonDepNames(pkg: any): string[] {
  const deps = { ...pkg?.dependencies, ...pkg?.peerDependencies }
  return Object.keys(deps).filter(name => name.startsWith('@fyit/crouton'))
}

/**
 * Locate a package's directory by walking the node_modules chain up from
 * `fromDir`. Reads package.json directly (not via the exports map), so it works
 * for packages that don't export `./package.json`.
 */
function findPackageDir(name: string, fromDir: string): string | null {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return dirname(candidate)
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Discover every `@fyit/crouton-*` package reachable from the app — its direct
 * deps plus the packages those pull in (e.g. crouton-auth is bundled via
 * crouton-core, so it isn't a direct app dependency). BFS over deps + peerDeps.
 */
function discoverCroutonPackageNames(appDir: string): string[] {
  const appPkgPath = join(appDir, 'package.json')
  if (!existsSync(appPkgPath)) {
    throw new Error(`No package.json found in ${appDir}`)
  }
  const appPkg = JSON.parse(readFileSync(appPkgPath, 'utf8'))

  const seen = new Set<string>()
  const queue = croutonDepNames(appPkg)

  while (queue.length > 0) {
    const name = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)

    const pkgDir = findPackageDir(name, appDir)
    if (!pkgDir) continue
    try {
      const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
      for (const dep of croutonDepNames(pkg)) {
        if (!seen.has(dep)) queue.push(dep)
      }
    } catch {
      // Unreadable package.json — skip; it just won't contribute providers.
    }
  }

  return [...seen]
}

/** Discover seed providers (and the page helper) from the app's packages. */
async function discoverProviders(
  jiti: ReturnType<typeof createJiti>,
  croutonDeps: string[]
): Promise<LoadedProviders> {
  const providers: LoadedProviders['providers'] = []
  let createPageWithBlocks: Function | undefined

  for (const name of croutonDeps) {
    let mod: any
    try {
      mod = await tsImport(jiti, `${name}/seed`)
    } catch {
      // No `./seed` export → this package ships no demo data. Skip quietly.
      continue
    }
    const provider = mod?.provider ?? mod?.default
    if (provider && typeof provider.id === 'string' && typeof provider.seed === 'function') {
      providers.push(provider)
      consola.info(`Discovered seed provider: ${provider.id} (${name})`)
    }
    if (typeof mod?.createPageWithBlocks === 'function') {
      createPageWithBlocks = mod.createPageWithBlocks
    }
  }

  return { providers, createPageWithBlocks }
}

/**
 * Turn the app's generated collection fixtures (`layers/*​/collections/*​/seed.json`,
 * emitted by the CLI) into idempotent upsert SQL (#298). Each row gets a stable,
 * namespace-derived id and the standard crouton system columns (teamId, owner,
 * audit, timestamps) injected — the fixture itself only carries user fields, so
 * re-runs upsert in place. `core` is `@fyit/crouton-core/shared/seed`.
 */
function collectCollectionFixtureSql(appDir: string, core: any, teamId: string): string {
  const layersDir = join(appDir, 'layers')
  if (!existsSync(layersDir)) return ''

  const now = Math.floor(Date.now() / 1000)
  const stmts: string[] = []

  for (const layer of readdirSync(layersDir)) {
    const collectionsDir = join(layersDir, layer, 'collections')
    if (!existsSync(collectionsDir)) continue

    for (const collection of readdirSync(collectionsDir)) {
      const fixturePath = join(collectionsDir, collection, 'seed.json')
      if (!existsSync(fixturePath)) continue

      let fixture: any
      try {
        fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
      } catch {
        consola.warn(`Skipping unparseable fixture: ${layer}/${collection}/seed.json`)
        continue
      }

      const { table, key, rows } = fixture ?? {}
      if (!table || !Array.isArray(rows) || rows.length === 0) continue

      rows.forEach((row: Record<string, unknown>, i: number) => {
        const keyVal = key && row[key] != null ? row[key] : i
        const id = core.seedId(layer, collection, String(keyVal))
        const values = {
          teamId,
          owner: 'seed',
          createdBy: 'seed',
          updatedBy: 'seed',
          createdAt: now,
          updatedAt: now,
          ...row,
        }
        stmts.push(core.buildUpsert(table, { id }, values, { immutable: ['createdAt'] }))
      })

      consola.info(`Discovered collection fixture: ${layer}/${collection} (${rows.length} rows → ${table})`)
    }
  }

  return stmts.join('\n')
}

/**
 * Turn the app's deterministic default layout (`crouton.layout.json`, emitted by
 * the generator, #709) into an idempotent upsert into `layout_configs`, so a
 * freshly seeded POC boots with a real, data-bound layout instead of a blank
 * canvas. The row id is `default` — what the team layout surface
 * (`admin/[team]/layout.vue`, `LAYOUT_ID = 'default'`) loads. `core` is
 * `@fyit/crouton-core/shared/seed`.
 *
 * NB: `layout_configs.id` is a global primary key, so this seeds the one default
 * layout for the POC's single seeded team; multi-team seeding is out of scope here.
 */
function collectDefaultLayoutSql(appDir: string, core: any, teamId: string): string {
  const layoutPath = join(appDir, 'crouton.layout.json')
  if (!existsSync(layoutPath)) return ''

  let parsed: any
  try {
    parsed = JSON.parse(readFileSync(layoutPath, 'utf8'))
  } catch {
    consola.warn('Skipping unparseable crouton.layout.json')
    return ''
  }

  const tree = parsed?.tree
  if (!tree || typeof tree !== 'object') return ''

  const now = Math.floor(Date.now() / 1000)
  const id = parsed.id || 'default'
  const values = {
    teamId,
    name: id,
    renderer: parsed.renderer || 'panes',
    // Object value → JSON literal (the `tree` column is `text({ mode: 'json' })`).
    tree,
    createdAt: now,
    updatedAt: now,
  }

  consola.info(`Discovered default layout (${parsed.pattern || 'layout'}) → layout_configs[${id}]`)
  return core.buildUpsert('layout_configs', { id }, values, { immutable: ['createdAt'] })
}

/** Where a LOCAL seed must land: the sqlite file `nuxt dev` (`hub: { db: 'sqlite' }`) reads. */
export function localSeedDbPath(appDir: string): string {
  return join(appDir, '.data', 'db', 'sqlite.db')
}

export type SeedTarget =
  | { kind: 'sqlite', path: string }
  | { kind: 'wrangler', db: string, remote: true }

/**
 * Route a seed to its executor (#1612). LOCAL seeds go straight to the DB `nuxt dev` actually
 * reads (`.data/db/sqlite.db`) — NOT the miniflare `.wrangler` DB that `wrangler d1 execute
 * --local` writes and that dev never opens (the split that made local seed data "disappear").
 * REMOTE is unchanged: `wrangler d1 execute --remote`.
 */
export function resolveSeedTarget(opts: { db: string, remote: boolean, appDir: string }): SeedTarget {
  return opts.remote
    ? { kind: 'wrangler', db: opts.db, remote: true }
    : { kind: 'sqlite', path: localSeedDbPath(opts.appDir) }
}

/**
 * A local seed needs the DB `nuxt dev` created + migrated at its first boot. If it isn't there
 * yet, fail with the recipe rather than seeding an absent/empty file (#1612).
 */
export function assertLocalSeedReady(appDir: string): void {
  if (!existsSync(localSeedDbPath(appDir))) {
    throw new Error(
      `No local database at ${localSeedDbPath(appDir)} — run \`pnpm dev\` once to create and `
      + `migrate it, then re-run the seed.`,
    )
  }
}

// better-sqlite3 is a native module — require it LAZILY (only when a local seed actually runs),
// so remote/dry-run paths and non-seed CLI commands never load it.
const requireCjs = createRequire(import.meta.url)

/** Execute seed SQL directly against the local `.data` sqlite DB — what `nuxt dev` reads (#1612). */
export function runLocalSeed(appDir: string, sql: string): void {
  assertLocalSeedReady(appDir)
  const Database = requireCjs('better-sqlite3')
  const db = new Database(localSeedDbPath(appDir))
  try {
    db.exec(sql)
  }
  finally {
    db.close()
  }
}

/**
 * Assemble the INDEPENDENT seed chunks (#1370): one per provider, plus the app's collection
 * fixtures and default layout. Independent (not one atomic batch) so a provider whose table
 * isn't in this app (e.g. bookings, pulled in transitively but never extended) warns + is
 * skipped rather than sinking the auth team + the app's own rows.
 */
async function buildSeedChunks(opts: {
  core: any
  providers: LoadedProviders['providers']
  createPageWithBlocks?: Function
  appDir: string
  teamSlug: string
  teamId: string
  locale: string
  withStaff?: boolean
}): Promise<Array<{ label: string, sql: string }>> {
  const { core, providers, createPageWithBlocks, appDir, teamSlug, teamId, locale, withStaff } = opts
  const chunks: Array<{ label: string, sql: string }> = []
  for (const provider of providers) {
    const psql: string = await core.collectSeedSql({
      providers: [provider], teamSlug, teamId, locale, withStaff, createPageWithBlocks,
    })
    if (psql.trim()) chunks.push({ label: `provider:${provider.id}`, sql: psql })
  }
  const fixtureSql = collectCollectionFixtureSql(appDir, core, teamId)
  if (fixtureSql.trim()) chunks.push({ label: 'collection-fixtures', sql: fixtureSql })
  const layoutSql = collectDefaultLayoutSql(appDir, core, teamId)
  if (layoutSql.trim()) chunks.push({ label: 'default-layout', sql: layoutSql })
  return chunks
}

/**
 * Build the per-chunk executor for the resolved target (#1612): LOCAL writes straight into
 * `.data/db/sqlite.db` (what `nuxt dev` reads) via better-sqlite3; REMOTE goes through
 * `wrangler d1 execute --remote` (--command uses the D1 query API — the only D1 permission a
 * deploy token needs; execFileSync passes SQL as one argv entry, no shell, so JSON/quotes in
 * fixture data need no escaping).
 */
function makeSeedChunkRunner(db: string, appDir: string, remote: boolean): (sql: string) => void {
  const target = resolveSeedTarget({ db, remote, appDir })
  if (target.kind === 'sqlite') {
    assertLocalSeedReady(appDir) // fail fast with the recipe
    return (chunkSql: string) => runLocalSeed(appDir, chunkSql)
  }
  return (chunkSql: string) => {
    execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', db, '--remote', `--command=${chunkSql}`, '--yes'],
      { cwd: appDir, stdio: 'inherit', env: process.env },
    )
  }
}

/** Resolve the seed's effective inputs (app dir + team + locale defaults). */
function normalizeSeedOptions(options: SeedAppOptions): { appDir: string, teamSlug: string, locale: string } {
  return {
    appDir: resolve(options.dir ?? process.cwd()),
    teamSlug: options.team ?? 'test1',
    locale: options.locale ?? 'nl',
  }
}

/** Report the per-chunk outcome: throw if EVERYTHING failed, else warn (partial) / success. */
function reportSeedOutcome(r: { ok: number, skipped: string[], db: string, remote: boolean }): void {
  if (r.ok === 0 && r.skipped.length > 0) {
    // Nothing seeded at all → a real problem (bad DB / token / all tables missing), not a
    // tolerable partial skip. Surface it so the deploy's seed step can warn loudly.
    throw new Error(`All ${r.skipped.length} seed chunk(s) failed: ${r.skipped.join(', ')}`)
  }
  if (r.skipped.length > 0) {
    consola.warn(`Seeded ${r.ok} chunk(s) into ${r.db}; skipped ${r.skipped.length} (${r.skipped.join(', ')}) — see warnings above.`)
  }
  else {
    consola.success(`Seeded ${r.ok} chunk(s) into ${r.db} (${r.remote ? 'remote' : 'local'}).`)
  }
}

/**
 * Run the seed: discover → order → collect SQL → execute against the resolved target
 * (local `.data` sqlite, or remote via wrangler). Returns the generated SQL (handy for tests /
 * dry runs).
 */
export async function seedApp(options: SeedAppOptions): Promise<string> {
  const { appDir, teamSlug, locale } = normalizeSeedOptions(options)

  consola.start(`Seeding ${options.db} (${options.remote ? 'remote' : 'local'}) — team "${teamSlug}", locale "${locale}"`)

  // jiti resolves bare specifiers from the app dir (where the @fyit packages
  // are installed), so providers and crouton-core resolve correctly.
  const jiti = createJiti(pathToFileURL(join(appDir, '_seed-runner.mjs')).href, {
    interopDefault: true
  })

  const croutonDeps = discoverCroutonPackageNames(appDir)
  const { providers, createPageWithBlocks } = await discoverProviders(jiti, croutonDeps)

  const core: any = await tsImport(jiti, '@fyit/crouton-core/shared/seed')
  const teamId = core.seedOrgId(teamSlug)

  // Independent chunks (#1370) — see buildSeedChunks: a provider whose table isn't in this app
  // warns + is skipped instead of sinking the whole seed.
  const chunks = await buildSeedChunks({
    core, providers, createPageWithBlocks, appDir,
    teamSlug, teamId, locale, withStaff: options.withStaff,
  })

  const sql = chunks.map(c => c.sql).join('\n')
  if (!chunks.length) {
    consola.warn('No seed providers, collection fixtures, or layout found — nothing to seed.')
    return sql
  }
  if (options.dryRun) {
    consola.info('Dry run — generated SQL:')
    process.stdout.write(`${sql}\n`)
    return sql
  }

  // Route each chunk to its executor (#1612) — local `.data` sqlite or remote wrangler.
  const { ok, skipped } = runSeedChunks(chunks, makeSeedChunkRunner(options.db, appDir, !!options.remote))
  reportSeedOutcome({ ok, skipped, db: options.db, remote: !!options.remote })
  return sql
}

/**
 * Run seed SQL chunks resiliently (#1370): execute each via `run`; if one throws, WARN and skip
 * it rather than aborting the rest — so a provider whose table isn't in this app (e.g. bookings,
 * pulled in transitively but never extended) doesn't sink the auth team + the app's own rows.
 * `run` is injected so the resilience is unit-testable without wrangler.
 */
export function runSeedChunks(
  chunks: Array<{ label: string; sql: string }>,
  run: (sql: string) => void,
): { ok: number; skipped: string[] } {
  let ok = 0
  const skipped: string[] = []
  for (const { label, sql } of chunks) {
    try {
      run(sql)
      ok++
    } catch (e) {
      skipped.push(label)
      consola.warn(`Seed chunk "${label}" failed — skipping (the rest still seed): ${(e as Error).message.split('\n')[0]}`)
    }
  }
  return { ok, skipped }
}
