# CLAUDE.md - @fyit/crouton-cli

## Package Purpose

CLI tool that generates complete CRUD collections for Nuxt Crouton applications. Creates API endpoints, Vue components, database schemas, composables, and types from a JSON schema definition.

## CLI Commands

```bash
crouton <layer> <collection> [options]       # Generate single collection
crouton config [path] [--only name]          # Generate from config file
crouton add <modules...>                     # Add Crouton modules to project
crouton add --list                           # List available modules
crouton install                              # Install required modules
crouton init <name> [options]                 # Full pipeline: scaffold → generate → doctor
crouton rollback <layer> <collection>        # Remove collection (code-only)
crouton rollback <layer> <collection> --drop-table          # …and emit a DROP TABLE migration
crouton rollback <layer> <collection> --drop-table --dry-run # …preview that DROP, write nothing
crouton rollback-interactive                 # Interactive removal UI
crouton seed-translations                    # Seed i18n data
crouton db-pull                              # Pull remote D1 → local dev
crouton db-pull --env staging                # Pull from staging environment
crouton-seed --db <name> [--remote]          # Seed an app DB from its packages' providers
```

## App Seeding (`crouton-seed`)

`crouton-seed` (separate bin, `bin/crouton-seed.mjs` → `lib/seed-app.ts`) fills an
app's D1 with the demo data its extended packages ship (epic #82):

```bash
crouton-seed --db fanfare-db            # local  (→ .data/db/sqlite.db — what nuxt dev reads, #1612)
crouton-seed --db fanfare-db --remote   # remote (→ wrangler d1 execute --remote)
crouton-seed --db fanfare-db --dry-run  # print the generated SQL, don't execute
```

