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
import { join, resolve, dirname, relative } from 'node:path'
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

  // Build the seed as INDEPENDENT chunks — one per provider, plus the app's collection
  // fixtures and default layout — instead of one atomic batch. Why (#1370, the snippets
  // dogfood): `@fyit/crouton` pulls in `@fyit/crouton-bookings` transitively, so the BFS
  // discovers a bookings provider even for an app that never extends bookings as a layer
  // (its migrations never created `bookings_settings`). As one `--command` batch, that single
  // missing table aborted EVERYTHING — no auth team, no collection rows → an empty preview.
  // Per-chunk, a failing provider warns + is skipped and the auth team + the app's own rows
  // + layout still seed.
  const chunks: Array<{ label: string; sql: string }> = []
  for (const provider of providers) {
    const psql: string = await core.collectSeedSql({
      providers: [provider], teamSlug, teamId, locale, withStaff: options.withStaff, createPageWithBlocks,
    })
    if (psql.trim()) chunks.push({ label: `provider:${provider.id}`, sql: psql })
  }
  const fixtureSql = collectCollectionFixtureSql(appDir, core, teamId)
  if (fixtureSql.trim()) chunks.push({ label: 'collection-fixtures', sql: fixtureSql })
  const layoutSql = collectDefaultLayoutSql(appDir, core, teamId)
  if (layoutSql.trim()) chunks.push({ label: 'default-layout', sql: layoutSql })

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

  // Local vs remote take DIFFERENT execution paths (#1612):
  // - remote → `wrangler d1 execute --remote` against Cloudflare D1 (unchanged).
  // - local  → execute straight against `.data/db/sqlite.db` — the file `nuxt dev`
  //   (`hub: { db: 'sqlite' }`) actually reads via libsql. The old `wrangler --local`
  //   wrote the *miniflare* DB (`.wrangler/state/v3/d1/…`), a different file, so
  //   locally-seeded rows never appeared in the running dev app.
  const { ok, skipped } = options.remote
    ? await runSeedChunks(chunks, remoteWranglerRunner(options.db, appDir))
    : await seedLocalChunks(appDir, chunks)
  if (ok === 0 && skipped.length > 0) {
    // Nothing seeded at all → a real problem (bad DB / token / all tables missing), not a
    // tolerable partial skip. Surface it so the deploy's seed step can warn loudly.
    throw new Error(`All ${skipped.length} seed chunk(s) failed: ${skipped.join(', ')}`)
  }
  if (skipped.length > 0) {
    consola.warn(`Seeded ${ok} chunk(s) into ${options.db}; skipped ${skipped.length} (${skipped.join(', ')}) — see warnings above.`)
  } else {
    consola.success(`Seeded ${ok} chunk(s) into ${options.db} (${options.remote ? 'remote' : 'local'}).`)
  }
  return sql
}

/**
 * Run seed SQL chunks resiliently (#1370): execute each via `run`; if one throws, WARN and skip
 * it rather than aborting the rest — so a provider whose table isn't in this app (e.g. bookings,
 * pulled in transitively but never extended) doesn't sink the auth team + the app's own rows.
 * `run` is injected so the resilience is unit-testable without a real DB, and may be sync (the
 * wrangler path) or async (`await`ed — the local libsql path, #1612).
 */
export async function runSeedChunks(
  chunks: Array<{ label: string; sql: string }>,
  run: (sql: string) => void | Promise<void>,
): Promise<{ ok: number; skipped: string[] }> {
  let ok = 0
  const skipped: string[] = []
  for (const { label, sql } of chunks) {
    try {
      await run(sql)
      ok++
    } catch (e) {
      skipped.push(label)
      consola.warn(`Seed chunk "${label}" failed — skipping (the rest still seed): ${(e as Error).message.split('\n')[0]}`)
    }
  }
  return { ok, skipped }
}

/**
 * The path `nuxt dev` (`hub: { db: 'sqlite' }`) reads in local dev: `<appDir>/.data/db/sqlite.db`,
 * opened via the libsql driver (`@nuxthub/core` → `drizzle-orm/libsql`). This is NOT the miniflare
 * DB (`.wrangler/state/v3/d1/…`) that `wrangler d1 execute --local` writes — the split #1612 fixes.
 */
export function localDbPath(appDir: string): string {
  return join(appDir, '.data', 'db', 'sqlite.db')
}

/**
 * Load `@libsql/client` — the SAME driver `nuxt dev` uses to read `.data/db/sqlite.db`, so we write
 * exactly the file (and format) it reads. Resolve it from the APP first (it ships with
 * `@nuxthub/core`, so any dev-capable app has it), falling back to the CLI's own resolution.
 */
async function loadLibsqlCreateClient(appDir: string): Promise<(config: { url: string }) => any> {
  try {
    const req = createRequire(pathToFileURL(join(appDir, '_seed-runner.mjs')).href)
    return req('@libsql/client').createClient
  } catch {
    // Fall through to the CLI's own module resolution.
  }
  try {
    return (await import('@libsql/client')).createClient
  } catch {
    throw new Error(
      "@libsql/client not found — it ships with @nuxthub/core; run `pnpm install` in the app, then retry.",
    )
  }
}

/**
 * Execute the seed chunks straight against the local dev DB (`.data/db/sqlite.db`) via libsql —
 * the file `nuxt dev` reads — so locally-seeded rows actually appear in the running app (#1612).
 * The DB must already exist with its migrations applied (run `pnpm dev` once, then `db:migrate`);
 * we detect its absence and message clearly rather than silently seeding into nothing. Resilient
 * per-chunk (#1370): a chunk hitting a table this app never migrated warns + skips, the rest land.
 */
export async function seedLocalChunks(
  appDir: string,
  chunks: Array<{ label: string; sql: string }>,
): Promise<{ ok: number; skipped: string[] }> {
  const dbPath = localDbPath(appDir)
  if (!existsSync(dbPath)) {
    throw new Error(
      `Local dev database not found at ${relative(appDir, dbPath) || dbPath}.\n`
      + 'Run `pnpm dev` once to initialise it and `pnpm db:migrate` to apply migrations, then re-run the seed.',
    )
  }

  const createClient = await loadLibsqlCreateClient(appDir)
  const client = createClient({ url: `file:${dbPath}` })
  try {
    // executeMultiple runs the chunk's statements as one script (same batch semantics the old
    // `wrangler --command` used), so a mid-chunk failure surfaces to runSeedChunks' skip logic.
    return await runSeedChunks(chunks, (sql: string) => client.executeMultiple(sql))
  } finally {
    client.close()
  }
}

/**
 * The remote seed path (`--remote`, unchanged, #1612): each chunk as its own
 * `wrangler d1 execute --command` against Cloudflare D1. --command (not --file) uses the D1 query
 * API — the only D1 permission a deploy token needs (a --file bulk import needs User-Details:Read
 * the token lacks). execFileSync passes SQL as one argv entry (no shell), so JSON/quotes in fixture
 * data need no escaping. Curated seeds are small (arg-length is fine).
 */
function remoteWranglerRunner(db: string, appDir: string): (sql: string) => void {
  return (chunkSql: string) => {
    execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', db, '--remote', `--command=${chunkSql}`, '--yes'],
      { cwd: appDir, stdio: 'inherit', env: process.env },
    )
  }
}
