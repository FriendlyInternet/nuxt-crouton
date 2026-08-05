---
name: db-migrations
layer: stack
description: The migration step and the package-owned-table exception — NOT the normal collection flow. For app collections use the crouton CLI/skill (schema JSON → `crouton config`); reach here when you then need to generate/apply the Drizzle migration and hit the schema.mjs-only-after-build gotcha ("No schema files found"), or when adding a package-owned infra table (the crouton-flow pattern) that does NOT go through `crouton config`.
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

# DB migrations & package-owned tables (Drizzle + NuxtHub + D1)

> **Most tables are app collections — use the `crouton` skill/CLI, not this one.**
> Edit `apps/<app>/schemas/*.json`, ensure it's in `crouton.config.js`, run
> `crouton config`. That generates the layer + Drizzle schema. This skill is for
> the **two things the CLI does *not* do**:
>
> 1. **The migrate step** — turning a schema change (even a CLI-generated one)
>    into a committed Drizzle migration, including the gotcha that makes
>    `pnpm db:generate` fail on a clean tree.
> 2. **Package-owned infra tables** — non-collection tables shipped by a package
>    (`flow_configs`, `yjs_collab_states`, `sales_sync_outbox`) that are
>    hand-defined and never touch `crouton config`.
>
> If you're adding a user-facing CRUD collection, stop and use the crouton CLI.

## The pipeline (how a table reaches the DB)

**Since #1445 WS2 there are two shapes.** Which one an app is on is decided by its
`drizzle.config.ts` — check that file first, the rest follows from it.

**Current (CLI-owned resolver) — no Nuxt in the loop.** New scaffolds, `apps/velo`,
`apps/kassa`:

```
schema.ts (app layer OR package)            ← Drizzle table definitions
   └─ resolveSchemaSourcesSync(process.cwd())     ← walks the layer graph directly
        (the same set NuxtHub globs, resolved at drizzle-kit runtime — NO build)
   └─ drizzle-kit generate                        → server/db/migrations/sqlite/NNNN_*.sql
                                                    + meta/_journal.json + meta/NNNN_snapshot.json
   └─ wrangler d1 migrations apply (db:migrate*)  → applies the .sql to D1 (local/remote/staging)
```