**Local seeds land where `nuxt dev` reads (#1612).** A local seed writes straight into
`<app>/.data/db/sqlite.db` (the NuxtHub `hub: { db: 'sqlite' }` dev DB) via `better-sqlite3` —
NOT the miniflare `.wrangler` DB that `wrangler d1 execute --local` writes and that dev never
opens (the split that used to make locally-seeded data "disappear"). If `.data/db/sqlite.db`
doesn't exist yet, the seed fails with a recipe (run `pnpm dev` once to create + migrate it).
`--remote` is unchanged (`wrangler d1 execute --remote`). Routing lives in `resolveSeedTarget` /
`runLocalSeed` (`lib/seed-app.ts`); contract: `tests/unit/seed-local-{target,write}.test.ts`.

| Flag | Default | Purpose |
|------|---------|---------|
| `--db <name>` | (required) | D1 database name/binding (e.g. `fanfare-db`) |
| `--remote` | false | Target remote D1 instead of local |
| `--dir <path>` | cwd | App directory (where package.json lives) |
| `--team <slug>` | `test1` | Team slug to seed |
| `--locale <l>` | `nl` | Locale demo content is authored in |
| `--with-staff` | false | Also seed an optional staff login (better-auth credential) |
| `--dry-run` | false | Print SQL instead of running wrangler |

**How it works:** BFS-discovers every `@fyit/crouton-*` package reachable from the
app (direct deps + transitively bundled ones like `crouton-auth` via `crouton-core`),
loads each package's `./seed` export via **jiti** (no build step), topo-sorts the
providers by `dependsOn` (`auth → sales → pages`), then calls
`collectSeedSql()` from `@fyit/crouton-core/shared/seed` to turn their declarative
`ctx.upsert(...)` calls into idempotent `INSERT … ON CONFLICT(id) DO UPDATE` SQL,
which it executes against the local `.data/db/sqlite.db` (#1612) or, with `--remote`,
via `wrangler d1 execute --command`. Stable, namespace-derived ids
(`seed:org:test1`, `seed:event:test1:vlaamsekermis`) make re-runs upsert in place.

**Resilient per-chunk execution (#1370):** the seed runs as INDEPENDENT chunks — one
`--command` per provider, plus the collection fixtures and the default layout — not one
atomic batch. Why: `@fyit/crouton` (the kitchen-sink meta package) bundles *every* crouton
package as a dep, so the BFS discovers a provider even for a package the app **doesn't
extend** (e.g. `crouton-bookings` in a minimal app that never migrated `bookings_settings`).
As one batch, that single missing table aborted the WHOLE seed → an empty preview. Now a
failing chunk **warns + is skipped** (`runSeedChunks`, unit-tested) and the auth team + the
app's own rows + layout still seed. `crouton-seed` throws only if **every** chunk fails.

The contract (`SeedProvider`, `SeedContext`, `createPageWithBlocks`) lives in
`@fyit/crouton-core/shared/seed`; each package ships its provider at `<pkg>/seed`.
Wire it into an app with `db:seed:local` / `db:seed:remote` scripts (see
`apps/fanfare/package.json`).

**Plus app-local collection fixtures (#298):** after the package providers, the
runner also loads every generated collection's `layers/*/collections/*/seed.json`
— a small, **editable** fixture of auto-derived sample rows the generator emits
(see `collection-seed-fixture.ts`). For each row it injects a stable
`seedId(layer, collection, key)` id + the standard system columns (`teamId`,
`owner`, audit, timestamps) and upserts via `buildUpsert`, so a freshly deployed
app's public surfaces aren't empty. Idempotent (stable ids) — re-deploys upsert
in place. Edit `seed.json` to replace the samples with real content, or delete it
to seed nothing for that collection. Hierarchy collections get no fixture.

## Add Command (Module Installation)

Add Crouton modules with automatic configuration:

```bash
# Add a single module
crouton add auth

# Add multiple modules
crouton add bookings i18n

# Preview what would be done
crouton add auth --dry-run

# Skip migration generation
crouton add auth --skip-migrations

# Force reinstall
crouton add auth --force

# List available modules
crouton add --list
```

### Add Command Options

| Option | Description |
|--------|-------------|
| `--skip-migrations` | Skip running `npx nuxt db:generate` and `db:migrate` |
| `--skip-install` | Skip `pnpm add` (assume already installed) |
| `--dry-run` | Preview what would be done without making changes |
| `--force` | Force reinstall even if already installed |
| `--list` | List all available modules |

### Available Modules

| Module | Package | Has Schema | Description |
|--------|---------|------------|-------------|
| `auth` | `@fyit/crouton-auth` | ● | Authentication with Better Auth (**bundled in core**) |
| `i18n` | `@fyit/crouton-i18n` | ● | Multi-language support (**bundled in core**) |
| `admin` | `@fyit/crouton-admin` | ○ | Admin dashboard (**bundled in core**) |
| `bookings` | `@fyit/crouton-bookings` | ○ | Booking system |
| `editor` | `@fyit/crouton-editor` | ○ | Rich text editor |
| `assets` | `@fyit/crouton-assets` | ○ | Asset management |
| `events` | `@fyit/crouton-events` | ○ | Event tracking/audit trail |
| `flow` | `@fyit/crouton-flow` | ○ | Vue Flow graphs |
| `email` | `@fyit/crouton-email` | ○ | Email integration |
| `maps` | `@fyit/crouton-maps` | ○ | Map integration |
| `ai` | `@fyit/crouton-ai` | ○ | AI integration |
| `devtools` | `@fyit/crouton-devtools` | ○ | Nuxt Devtools |

● = Has database schema (will update `server/db/schema.ts`)
○ = No database tables
**bundled in core** = Automatically included when using `@fyit/crouton-core`

⚠️ **WARNING**: Do NOT add bundled packages (`auth`, `i18n`, `admin`) to your
`nuxt.config.ts` extends array separately. They are already included via
`@fyit/crouton-core`. Adding them separately causes duplicate layer loading
and SSR errors like `$setup.t is not a function`.

### What `crouton add` Does

1. **Validates** module exists and dependencies are installed
2. **Installs** package via detected package manager (pnpm/yarn/npm)
3. **Updates** `nuxt.config.ts` - adds to `extends` array
4. **Updates** `server/db/schema.ts` - adds schema export (if applicable)
5. **Generates** migrations **directly** — drizzle-kit, no Nuxt build (see below)
6. **Applies** migrations with `npx nuxt db:migrate` (if applicable)

#### Direct migration generation — no Nuxt round trip (#1445 WS2)

`lib/utils/generate-migrations.ts` (`generateMigrations(appDir)`) resolves the
app's schema graph directly (`resolveSchemaGraph`, from `schema-sources.ts` — the
same set NuxtHub globs), gates it for duplicate tables (`findDuplicateTables`,
`duplicate-tables.ts`), then runs the app's own `db:generate` (drizzle-kit reads
the runtime-resolving `drizzle.config.ts` and is resolved from the app dir). **No
`nuxt build`, no `nuxt db generate`** — the old build-first dance (build →
poll for `.nuxt/hub/db/schema.mjs` → kill) is gone. Used by `crouton config`,
`crouton add` (step 5), and `crouton init` (step 3).

Failure contract (strengthens #1302 / #1286, fixes #1357's exit-0 disease):
- **Duplicate table** (two DISTINCT defs share a name) → throws `DuplicateTableError`
  naming both files → the CLI exits **non-zero**.
- **Unresolvable `extends`** (e.g. an out-of-monorepo scaffold whose deps aren't
  installed, so a layer can't resolve) → **defers** softly: `{ generated: false,
  reason: 'deferred', recipe }`, the caller prints `manualMigrationSteps()`.
- **drizzle-kit error** → `{ reason: 'generate-failed', detail }` → non-zero.

The scaffolded `drizzle.config.ts` (`tmplDrizzleConfig`) calls
`resolveSchemaSourcesSync(process.cwd())` at runtime — a **sync** resolver
(drizzle-kit's esbuild config loader is CJS and rejects top-level await), imported
with an explicit `.ts` extension, with a **relative** `out` (0.31.10 re-reads
`meta/` via a `./` join; an absolute out ENOENTs on the second run).

## Init Command (Full Pipeline)

Single entry point to go from nothing to a working app:

```bash
# Create app with default settings
crouton init my-app

# With features and theme
crouton init my-app --features bookings,pages,editor --theme ko

# Preview without writing
crouton init my-app --dry-run
```

### Init Options

| Option | Description |
|--------|-------------|
| `--features <list>` | Comma-separated features (e.g., `bookings,pages,editor`) |
| `--theme <name>` | Theme to wire into extends (e.g., `ko`) |
| `-d, --dialect <type>` | `sqlite` or `pg` (default: sqlite) |
| `--no-cf` | Skip Cloudflare-specific config |
| `--domain <zone>` | CF zone for custom-domain routes → `<app>.<zone>` (prod) + `<app>-staging.<zone>` (staging); auto-bound on deploy. Omit → id-less `*.workers.dev` |
| `--dry-run` | Preview without writing files |

### What `crouton init` Does

1. **scaffold-app** — Creates the app skeleton (nuxt.config, package.json, schemas/, etc.) and
   writes a **`.crouton.json`** identifier (`{ name, kind: poc|app, cliVersion, scaffoldedAt }`) —
   provenance + the marker the guard reads. **It refuses only a dir that's already scaffolded**
   (has `.crouton.json` or `package.json`); it **scaffolds *into* a config-only dir** (one that has
   just `crouton.config.js`, e.g. the schema-sign-off step's output) and **preserves that reviewed
   config** — so the schema-first pipeline is a single `crouton init` command, not a manual
   workaround (#1233).
2. **generate** — Generates collections from `crouton.config.js` (if collections are defined)
3. **migrations** — Generates the initial D1 migrations **directly** (drizzle-kit,
   no Nuxt build — see the `crouton add` section). On an out-of-monorepo scaffold
   whose deps aren't installed (so a layer can't resolve) it **defers** and the
   summary prints the exact `pnpm install` → `db:generate` sequence — so a fresh
   app is never silently shipped without its migrations (#523, #1445 WS2).
4. **doctor** — Validates everything is wired correctly
5. **Summary** — Prints next steps (dev server, deploy)

## Rollback Command (`crouton rollback`)

Removes a generated collection — files, schema-index re-export, `app.config.ts`
entry, and layer/root `extends`. Two things WS4 (#1445) got right:

- **Barrel path is resolved, not hardcoded.** Both rollback's `cleanSchemaIndex`
  and the generator's `buildSchemaExportNames` route the schema barrel through
  `getSchemaPath` (`update-schema-index.ts`, modern `server/db/schema.ts` → legacy
  `server/database/schema.ts` → `server/database/schema/index.ts`). Before this,
  rollback only cleaned the legacy `index.ts`, so on a modern app it **no-op'd and
  left a dangling re-export that crashed the next generate.** (The magicast finders
  in `update-schema-index.ts` also had to learn that `$ast` can be the `Program`
  node itself, not a `File` — otherwise they scanned an empty body and matched
  nothing.)
- **The table story.** A default (code-only) rollback removes the collection from
  the schema *view* but the table still lives in the DB + drizzle's `meta/`
  snapshot — so it **names the orphaned table and warns that the next `crouton
  config` will emit its `DROP TABLE`**, bundled into an unrelated migration.
  - `--drop-table` emits that `DROP TABLE` **now**, as its own migration (via the
    WS2 machinery — `generateMigrations`, drizzle-kit, no Nuxt).
  - `--drop-table --dry-run` **previews** the DROP and writes nothing: drizzle-kit's
    CLI has no dry-run flag, so it saves the barrel → removes the export → generates
    into a temp `out` seeded with a copy of `meta/` → prints the SQL → restores the
    barrel byte-for-byte. NB the temp `out` lives **inside the app with a relative
    path** — drizzle-kit 0.31 re-reads `meta/` via a `./`-join, so an absolute out
    ENOENTs on the snapshot (and exits 0 anyway).

## Deploy Scaffolding — Cloudflare Workers (the crouton standard)

When `cf` is enabled (default), `scaffold-app` emits a **Workers (static-assets)**
deploy setup — auto-provisioning, zero manual id-juggling (epic #108 / #114).
NOT Cloudflare Pages. Generated artifacts:

| File | Purpose |
|------|---------|
| `wrangler.jsonc` | Workers config, **id-less** D1+KV (top-level + `env.staging`) so the first deploy auto-provisions them; `name`/`assets`/`main` injected by the `cloudflare_module` preset at build |
| `deploy.config.json` | The opt-in the generic **Deploy Apps/POCs** pipeline reads (#481/#638) — `layerPackages` + the deploy URLs. #1367/#1371: `stagingUrl`/`productionUrl` are emitted **only with `--domain`** (= exactly when the matching custom-domain routes are written), so staging is `https://<name>-staging.<zone>` (NOT the prod pattern). **Without `--domain` → `stagingUrl: ""`**, and the deploy resolves the real `*.workers.dev` URL (#1369) rather than advertising an alias that was never bound (the dead-preview bug). `tmplDeployConfig` in `lib/scaffold-app.ts` |
| `scripts/sync-wrangler-ids.mjs` | After provisioning, queries `wrangler d1 list`/`kv namespace list` and writes the ids back into `wrangler.jsonc` (D1 by `database_name`, KV by the deterministic `<worker>-<binding>` title). Idempotent, comment-preserving |
| `scripts/inject-wrangler-env.mjs` | Re-injects the `env` block Nitro strips from `.output/server/wrangler.json` (nitro#3429) + drops the redirect so `--env staging` deploys work |
| `drizzle.config.ts` | Resolves the bundled schema path (`.nuxt/` or the cache buildDir) so `db:generate` works unedited |

Both `scripts/*.mjs` are **app-name-agnostic** (they read the app's own
`wrangler.jsonc`), shipped as raw templates in `lib/templates/wrangler/` and copied
verbatim. The generated `package.json` chains them:
`cf:deploy` = build → deploy (auto-provision) → `sync:ids` → migrate prod;
`cf:staging` = `NUXT_PUBLIC_CROUTON_REVIEW=true` build → inject-env → deploy `--env staging` → `sync:ids` →
re-inject-env → migrate staging. `nuxt.config` pins **no** nitro preset (supplied via
`NITRO_PRESET=cloudflare_module` in the scripts); `postinstall` is the guarded
`nuxt prepare 2>/dev/null || true`. Reference app: `apps/three-demo`.

**Custom domains (`--domain <zone>`):** when passed, `wrangler.jsonc` also gets
custom-domain `routes` — `<app>.<zone>` (top-level/prod) + `<app>-staging.<zone>`
(`env.staging`). On deploy, wrangler binds them and creates the DNS record + cert
(the zone must be in the same CF account). Nitro preserves top-level `routes`;
`inject-wrangler-env` carries the `env.staging` ones. Without `--domain`, apps stay
on id-less `*.workers.dev` (the CLI stays domain-agnostic for general use). Adding
routes also disables the `*.workers.dev` URL by default (`workers_dev` off).
First real app on this path: `apps/triage` (triage.pmcp.dev, #115).

## DB Pull Command

Pull remote D1 database into local dev in one step (replaces manual export → clear → import workflow):

```bash
# Pull production database
crouton db-pull

# Pull from staging environment
crouton db-pull --env staging

# Keep the exported SQL file
crouton db-pull --keep-sql

# Preview without executing
crouton db-pull --dry-run

# Use custom wrangler config
crouton db-pull --config ./custom-wrangler.jsonc
```

### DB Pull Options

| Option | Description |
|--------|-------------|
| `--env <name>` | Wrangler environment (e.g., `staging` for staging DB) |
| `--config <path>` | Custom wrangler config path (auto-detects `.toml`/`.jsonc`/`.json`) |
| `--keep-sql` | Keep the exported `.db-pull-seed.sql` file after import |
| `--dry-run` | Show what would happen without executing |

### What `crouton db-pull` Does

1. **Detects** wrangler config (`wrangler.toml`, `.jsonc`, `.json`)
2. **Parses** `d1_databases` to get database name and ID
3. **Exports** remote DB via `wrangler d1 export --remote`
4. **Clears** local D1 directory (`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`)
5. **Imports** via `wrangler d1 execute --local` (with sqlite3 fallback)
6. **Cleans up** temp seed file (unless `--keep-sql`)

## Key Options

| Option | Description |
|--------|-------------|
| `--fields-file <path>` | Schema JSON file |
| `--dialect <pg\|sqlite>` | Database dialect (default: sqlite for the direct command; `crouton config` has no flag — it reads the config file's `dialect`, falling back to `sqlite` when omitted or empty) |
| `--hierarchy` | Enable tree structure |
| `--seed` | Generate seed data file (drizzle-seed) |
| `--count <number>` | Number of seed records (default: 25) |
| `--force` | Overwrite existing files |
| `--no-translations` | Skip i18n fields |
| `--no-tests` | Skip the per-collection tests — schema-smoke (#785) + API route handler test (#791); both emitted by default |
| `--dry-run` | Preview without writing |

### Regeneration is non-destructive (#1260)

Re-running the generator over an existing collection **preserves files that already exist**
by default — it never silently clobbers hand-edits — and reports what it skipped
(`⏭ preserved N existing file(s) — use --force to overwrite`). Files that don't exist yet are
always written, so a schema change still scaffolds new artifacts. Pass **`--force`** to overwrite
existing scaffold files (this is what the generated files' *"regeneration requires --force flag"*
note refers to). Only the per-collection scaffold files are guarded this way; derived
machine-owned files (the schema index, type/query registries, `app.config.ts` entries) are
rewritten every run regardless. Guarded by the write loop in `writeScaffold`
(`lib/generate-collection.ts`); contract test: `tests/integration/regenerate-preserve.test.ts`.

## Key Files

| File | Purpose |
|------|---------|
| `bin/crouton-generate.js` | CLI entry point (citty with 12 subcommands) |
| `bin/crouton-seed.mjs` | `crouton-seed` entry — app DB seeding (citty) |
| `lib/seed-app.ts` | Seed runner: discover providers, order, collect SQL, run wrangler. Also seeds the **default layout** (`crouton.layout.json` → `layout_configs[default]`, #709) |
| `lib/compose-layout.ts` | **Deterministic default-layout step** (#709) — after generation, runs `@fyit/crouton-layout`'s `composeDefaultLayout` (moved out of crouton-core, #751) over the generated collections and writes `crouton.layout.json` (a `layout_configs` tree the POC boots with). `registryKeyFor(layer, collection)` mirrors the generated registry key; mirrors the core + bookings block sizing contracts (no live `app.config` at generate time) |
| `lib/generate-collection.ts` | Main orchestrator (~74KB) |
| `lib/init-app.ts` | Init pipeline (scaffold → generate → doctor) |
| `lib/generators/*.ts` | Template generators (16 files) |
| `lib/generators/collection-test.ts` | Emits `<Layer><Collections>.test.ts` — a runtime-free Zod schema smoke (valid parses / invalid rejected). Sample derived from each field's `zod`. On by default; `--no-tests` skips (#785). Also exports the shared sample derivation (`buildCollectionSample`) reused by the API test |
| `lib/generators/api-test.ts` | Emits `<Layer><Collections>.api.test.ts` — drives the generated route handlers (get/post/[id].patch/[id].delete + move/reorder) with a mocked team-auth util + queries module and a fake H3 event; covers team-scoping + 400/403/404 error paths. Same `--no-tests` gate (#791) |
| `lib/db-pull.ts` | Remote D1 → local dev pull |
| `lib/module-registry.ts` | Module definitions for `crouton add` |
| `lib/add-module.ts` | Module installation implementation |
| `lib/rollback-collection.ts` | Remove a collection — files, schema barrel, `app.config`, `extends`. Barrel via `getSchemaPath` (modern→legacy). `orphanTableName`/`dropTableWarning` (the code-only-rollback warning) + `generateDropMigration` (`--drop-table` emit / `--dry-run` temp-out preview) — #1445 WS4 |
| `lib/utils/generate-migrations.ts` | Direct migration generation (`generateMigrations`, `prepareSchemaForMigration`, `DuplicateTableError`) — resolve graph → duplicate gate → app's `db:generate` (drizzle-kit, no Nuxt). Deferral/throw failure contract. Used by config/`add`/`init` (#1445 WS2) |
| `lib/utils/helpers.ts` | Case conversion, type mapping |
| `lib/utils/dialects.ts` | PostgreSQL/SQLite configs |
| `lib/utils/detect-package-manager.ts` | Detect pnpm/yarn/npm |
| `lib/utils/update-nuxt-config.ts` | Update nuxt.config.ts extends |
| `lib/utils/update-schema-index.ts` | Update schema exports (`add`/`removeSchemaExport`) + `getSchemaPath` (resolve the barrel modern→legacy). NB the magicast finders handle `$ast` being the `Program` node itself, not only a `File` (#1445 WS4) |
| `lib/utils/schema-sources.ts` | `resolveSchemaSources(appDir, {dialect})` — reproduces NuxtHub's per-layer `server/db/schema*` glob over the recursive `extends` graph (app root + auto-scanned `layers/*` + `@fyit/*`/subpath extends, realpath-deduped, magicast static parse), WITHOUT a Nuxt process. Feeds drizzle-kit directly; parity-verified vs NuxtHub (epic #1445 WS1a). Duplicate-table gate over its output is WS1b |
| `lib/utils/duplicate-tables.ts` | `findDuplicateTables(resolvedPaths)` — identity-aware gate over the resolver's output: jiti-imports each file through ONE instance, and fails only when a table name maps to ≥2 DISTINCT drizzle objects (benign same-object re-exports pass; catches distinct dups arriving via `export * from` that a regex misses). drizzle-kit otherwise silently last-wins. Epic #1445 WS1b |

## Generators Structure

```
lib/generators/
├── form-component.ts      → Form.vue (Zod validation)
├── list-component.ts      → List.vue (data table)
├── composable.ts          → use[Collection].ts
├── api-endpoints.ts       → GET/POST/PATCH/DELETE
├── database-schema.ts     → Drizzle schema
├── database-queries.ts    → Query functions
├── seed-data.ts           → seed.ts (drizzle-seed data, --seed flag)
├── collection-seed-fixture.ts → seed.json (editable auto-derived sample rows, #298)
├── types.ts               → TypeScript interfaces
├── nuxt-config.ts         → Layer config
├── field-components.ts    → Dependent field components
├── query-registry.ts      → Server-side query registry (lazy imports)
├── collection-test.ts     → <Layer><Collections>.test.ts (Zod schema smoke, #785)
└── api-test.ts            → <Layer><Collections>.api.test.ts (route handler tests, #791)
```

## Schema Format

```json
{
  "id": { "type": "string", "meta": { "primaryKey": true } },
  "name": { "type": "string", "meta": { "required": true, "maxLength": 255, "translatable": true } },
  "price": { "type": "decimal", "meta": { "precision": 10, "scale": 2 } },
  "categoryId": { "type": "string", "refTarget": "categories" }
}
```

### Field Meta Properties

| Property | Type | Description |
|----------|------|-------------|
| `required` | boolean | Field is required |
| `maxLength` | number | Max string length |
| `translatable` | boolean | Enable i18n translation support |
| `default` | any | Default value |
| `primaryKey` | boolean | Mark as primary key |
| `label` | string | Human-readable label |
| `area` | string | Form area: main/sidebar/meta |
| `group` | string | Group fields together (creates tabs when multiple main groups) |
| `options` | string[] | Inline options for USelect dropdown (use with `displayAs: "optionsSelect"`) |
| `displayAs` | string | Display hint: `"optionsSelect"` for dropdowns |
| `optionsCollection` | string | Collection name for database-driven options |
| `optionsField` | string | Field in options collection containing values |
| `creatable` | boolean | Allow creating new options (default: true) |
| `nullable` | boolean | Legacy no-op since #1403: every non-required field already validates `.nullish()` (nullable columns round-trip `null`, and `null` is how a client clears a field) and types as `T \| null` |
| `component` | string | Custom component name override |
| `translatableProperties` | string[] | (Repeater) Properties to support per-item translations |
| `properties` | object | (Repeater) Typed property definitions for repeater items |

### Translatable Fields Pattern

When a field has `translatable: true`, the root-level column becomes a cache/fallback.
The actual value lives in `translations.{locale}.fieldName`.

**Important:** Translatable fields should have `required: false` at the root level,
because the value is derived from translations, not stored directly.

```json
// ✅ Correct: translatable field is NOT required
{
  "title": {
    "type": "string",
    "translatable": true,
    "meta": {
      "required": false,
      "label": "Title"
    }
  }
}

// ❌ Wrong: Will fail when title only exists in translations!
{
  "title": {
    "type": "string",
    "translatable": true,
    "meta": {
      "required": true,
      "label": "Title"
    }
  }
}
```

**Why this matters:**
- When creating a record, the form may only populate `translations.en.title`
- If the root `title` column has `NOT NULL` constraint, the insert fails
- Making it nullable allows the root column to be empty while translations hold the values

### Translatable Repeater Fields

Repeater fields can support per-item translations using `translatableProperties` and `properties`:

```json
{
  "slots": {
    "type": "repeater",
    "meta": {
      "translatableProperties": ["label", "description"],
      "properties": {
        "label": { "type": "string", "required": true, "label": "Slot Name" },
        "description": { "type": "text", "label": "Description" },
        "value": { "type": "string", "label": "Slot ID" },
        "maxCapacity": { "type": "number", "label": "Max Capacity" }
      }
    }
  }
}
```

**Generated data structure:**
```typescript
{
  id: "abc123",
  label: "morning",           // English (default)
  description: "Morning slot",
  value: "slot-1",            // Non-translatable
  translations: {
    label: { nl: "ochtend", fr: "matin" },
    description: { nl: "Ochtendslot", fr: "Créneau du matin" }
  }
}
```

**Generated artifacts:**
- `types.ts`: Item interface with translations support
- `use[Collection].ts`: Typed Zod schema for repeater items
- `[Field]/Input.vue`: Language tabs with completion indicators

## Field Types

| Type | Zod | TypeScript | Default |
|------|-----|------------|---------|
| string | `z.string()` | `string` | `''` |
| text | `z.string()` | `string` | `''` |
| number | `z.number()` | `number` | `0` |
| decimal | `z.number()` | `number` | `0` |
| boolean | `z.boolean()` | `boolean` | `false` |
| date | `z.date()` | `Date \| null` | `null` |
| json | `z.record(z.any())` | `Record<string, any>` | `{}` |
| image | `z.string()` | `string` | `''` |
| file | `z.string()` | `string` | `''` |
| repeater | `z.array(z.any())` or typed¹ | `any[]` or typed¹ | `[]` |
| array | `z.array(z.string())` | `string[]` | `[]` |

¹ When `meta.properties` is defined, generates typed item schema (see Translatable Repeater Fields)

### Type Aliases

Some types accept aliases (defined via `aliases` in each package's `crouton.manifest.ts`).
A schema can use the alias and it resolves to the **canonical** type — so **column type, zod,
ts, the form control, and seed all follow the canonical type**:

| Alias | Canonical | SQLite column | Form control |
|-------|-----------|---------------|--------------|
| `integer` | `number` | `integer()` | `UInputNumber` |
| `datetime` | `date` | `integer({ mode: 'timestamp' })` | `CroutonCalendar` |

**How resolution works (#285):** `getTypeMapping()` (in `lib/utils/manifest-loader.ts`)
tags every entry — canonical *and* alias keys — with a `canonical` field, and `loadFields`
resolves `field.type` through it before any generator runs. So a field's `type` is always the
canonical name and every generator that branches on it (schema column, `form-component`'s
`type === 'date'` → `CroutonCalendar`, the date-serialization logic) sees the canonical type.

⚠️ Aliases must be resolved *before* the generators, not inside `mapType` (which only
validates). Earlier, only `integer` was special-cased and `datetime` leaked through unresolved,
so date fields silently generated a raw `<UInput>` (typecheck error: `Date` vs
`AcceptableValue`) + a `text` column instead of a timestamp. Use `number` for integer columns;
`decimal` is the float/`real` type. A value written as a **string** (e.g. a status enum
`'0'/'1'/'2'`) should be `string`, not `number`.

## i18n Field Labels

Generated `Form.vue` field labels resolve through `useT()` instead of hardcoded strings, so
they can be translated (and team-overridden) like the rest of the app. Each `UFormField`
emits:

```vue
<UFormField :label="t('{layer}.{plural}.fields.{fieldName}', '{Humanized Fallback}')" ... >
```

- **Key convention:** `{layer}.{plural}.fields.{fieldName}` (e.g. `sales.orders.fields.clientName`)
- **Fallback:** the 2nd `t()` arg is a humanized field name (`eventOrderNumber` → `Event Order Number`),
  or `meta.label` when set — so untranslated keys still render readable text, never `[key]`.
- `const { t } = useT()` is added to the generated `<script setup>`.
- Static "Parent" (hierarchy) and "Translations" labels use `crouton.form.parent` / `crouton.form.translations`.

**To translate:** add the `{layer}.{plural}.fields.*` keys to your layer/package locale JSON
(e.g. `i18n/locales/{en,nl,fr}.json`) registered via `i18n.langDir`. No DB seeding required —
vue-i18n merges them at build time; seed into `translations_ui` only if you want admin overrides.

## Generated Output

```
layers/[layer]/collections/[collection]/
├── app/
│   ├── components/
│   │   ├── _Form.vue
│   │   └── List.vue
│   └── composables/
│       └── use[LayerCollection].ts
├── server/
│   ├── api/teams/[id]/[layer]-[collection]/
│   │   ├── index.get.ts
│   │   ├── index.post.ts
│   │   ├── [{singular}Id].patch.ts
│   │   └── [{singular}Id].delete.ts
│   └── database/
│       ├── schema.ts
│       ├── queries.ts
│       └── seed.ts          # Only with --seed flag
├── seed.json                # Editable auto-derived sample rows (#298)
├── [Layer][Collections].test.ts      # Zod schema-smoke test (#785) — skip with --no-tests
├── [Layer][Collections].api.test.ts  # API route handler test (#791) — skip with --no-tests
├── types.ts
└── nuxt.config.ts

# Also generated at app root (aggregated across all collections):
server/utils/crouton-query-registry.ts   # Lazy-loaded query function registry
crouton.layout.json                       # Deterministic default layout tree (#709) — seeded into layout_configs
```

## Generated Tests (#785)

Every generated collection ships a **schema-smoke test** next to it
(`<Layer><Collections>.test.ts`) — on by default, suppressed with `--no-tests`
(or `tests: false` on a collection). It imports the collection's generated Zod
schema from the composable and asserts the deterministic surface: a valid record
parses, an invalid one is rejected. It is **runtime-free** (zod only, no Nuxt/DB,
no mocks), so it stays green for any schema — the unit-level complement to the
**e2e fixture smoke**, which owns boot + CRUD (this does NOT duplicate it).

- The valid sample is derived at generation time from each field's `zod` (the
  same source the schema embeds), so it matches the schema whether or not the
  type manifest resolved. Two overrides mirror `fieldsSchema` in
  `generate-collection.ts`: `date` → `z.coerce.date()` (ISO string), dependent
  fields → non-empty `z.array(z.string()).min(1)`. Auto/system + hierarchy
  fields are excluded; output is deterministic (no `Date.now()`/`Math.random()`).
- `scaffold-app`/`crouton init` emit a `vitest.config.ts` + `test` script + the
  `vitest` devDep, so `pnpm test` runs these out of the box (#789).

### API route handler test (#791)

Each collection also ships `<Layer><Collections>.api.test.ts` next to the
schema-smoke — the depth deferred from #788. It drives the **generated endpoint
handlers** (`index.get`/`index.post`/`[id].patch`/`[id].delete`, plus
`move.patch`/`reorder.patch` for hierarchy/sortable collections) to cover the
runtime logic the schema-smoke can't: **team-scoping** (an unauthenticated
request is rejected and never writes; the happy path calls the query with the
*resolved team's* id — flip `teamId: team.id` in a handler and the test goes red)
and **error paths** (invalid body → rejected before any write, missing id param →
400, a not-found surfaced by the query → 404).

- **Runtime-free-ish:** the team-auth util (`@fyit/crouton-auth/server/utils/team`)
  and the generated `./server/database/queries` module are `vi.mock`ed; the H3/Nitro
  auto-imports the handlers call (`defineEventHandler`, `getQuery`,
  `getRouterParams`, `readBody`, `readValidatedBody`, `createError`,
  `useServerTiming`) are provided as globals via `vi.hoisted` (so the route's
  `export default defineEventHandler(...)` evaluates at import); each handler runs
  against a plain fake H3 event. No Nuxt server, no DB, no network.
- **Same `--no-tests` gate** as the schema-smoke — it rides the one `tests` flag
  (on by default). The assertions are engineered to be schema-shape-independent
  (mock/control-flow driven); the one body-shape-dependent case (invalid-body →
  rejected) is emitted only when an invalid sample is derivable, degrading
  gracefully. The happy-path body reuses the schema-smoke's single-sourced sample
  derivation (`buildCollectionSample` in `collection-test.ts`).
- The emitted file carries `// @ts-nocheck` — it relies on untyped Nitro globals
  and runs under vitest, not the app's `nuxt typecheck`.
- The **e2e fixture smoke** still owns real boot + CRUD; this is the unit-level
  complement (no duplication).

## Default Layout (generate → POC, #709)

After collections are generated, `runPostGeneration` runs the **deterministic
layout pass** (`lib/compose-layout.ts` → `@fyit/crouton-layout`'s `composeDefaultLayout`)
and writes **`crouton.layout.json`** at the app root: a `layout_configs`-format
tree that arranges the generated collections into a good default — **calendar-primary**
when the bookings package is in play, otherwise **master-detail** (list + form),
with extra collections stacked. Each placed block is data-bound (`config.collection`).
The arrangement is **viability-gated** (every block ≥ its `minWidth`); a too-narrow
side-by-side split falls back to a vertical stack.

`crouton-seed` then upserts that tree into the team-scoped `layout_configs` table
(row id `default`), so a freshly seeded POC boots with a real, data-bound layout
instead of a blank canvas — editable in `CroutonLayout` (the layout is **data**,
not generated `.vue`). The LLM `/layout` pass (#711) is gated and out of scope.

## Output Location

**Generated files always go to the current working directory (`cwd`), not the config file location.**

This means `crouton.config.js` can live anywhere — a `Tests/` folder, a shared schemas repo, etc. — as long as you run the command from inside the target app:

```bash
# ✅ Correct — run from inside the app
cd apps/my-app
crouton config ../../Tests/Playground/crouton.config.js
# → layers/ generated in apps/my-app/

# ❌ Wrong — run from config location, output lands there too
cd Tests/Playground
crouton config
# → layers/ generated in Tests/Playground/ (no Nuxt app here)
```

`fieldsFile` paths in the config always resolve **relative to the config file**, not cwd.

`crouton init` handles this automatically — it changes cwd to the new app directory before running generation.

## Config File Format

The `crouton.config.js` is a **unified configuration** that serves both:
- **CLI**: Collection generation (collections, targets, dialect)
- **Module**: Feature flags (features section, read by `getCroutonLayers()`)

```javascript
// crouton.config.js
export default {
  // Feature flags - which crouton packages to enable
  // Used by getCroutonLayers() in nuxt.config.ts
  features: {
    // Core (enabled by default): auth, admin, i18n
    editor: true,     // TipTap rich text
    pages: true,      // CMS pages
    // bookings: true // Enable booking system
  },

  // Collection generation (used by CLI)
  collections: [
    { name: 'products', fieldsFile: './schemas/products.json', hierarchy: true },
    { name: 'authors', fieldsFile: './schemas/authors.json', seed: true },          // seed with defaults
    { name: 'posts', fieldsFile: './schemas/posts.json', kind: 'content', seed: { count: 50 } },  // content kind
    { name: 'bookings', fieldsFile: './schemas/bookings.json', collab: true },      // enable collab presence
    { name: 'pages', fieldsFile: './schemas/pages.json', kind: 'content', formComponent: 'CroutonPagesForm' },
    { name: 'gallery', fieldsFile: './schemas/gallery.json', kind: 'media' }        // media kind
  ],
  dialect: 'sqlite',
  seed: {
    defaultCount: 25,           // default records per collection
    defaultTeamId: 'seed-team'  // team ID for seeded data
  },
  targets: [
    { layer: 'shop', collections: ['products'] }
  ],
  flags: {
    noTranslations: false,
    force: false
  }
}
```

### Features Reference

**IMPORTANT:** `@fyit/crouton-core` automatically bundles auth, admin, and i18n.
DO NOT add these to your `nuxt.config.ts` extends array separately - doing so
causes duplicate layer loading and SSR errors (e.g., `$setup.t is not a function`).

| Feature | Default | Description |
|---------|---------|-------------|
| `auth` | bundled | Authentication (Better Auth) - **included in core** |
| `admin` | bundled | Admin dashboard - **included in core** |
| `i18n` | bundled | Multi-language support - **included in core** |
| `editor` | `false` | TipTap rich text editor |
| `pages` | `false` | CMS pages system |
| `bookings` | `false` | Booking system |
| `sales` | `false` | Point of Sale |
| `email` | `false` | Email with Resend |
| `assets` | `false` | Media library |
| `events` | `false` | Audit trail |
| `ai` | `false` | AI/LLM integration (see below) |
| `collab` | `false` | Real-time collaboration |

**Auto-detection:** Generator contributions from addon packages (editor, assets, maps, collab) run automatically when the schema's fields match the package's detector patterns — even without an explicit feature flag. For example, a field with `"component": "CroutonEditorSimple"` triggers `crouton-editor` contributions regardless of whether `editor: true` is set. Feature flags are still needed for framework package syncing (adding to `nuxt.config.ts` extends).

### AI Feature Configuration

The `ai` feature supports both boolean and object configuration:

```javascript
features: {
  // Simple: uses OpenAI gpt-4o-mini by default
  ai: true,

  // With options: specify model (auto-detects provider from model name)
  ai: { defaultModel: 'claude-sonnet-4-20250514' },  // Uses Anthropic
  ai: { defaultModel: 'gpt-4o' },                     // Uses OpenAI
}
```

**Environment variables required:**
- `NUXT_OPENAI_API_KEY` - For OpenAI models (gpt-*, o1-*, o3-*)
- `NUXT_ANTHROPIC_API_KEY` - For Anthropic models (claude-*)

### Collection Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Collection name (required) |
| `fieldsFile` | string | Path to JSON schema file (required) |
| `hierarchy` | boolean \| object | Enable tree structure with parent/child relationships |
| `sortable` | boolean \| object | Enable drag-drop reordering |
| `seed` | boolean \| object | Generate seed data file with Faker |
| `collab` | boolean | Enable real-time presence indicators |
| `translatable` | boolean | Mark all string fields as translatable |
| `formComponent` | string | Use a custom form component instead of generating Form.vue |
| `kind` | string | Collection kind: `'data'` (default), `'content'`, or `'media'`. Affects admin sidebar grouping |
| `publishable` | boolean | Auto-register as page type in crouton-pages (requires crouton-pages) |
| `tests` | boolean | Emit the per-collection tests — schema-smoke (#785) + API route handler test (#791) — for this collection (default `true`; set `false` to skip, like `--no-tests`) |

### formComponent Option

When a Crouton package (like `@fyit/crouton-pages`) provides its own form component, you can skip generating a redundant Form.vue by specifying `formComponent`:

```javascript
collections: [
  {
    name: 'pages',
    fieldsFile: './schemas/pages.json',
    formComponent: 'CroutonPagesForm',  // Use package-provided form
    hierarchy: true
  }
]
```

**What this does:**
1. Skips generating `Form.vue` in the collection directory
2. Sets `componentName` in the composable to the specified component name
3. The package's form component is used instead for create/edit operations

**When to use:**
- When using `@fyit/crouton-pages` with `features.pages: true` → use `formComponent: 'CroutonPagesForm'`
- When using `@fyit/crouton-bookings` with custom forms → use `formComponent: 'CroutonBookingsForm'`
- When you have a custom form component that handles the collection's data entry

**Dry-run output:**
```
• Form.vue skipped (using CroutonPagesForm)
• layers/pages/collections/pages/app/components/List.vue
...
```

## Examples

Example configuration files are in `examples/`:
- `crouton.config.example.js` - Exhaustive config with all options documented
- `crouton.config.products.js` - Minimal single-collection example

## Common Tasks

### Keep examples in sync (IMPORTANT)

When modifying the generator, **always check if examples need updating**:
1. Adding/removing a flag → Update `examples/crouton.config.example.js`
2. Changing schema format → Update example schemas in comments
3. Changing CLI options → Update CLI reference in example comments
4. Changing defaults → Update documented defaults

### Add a new generator template
1. Create `lib/generators/{name}.ts`
2. Export async function that returns file content string
3. Import in `lib/generate-collection.ts`
4. Call generator in appropriate step

### Add a new field type
1. Add type mapping in `lib/utils/helpers.ts` (getTypeMapping function)
2. Update Zod schema in `lib/generators/composable.ts`
3. Update form component in `lib/generators/form-component.ts`
4. Add Drizzle type in `lib/utils/dialects.ts`

### Image and File Field Types
- `image` → renders `<CroutonAssetsPicker v-model="..." :crop="true" />` in forms, stores `VARCHAR(255)` (asset ID)
- `file` → renders `<CroutonAssetsPicker v-model="..." />` in forms (no crop), stores `VARCHAR(255)` (asset ID)
- Both are auto-detected by the `crouton-assets` manifest `detects.fieldTypes` pattern at generation time

### Add new CLI option
1. Add option to `bin/crouton-generate.js` using Commander
2. Pass to `generateCollection()` in flags object
3. Handle in `lib/generate-collection.ts`

### Debug generation
1. Use `--dry-run` to preview output
2. Check `lib/generate-collection.ts` for step order
3. Individual generators are isolated - test in isolation

## Naming Conventions

```
Collection: products
Layer: shop
→ API path: /api/teams/[id]/shop-products/
→ Component: ShopProductsForm, ShopProductsList
→ Composable: useShopProducts
→ Schema export: shopProducts
```

## Auto-Generated Fields

Always added to schema:
- `id` - Primary key (uuid/nanoid)
- `teamId` - Team association (always team-scoped)
- `createdAt`, `updatedAt` - Timestamps
- `createdBy`, `updatedBy` - User tracking

With `--hierarchy`:
- `parentId`, `path`, `depth`, `order`

With `collab: true` (in config):
- Adds `show-collab-presence` prop to List.vue
- Adds `useSession()` and `collabConfig` computed to script
- Requires `@fyit/crouton-collab` to be extended

## List Filtering by Foreign Key

Collections with foreign-key reference fields (`refTarget`) generate a list endpoint
that scopes results by any FK passed as a query param. For a `products` collection with
`eventId`/`categoryId` refs:

```ts
// GET /api/teams/[id]/sales-products?eventId=evt_123  → only that event's products
const result = await getAllSalesProducts(team.id, {
  eventId: query.eventId ? String(query.eventId) : undefined,
  categoryId: query.categoryId ? String(query.categoryId) : undefined,
})
```

`getAll*(teamId, opts?)` takes a single options bag holding both FK filters and
pagination (`limit`/`offset`). It builds a `conditions` array and applies `and(...conditions)`;
each FK filter is opt-in (applied only when present). This is what scopes
`@fyit/crouton-sales` event-workspace tabs to one event (without it, every event showed the
team-wide union of products/categories/locations/printers/orders).
Owner/createdBy/updatedBy user refs are intentionally excluded from filters.

## List Pagination

Every generated `getAll*` and its GET endpoint support **opt-in** server pagination, on
top of any FK filters. It's always generated (no flag) and is byte-compatible for callers
that don't use it.

**Query function** — two overloads guard the contract: pass `limit` to paginate, omit it
for the full array. The paginated overload is declared **first** (it has a required
`limit`) so non-paginated calls fall through to the array overload:

```ts
export async function getAllSalesProducts(teamId: string, opts: { eventId?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSalesProducts(teamId: string, opts?: { eventId?: string }): Promise<any[]>
// impl: when opts.limit != null → .limit().offset() + a parallel count(*) → { items, total }
```

**GET endpoint** — `?page=1&pageSize=10` switches the response from a bare array to an
envelope. `pageSize` is clamped to `[1, 100]`, default 10:

```ts
// GET /api/teams/[id]/sales-products?eventId=evt_123&page=2&pageSize=20
// → { items, total, page, pageSize }   (no ?page → bare array, unchanged)
```

Client side, `useCollectionQuery(collection, { pagination: { pageSize } })` (in
`@fyit/crouton`) folds `page`/`pageSize` into the query and exposes
`page`/`total`/`pageCount`/`paginationData` for `<CroutonCollection>`. `count(*)` reuses the
same `where` (no joins), so totals respect FK filters.

## Team Authentication

All generated collections are team-scoped. The generator:
- Imports team auth from `@fyit/crouton-auth/server/utils/team`
- Uses `resolveTeamAndCheckMembership()` for membership validation
- Requires the core `@fyit/crouton` package (which bundles auth, admin, and i18n)

**Note:** The core package (`@fyit/crouton`) automatically includes:
- `@fyit/crouton-auth` - Team-based authentication
- `@fyit/crouton-admin` - Admin dashboard
- `@fyit/crouton-i18n` - Internationalization

You only need to add the core package to your `nuxt.config.ts` extends array.

**Note**: The `useTeamUtility` flag has been removed. All collections are now team-scoped by default.

## Dependencies

- **Extends**: None (standalone CLI)
- **Works with**: `@fyit/crouton`
- **CLI deps**: citty (CLI framework), @clack/prompts (interactive prompts), consola (logging), c12 (config loading), magicast (AST config modification)

## Testing

```bash
# Run unit tests
pnpm test

# Watch mode for development
pnpm test:watch

# Test generation (dry run)
crouton shop products --fields-file=schema.json --dry-run

# Test with config
crouton config ./crouton.config.js --dry-run

# Verify generated code
npx nuxt typecheck
```

### Test Coverage

| File | Tests |
|------|-------|
| `lib/utils/helpers.ts` | Case conversion, type mapping, seed generators |
| `lib/generators/types.ts` | TypeScript type generation (snapshot) |
| `lib/generators/composable.ts` | Composable generation (snapshot) |
| `lib/generators/collection-test.ts` | Schema-smoke test emission — import path, per-type sample derivation, valid/invalid cases (#785) |
| `lib/generators/api-test.ts` | API route handler test emission — handler import paths, query-mock factory, auth/team-scope + 400/403/404 cases, hierarchy move/reorder (#791) |

## Seed Data Generation

Generate realistic test data using drizzle-seed + Faker.

### CLI Usage

```bash
# Generate collection with seed file
crouton shop products --fields-file=schema.json --seed

# Generate with custom seed count
crouton shop products --fields-file=schema.json --seed --count=100
```

### Config Usage

```javascript
collections: [
  { name: 'products', fieldsFile: './schema.json', seed: true },           // default 25 records
  { name: 'authors', fieldsFile: './schema.json', seed: { count: 100 } }   // custom count
]
```

### Running Seeds

```bash
# Execute seed file directly
npx tsx ./layers/shop/collections/products/server/database/seed.ts

# Or import and call with options
import { seedShopProducts } from './layers/shop/collections/products/server/database/seed'
await seedShopProducts({ count: 50, teamId: 'my-team', reset: true })
```

### Field-to-Generator Mapping

The generator auto-detects field types and generates appropriate data:
- `email` fields → `f.email()`
- `name`, `fullName` → `f.fullName()`
- `title` → `f.loremIpsum({ sentencesCount: 1 })`
- `description`, `content` → `f.loremIpsum({ sentencesCount: 3 })`
- `price`, `amount` → `f.number({ minValue: 1, maxValue: 1000 })`
- Foreign keys → placeholder values with dependency comments

---

## Documentation Sync Workflow (MANDATORY)

**CRITICAL**: After ANY change to this package, Claude MUST follow this workflow to keep all artifacts in sync.

### Artifacts That Must Stay in Sync

| Artifact | Location | Update When |
|----------|----------|-------------|
| This CLAUDE.md | `packages/crouton-cli/CLAUDE.md` | CLI, options, field types, key files change |
| README.md | `packages/crouton-cli/README.md` | User-facing features change |
| Example configs | `examples/crouton.config.*.js` | Flags, schema format, defaults change |
| Claude Skill | `.claude/skills/crouton.md` | Field types, workflow, commands change |
| MCP Server | `packages/crouton-mcp/` | CLI commands, field types change |
| Auth Package | `packages/crouton-auth/CLAUDE.md` | If `@crouton/auth/server` exports change |
| External Docs | `docs/content/` | Any user-facing change |
| FormPreview.vue | `packages/crouton-designer/.../FormPreview.vue` | Form component mapping changes |

### Step 1: Classify Your Change

Before finishing, identify what type of change you made:

| Change Type | Sync Required |
|-------------|---------------|
| Internal refactor | None |
| Bug fix | Maybe external docs (if behavior changed) |
| New field type | **All artifacts** |
| New CLI flag/option | CLAUDE.md, README, Skill, MCP, External docs |
| New command | CLAUDE.md, README, Skill, MCP, External docs |
| Config format change | CLAUDE.md, README, Examples, Skill, External docs |
| Generator template change | CLAUDE.md (Key Files), maybe External docs |
| Form component mapping change | FormPreview.vue, External docs |

### Step 2: Update Package Documentation

For non-internal changes:

- [ ] **This CLAUDE.md**
  - [ ] CLI Commands section (if commands changed)
  - [ ] Key Options table (if options changed)
  - [ ] Field Types table (if types changed)
  - [ ] Key Files table (if files added/removed)
  - [ ] Common Tasks (if workflows changed)

- [ ] **README.md**
  - [ ] Usage examples
  - [ ] Options documentation
  - [ ] Feature descriptions

- [ ] **Example configs** (`examples/`)
  - [ ] Add new flags/options with comments
  - [ ] Update defaults if changed

- [ ] **FormPreview.vue** (if form-component.ts changed)
  - [ ] Field type to component mapping
  - [ ] Form layout structure (CroutonFormLayout slots)
  - [ ] Default values for field types

### Step 3: Update Claude Skill

If field types, commands, or workflow changed:

- [ ] Update `.claude/skills/crouton.md`
  - [ ] Field Types table
  - [ ] Quick Reference section
  - [ ] Examples (if affected)

### Step 4: Update MCP Server

If CLI commands, flags, or field types changed:

- [ ] Update `packages/crouton-mcp/` (when implemented)
  - [ ] Field type definitions
  - [ ] Tool input schemas
  - [ ] Tool handlers

### Step 5: Update External Documentation

For ANY user-facing change:

```bash
# Search for references in external docs (from monorepo root)
grep -r "crouton" docs/content --include="*.md" | head -20
```

- [ ] Update affected documentation pages
- [ ] Update code examples if syntax changed

### Step 6: Verify Sync

After completing updates, verify everything is in sync:

**Option 1: Use the `/sync-check` slash command in Claude Code**
```
/sync-check
```

**Option 2: Run the CI validation script**
```bash
node scripts/validate-field-types-sync.mjs
```

These tools will:
1. Extract field types from `lib/utils/helpers.ts`
2. Compare with MCP server field types
3. Compare with Claude skill field types
4. Report any mismatches with fix instructions

### Pre-Commit Hook (Optional)

Install the pre-commit hook to get sync reminders when committing generator changes:

```bash
cp .claude/hooks/pre-commit-sync-reminder .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

See `.claude/hooks/README.md` for more options.

### Quick Sync Checklist (Copy-Paste)

```markdown
## Sync Checklist for [describe change]

**Change Type**: [ ] Internal [ ] Bug Fix [ ] Field Type [ ] CLI [ ] Config

### Package Docs
- [ ] CLAUDE.md updated
- [ ] README.md updated
- [ ] Examples updated

### External Artifacts
- [ ] `.claude/skills/crouton.md` updated
- [ ] MCP Server updated (if exists)
- [ ] External docs checked

### Verification
- [ ] `/sync-check` command passed (or `node scripts/validate-field-types-sync.mjs`)
- [ ] `npx nuxt typecheck` passed
```
