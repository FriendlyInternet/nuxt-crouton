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

/**
 * Drop `INSERT` statements whose target table doesn't exist in this app's DB.
 *
 * Provider discovery walks the DEPENDENCY graph (any installed `@fyit/crouton-*`
 * seed provider), but a table only exists if the app actually EXTENDED that
 * package's layer + migrated it. A "bundle" dep (`@fyit/crouton` pulling in
 * bookings/pages/sales) makes those two sets diverge, so a minimal app would
 * emit `INSERT INTO bookings_locations …` for a table it never created → the
 * whole seed errors. This scopes the generated SQL to the tables that are
 * actually present (queried from `sqlite_master`), keeping the rest.
 *
 * Pure + line-oriented: the assembled SQL is one `;`-terminated statement per
 * line (as emitted by `buildUpsert`), so we filter by line. Non-INSERT lines
 * are always kept. Unit-tested. (#1165)
 */
export function filterSqlToExistingTables(
  sql: string,
  existingTables: Iterable<string>
): { sql: string, skipped: Map<string, number> } {
  const present = new Set([...existingTables].map(t => t.toLowerCase()))
  const skipped = new Map<string, number>()
  const kept: string[] = []
  for (const line of sql.split('\n')) {
    const m = line.match(/^\s*INSERT\s+INTO\s+"?([A-Za-z0-9_]+)"?/i)
    if (m && !present.has(m[1]!.toLowerCase())) {
      skipped.set(m[1]!, (skipped.get(m[1]!) ?? 0) + 1)
      continue
    }
    kept.push(line)
  }
  return { sql: kept.join('\n'), skipped }
}

/**
 * The tables that actually exist in the app's D1, via
 * `wrangler d1 execute … "SELECT name FROM sqlite_master WHERE type='table'"`.
 * Returns null (→ caller skips filtering, runs unfiltered) when the probe can't
 * run, so this safety net never makes a working seed worse. A plain SELECT needs
 * only the D1-query permission the deploy token already has.
 */
function getExistingTables(db: string, remote: boolean): string[] | null {
  try {
    const out = execFileSync(
      'npx',
      [
        'wrangler', 'd1', 'execute', db,
        remote ? '--remote' : '--local',
        '--command=SELECT name FROM sqlite_master WHERE type=\'table\'',
        '--json', '--yes'
      ],
      { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    // wrangler --json prints a JSON array to stdout; be tolerant of any preamble.
    const start = out.indexOf('[')
    const end = out.lastIndexOf(']')
    if (start < 0 || end < start) return null
    const json = JSON.parse(out.slice(start, end + 1))
    const names: string[] = []
    for (const block of (Array.isArray(json) ? json : [json])) {
      for (const row of (block?.results ?? [])) {
        if (row?.name) names.push(String(row.name))
      }
    }
    return names
  } catch (e: any) {
    consola.warn(`Could not read existing tables from ${db} (${e?.message || e}) — seeding unfiltered.`)
    return null
  }
}

/**
 * Run the seed: discover → order → collect SQL → execute via wrangler.
 * Returns the generated SQL (handy for tests / dry runs).
 */
export async function seedApp(options: SeedAppOptions): Promise<string> {
  const appDir = resolve(options.dir ?? process.cwd())
  const teamSlug = options.team ?? 'test1'
  const locale = options.locale ?? 'nl'

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

  // 1) Package providers — auth org + demo content shipped by extended packages.
  const providerSql: string = providers.length > 0
    ? await core.collectSeedSql({
        providers,
        teamSlug,
        teamId,
        locale,
        withStaff: options.withStaff,
        createPageWithBlocks
      })
    : ''

  // 2) App-local generated collections' editable seed.json fixtures (#298).
  const fixtureSql = collectCollectionFixtureSql(appDir, core, teamId)

  // 3) Deterministic default layout (#709) → a `layout_configs` row the POC boots with.
  const layoutSql = collectDefaultLayoutSql(appDir, core, teamId)

  const sql = [providerSql, fixtureSql, layoutSql].filter(s => s.trim()).join('\n')

  if (!sql.trim()) {
    consola.warn('No seed providers, collection fixtures, or layout found — nothing to seed.')
    return sql
  }

  if (options.dryRun) {
    consola.info('Dry run — generated SQL:')
    process.stdout.write(`${sql}\n`)
    return sql
  }

  // Scope to the tables this app actually migrated (#1165): provider discovery is
  // by dependency, but a "bundle" dep can pull in packages whose tables the app
  // never created. Drop their INSERTs so the seed doesn't error on a missing table.
  let execSql = sql
  const existing = getExistingTables(options.db, options.remote ?? false)
  if (existing && existing.length) {
    const { sql: filtered, skipped } = filterSqlToExistingTables(sql, existing)
    if (skipped.size > 0) {
      const total = [...skipped.values()].reduce((a, b) => a + b, 0)
      const detail = [...skipped.entries()].map(([t, n]) => `${t} (${n})`).join(', ')
      consola.info(`Skipped ${total} row(s) for ${skipped.size} table(s) not in ${options.db}: ${detail}`)
    }
    execSql = filtered
  }
  if (!execSql.trim()) {
    consola.warn('Nothing to seed after scoping to existing tables.')
    return sql
  }

  // Pass the SQL via --command (the D1 query API), NOT --file. `--file` against
  // a remote D1 uses the bulk *import* API, which does a user-details lookup
  // that a Pages/D1-query-scoped CLOUDFLARE_API_TOKEN can't perform (fails with
  // "Authentication error [code: 10000] … missing User->User Details->Read").
  // --command needs only the regular D1 query permission the deploy token
  // already has, and wrangler runs all `;`-separated statements in one call.
  // execFileSync passes the SQL as a single argv entry (no shell), so quotes/
  // JSON in the fixture data need no escaping. Curated seeds are small, so the
  // OS arg-length limit is not a concern.
  const wranglerArgs = [
    'wrangler',
    'd1',
    'execute',
    options.db,
    options.remote ? '--remote' : '--local',
    `--command=${execSql}`,
    '--yes'
  ]

  consola.info(`Running: npx ${wranglerArgs.join(' ')}`)
  execFileSync('npx', wranglerArgs, { cwd: appDir, stdio: 'inherit', env: process.env })

  consola.success(`Seeded ${providers.length} provider(s) into ${options.db} (${options.remote ? 'remote' : 'local'}).`)
  return sql
}