Measured on a cold scaffold (#1457): `crouton config` 0.8s, `pnpm db:generate` 1.8s,
`pnpm dev` boots in ~6s. No `nuxt build`, so the build-first gotcha below cannot occur.

**Legacy (bundled `.mjs`) — no app in this repo is on it any more (#1456 was the last).**
Kept because an EXTERNAL consumer on an older scaffold still hits it. This is the
world the build-first recipe further down exists for:

```
schema.ts → NuxtHub scans layers → writes the bundle at BUILD time:
             .nuxt/hub/db/schema.entry.ts            (after `nuxt prepare`)
             …/.nuxt/hub/db/schema.mjs               (ONLY after `nuxt build`)
   └─ drizzle-kit generate  (reads the .mjs bundle)  → …/NNNN_*.sql + meta/
   └─ wrangler d1 migrations apply (db:migrate*)     → applies to D1
```

Both runtimes are SQLite (local better-sqlite3/libSQL via `node-server`, D1 on
Cloudflare), so **one schema + one set of migrations serves both** — never write
D1-only or node-only SQL in a migration.

Key paths (per app, e.g. `apps/kassa`):
- `drizzle.config.ts` — **the tell for which shape you're on.** Current apps call
  `resolveSchemaSourcesSync(process.cwd())` (no `.nuxt`, no build). Legacy apps point
  `schema` at the bundled file, trying `.nuxt/hub/db/schema.mjs` then
  `node_modules/.cache/nuxt/.nuxt/hub/db/schema.mjs`. Either way
  `out: server/db/migrations/sqlite`.
- `server/db/migrations/sqlite/` — generated `NNNN_*.sql` + `meta/` (journal +
  per-migration snapshots). **All committed.** wrangler applies the `.sql`;
  drizzle-kit needs `meta/` to diff the next migration.
- `package.json` scripts: `db:generate` (drizzle-kit), `db:migrate` (wrangler,
  `--local`), `db:migrate:prod` / `db:migrate:staging` (`--remote`),
  `db:seed*` (crouton-seed). NB: never run `npx nuxt db generate` from repo root.

## Squashing a migration history — run the schema diff FIRST (required)

A squash regenerates the baseline **from the schema source**. A hand-written corrective
migration that fixed the *database* but was never reflected back into that source is
therefore **silently reverted**.

This is not hypothetical. kassa's `0019_nullable_printer_location` made
`sales_printers.locationId` nullable, healing a `0016` regression. The schema source
still said `.notNull()`, so the #1455 squash brought the bug straight back — caught only
when the production restore died on real rows:

```
NOT NULL constraint failed: sales_printers.locationId
```

**A table-NAME diff cannot see this** — the table exists on both sides. Compare columns:

```bash
# concatenate the OLD history in order, then diff against the regenerated baseline
for f in $(git show HEAD:apps/<app>/server/db/migrations/sqlite | grep '\.sql$'); do
  git show HEAD:apps/<app>/server/db/migrations/sqlite/$f
done > /tmp/old_history.sql

node scripts/schema-diff.mjs /tmp/old_history.sql \
  apps/<app>/server/db/migrations/sqlite/0000_*.sql \
  --live <the wrangler d1 export dump>
```

Exit 0 = a data-only restore should load cleanly. Exit 1 = it will fail; fix the schema
source and regenerate **before** touching any database.

**Always pass `--live`.** The migration files can have drifted from the database that
actually exists; the live dump is what governs the restore. Without it the script can
only flag the *shape* of the problem, not confirm it.

**Restoring afterwards:** data only — never the old `d1_migrations` rows (that silently
un-does the squash) — and insert in **foreign-key order**, because D1's export is
alphabetical, so `account` precedes `user` and a naive reload dies on a constraint.

## Adding an APP collection (the common case)

Use the **crouton** skill / CLI — don't hand-write the table. Edit the schema
JSON (`apps/<app>/schemas/*.json`), make sure it's in `crouton.config.js`
(`collections` + `targets`), run `crouton config` to regenerate the layer, then
generate + apply the migration (see "Generate the migration" below).

## Adding a PACKAGE-OWNED infra table (the crouton-flow pattern)

For a table that ships with a package and should appear in every consuming app
(an outbox, a config table, a CRDT store) — NOT a user-facing CRUD collection.
Mirror `packages/crouton-flow` exactly:

1. **`packages/<pkg>/server/database/schema.ts`** — define the table with
   `sqliteTable(...)` from `drizzle-orm/sqlite-core`. This is the source of truth.
2. **`packages/<pkg>/server/db/schema.ts`** — one-line re-export:
   `export { myTable } from '../database/schema'`. **NuxtHub scans `server/db/schema.ts`
   across extended layers** to build the bundle, so this is what makes consuming
   apps auto-discover the table (confirm: `.nuxt/hub/db/schema.entry.ts` lists
   your package after a `nuxt prepare`).
3. **`packages/<pkg>/server/database/migrations/NNNN_*.sql`** — hand-write the
   `CREATE TABLE IF NOT EXISTS …` + indexes. This is the package's own copy
   (for direct apply / docs); the consuming app still generates its own numbered
   migration in step "Generate the migration".
4. Editing `packages/` is behind a **hard gate** — get user approval, then
   `echo '<pkg-name>' >> .claude/.package-edit-approved`, edit, and
   `rm .claude/.package-edit-approved` when done. (See root CLAUDE.md.)
5. Document it in `packages/<pkg>/CLAUDE.md` (Key Files + a table/section).

Naming: package tables use the package's prefix (`flow_*`, `sales_*`); column
names in package tables follow that table's own convention (flow uses snake_case).

**The consuming app needs NO CLI step for a package table.** The crouton CLI
(`crouton config`) has zero migration logic and is *not* involved here — don't
add the table to the app's `crouton.config.js`. NuxtHub auto-discovers it from
the package's `server/db/schema.ts` re-export; the app's only job is the normal
migrate step below (`db:generate` auto-includes it, then `db:migrate`) — the same
step any schema change needs. (A package may also ship its own `.sql` for direct
apply via `wrangler d1 execute --file=node_modules/@fyit/<pkg>/server/database/migrations/<file>.sql`.)

## Generate the migration

**On a current app (resolver `drizzle.config.ts`) there is no gotcha** — the whole
section below does not apply. `pnpm --filter <app> db:generate` resolves the layer
graph itself and writes the migration in ~2s:

```bash
pnpm --filter <app> db:generate   # → server/db/migrations/sqlite/NNNN_*.sql + meta/
pnpm --filter <app> db:migrate    # apply locally
```

One behaviour worth knowing (#1457): on a **cold scaffold** `crouton config` does not
produce the migration in the same run — it prints
`↻ Migration deferred — resolve the app's layers first, then re-run: pnpm db:generate`
and exits 0. That is the designed soft-defer (`reason: 'deferred'`, see
`packages/crouton-cli/CLAUDE.md`), not a failure. Run `db:generate` and carry on.

### The build-first gotcha — LEGACY scaffolds only (no app in this repo, since #1456)

Applies **only** where `drizzle.config.ts` still points at the bundled `.mjs`.
`pnpm --filter <app> db:generate` reads `.nuxt/hub/db/schema.mjs`. On a freshly
cloned / prepared tree **that file does not exist yet** — `nuxt prepare` only
writes `schema.entry.ts`; the `.mjs` bundle is emitted during **`nuxt build`**.
Two failure modes you'll hit:

- `Error  No schema files found for path config ['.nuxt/hub/db/schema.mjs']`
  → the bundle hasn't been built.
- Pointing drizzle-kit at `schema.entry.ts` directly fails with
  `ERR_PACKAGE_PATH_NOT_EXPORTED … not defined by "exports"` — drizzle-kit can't
  resolve the cross-package aliases (e.g. crouton-auth subpaths) that only Nuxt's
  bundler rewrites. **Don't go down this path.**

**The fix — build once to emit the bundle, then generate:**

```bash
cd apps/<app>
# Emit the schema bundle. node-server preset is fine; the bundle is written
# early (before the slow Nitro stage), so you can stop the build once it exists.
NITRO_PRESET=node-server nuxt build &
# wait until the bundle appears, then stop the build:
until [ -f .nuxt/hub/db/schema.mjs ] \
   || [ -f node_modules/.cache/nuxt/.nuxt/hub/db/schema.mjs ]; do sleep 2; done
pkill -f "nuxt build"

# Sanity: confirm your new table is in the bundle
grep -l "<yourTableName>" node_modules/.cache/nuxt/.nuxt/hub/db/schema.mjs .nuxt/hub/db/schema.mjs 2>/dev/null

pnpm db:generate            # → server/db/migrations/sqlite/NNNN_*.sql (+ meta updates)
```

Then **inspect the generated `.sql`** — it should contain ONLY your change. If it
includes unrelated drift, the committed `meta/` snapshots were stale; reconcile
before committing (don't blindly ship the drift).

Apply locally: `pnpm db:migrate` (wrangler `--local`). Commit the `.sql`, the new
`meta/NNNN_snapshot.json`, and the updated `meta/_journal.json` together with the
schema change.

## Validate without booting Nuxt (fast check)

To prove a migration's SQL is valid and a table accepts the rows your code
writes, run the migration against an in-memory DB with the repo's `better-sqlite3`
(run the script from inside the repo so `node_modules` resolves):

```bash
cd /path/to/repo-root   # so imports resolve
node ./.check.mjs        # import Database from 'better-sqlite3'; db.exec(readFileSync(<migration.sql>)); insert + query
rm ./.check.mjs
```

## Gotchas / rules

- **`hub: { db: 'sqlite' }`** in nuxt.config — never `database: true` (breaks the
  schema entry + local migrations). See root CLAUDE.md.
- Migrations are **append-only and committed** — never edit an applied `NNNN_*.sql`;
  add a new one.
- `meta/` is required for correct future diffs — always commit it with the `.sql`.
- Drizzle `$default`/`$onUpdate` are **app-level** defaults; they do NOT emit SQL
  `DEFAULT` clauses. If a column must have a value when written outside your code,
  set the SQL default in the migration (the package's hand-written `.sql` can; the
  drizzle-generated app `.sql` won't). Keep your insert code setting the values
  explicitly so both paths agree.
- Typecheck after: `pnpm -r --filter './apps/*' typecheck` (or `--filter <app>`).
```
