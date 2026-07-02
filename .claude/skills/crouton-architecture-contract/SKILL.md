---
name: crouton-architecture-contract
layer: stack
description: The crouton mental model for someone who has never seen this repo — what "layer" means (two different things), the two-halves rule, the three app.config registries, team-scoped multi-tenancy, manifest-driven field types, the numbered invariants with the incidents behind them, and the known-weak points. Use when orienting in this codebase for the first time, when a question is shaped like "how does crouton work / why is it built this way / where does X live", when deciding whether a change belongs in a package or a generated layer, when confused by an extends chain or by croutonApps/croutonCollections/croutonLayoutBlocks, or before proposing any structural change. Trigger phrases: "what is a crouton layer", "package vs generated layer", "how does multi-tenancy work here", "why is there a stub component", "where do field types come from", "what invariants must hold".
---

# Crouton Architecture Contract

The load-bearing mental model of crouton: definitions, design decisions with their WHY, the invariants that must hold, and the honestly-stated weak points. This is theory + contract; the how-to lives in sibling skills.

## When to use / when NOT to use

| You want | Go to |
|---|---|
| The mental model, invariants, "why is it like this" | **this skill** |
| Generate a collection (workflow, MCP tools, gates) | `crouton` skill (`.claude/skills/crouton.md`) |
| Schema JSON format, field-type tables, artifact list | sibling `crouton-generation-reference` |
| Layout engine theory (LayoutTree, viability, placer) | sibling `crouton-layout-reference`; authoring a block → `block-authoring` skill |
| Symptom → root cause lookup | sibling `crouton-diagnostics-index` |
| Cold-start env setup, dist/install traps | sibling `crouton-build-and-env` |
| Which docs are stale vs canonical (full list) | sibling `crouton-docs-trust-map` |
| Which gate fires on a change | sibling `crouton-change-control` |

Trust order when sources conflict: see sibling `crouton-docs-trust-map` §1 (it owns the ranked chain; code beats prose for runtime behaviour).

## Glossary (repo jargon, first-contact)

| Term | Meaning here |
|---|---|
| **crouton** | Three referents: (1) the whole framework; (2) the CLI (`packages/crouton-cli`, bin `crouton`) that generates collections; (3) `@fyit/crouton`, the umbrella Nuxt *module* |
| **collection** | The unit crouton generates: one entity/table, defined by a schema JSON, generated into a self-contained layer dir. Always team-scoped |
| **layer** | A Nuxt Layer (a Nuxt app consumed via `extends`). Two meanings in this repo — see §1 |
| **fieldsFile** | The per-collection field-definition JSON (`schemas/<name>.json`) referenced by `crouton.config.js` |
| **team** | The multi-tenancy unit = a better-auth *organization*. Every generated API lives under `/api/teams/[id]/…` |
| **fixture** | A throwaway generated app in `fixtures/` booted by the Playwright harness in `e2e/` to smoke boot/auth/CRUD (see `fixtures/CLAUDE.md`) |
| **POC** | A real crouton app in `pocs/` incubating a future package; safe-to-fail, no required gates |
| **graduation** | The deliberate spec-driven rebuild of a proven POC into real package(s) + app (`/graduate` skill, epics #916/#992) |
| **gate** | A hold point where a human signs off before the expensive step (Schema #314 / UI #307 / Test #774 / code review). Resume signal is an `lgtm`/`approve` **comment** only (#572) |
| **stage** | Where code lives in the lifecycle, *declared* in `harness.config.mjs` (`poc`/`app`/`package`/unstaged). Resolve with `node scripts/harness-stages.mjs <path>` |
| **manifest** | A package's `crouton.manifest.ts` — declares its field types, bundled-ness, reserved names, contributions (§5) |

## 1. "Layer" means two different things

**Newcomer trap #1.** Both are Nuxt Layers technically, but they play different roles:

1. **Package layer** — `packages/` holds the `crouton-*` packages plus the `crouton` meta package (count: re-verify block). **Most** are publishable Nuxt Layers consumed **as source**: `packages/crouton-core/package.json` has `"main": "./nuxt.config.ts"` (no build step for the layer itself; `dist/` exists only for specific subpath exports — install traps: sibling `crouton-build-and-env`). Exceptions (check each `package.json`): `crouton` **and `crouton-devtools`** are Nuxt *modules* (`"main": "./dist/module.mjs"`), `crouton-cli` is the bin CLI, `crouton-mcp` is the MCP server, `crouton-themes` has no `main` at all (subpath-export theme layers only).
2. **Generated per-collection layer** — inside a consuming app, `layers/<layer>/collections/<collection>/` is itself a nested Nuxt layer with its own `nuxt.config.ts`. Real tree (`fixtures/minimal/layers/main/collections/items/`):

```
layers/main/collections/items/
├── app/components/{_Form.vue, List.vue}
├── app/composables/useMainItems.ts
├── server/api/teams/[id]/main-items/{index.get,index.post,[itemId].patch,[itemId].delete}.ts
├── server/database/{schema.ts, queries.ts}
├── types.ts  nuxt.config.ts  README.md
```
(Newer generations add tests, `seed.json`, and app-root aggregates — the full artifact list is `crouton-generation-reference`'s job.)

**The extends chain, in a real launched app** (`apps/velo/nuxt.config.ts`):

```ts
modules: ['@fyit/crouton'],
extends: [
  '@fyit/crouton-core', '@fyit/crouton-layout', '@fyit/crouton-i18n',
  '@fyit/crouton-assets', '@fyit/crouton-pages', '@fyit/crouton-bookings',
  '@fyit/crouton-email',
  './layers/bookings', './layers/pages',       // ← generated layers
  '@fyit/crouton-maps', './layers/crouton'
]
```

And `@fyit/crouton-core` itself extends `['@fyit/crouton-i18n', '@fyit/crouton-auth', '@fyit/crouton-admin']` (its `nuxt.config.ts`; "Order matters: i18n provides translation system that auth/admin consume") — so auth/admin/i18n arrive **through core** ("bundled"). Velo lists `crouton-i18n` explicitly anyway; see invariant 5 for why that pattern is dangerous with auth/admin.

**The `@fyit/crouton` meta-package is a Nuxt MODULE, not a layer** (`"main": "./dist/module.mjs"`), consumed via `modules: ['@fyit/crouton']` across apps/fixtures/pocs (count: re-verify block). At runtime it **cannot add layers** (comment in `packages/crouton/src/module.ts`: layers must be in `extends` before modules load) — it only wires runtimeConfig and *warns*. Its exported `getCroutonLayers()` extends-builder has **zero in-repo callers**; apps hand-list `extends`, kept in sync by the CLI's `syncFrameworkPackages`. Treat `getCroutonLayers()` as aspirational (§7).

## 2. The two-halves rule (pointer)

Canonical: `packages/crouton/CLAUDE.md` § "Packages vs Generated Layers (IMPORTANT)". In one line: a crouton feature = a **package** (UI, admin pages, nav, composables, i18n — via `extends`) + a **generated layer** (Drizzle schema, API endpoints, configs, types — via the CLI), and they need each other: package without layer → no tables/endpoints (404/500); layer without package → a generic "Collections" sidebar with no dedicated UI. When something "is installed but doesn't work", check which half is missing first.

## 3. The three registries (all `app.config`, defu-merged across layers)

| Registry | Who writes it | Who reads it |
|---|---|---|
| `croutonCollections` | The generator upserts one entry per collection into the app's `app/app.config.ts` | Core's shared CRUD components (`CroutonCollection`, forms, lists) resolve a collection by registry key |
| `croutonApps` | Each addon package self-registers in its own `app/app.config.ts` (e.g. `crouton-bookings`) | Sidebar/nav via `useCroutonApps()`, and **presence detection** via `hasApp(id)` |
| `croutonLayoutBlocks` | Each package contributes placeable layout blocks (defaults in `crouton-layout`; bookings adds calendar blocks) | The layout engine — sibling `crouton-layout-reference` |

**Stub-priority pattern** — mechanics + code are owned by root `CLAUDE.md` § "Optional Cross-Package Components (Stub Pattern)". The WHY this skill adds: optional packages (editor, maps, assets, collab) may or may not be in the extends chain, and Vue has no clean "is this component available?" check (`resolveComponent()` warns unconditionally when absent; `vueApp._context.components` is private API). So core ships no-op stubs (`packages/crouton-core/app/components/stubs/`) at `priority: -1`; the real addon component at default priority silently wins when present — preventing warning spam + broken renders in apps without the addon. Behavior branching uses `hasApp('assets')`. Addons registering routes use a `parentApp` key (type in `crouton-core/app/types/app.ts`) so defu array-merging doesn't collide nav entries.

## 4. Team-scoped multi-tenancy

better-auth with the organization plugin; **team = organization** (canonical package: `packages/crouton-auth`). The resolver is `resolveTeamAndCheckMembership(event)` in `packages/crouton-auth/server/utils/team.ts` — mode-aware per its JSDoc (multi-tenant / single-tenant / personal), returns `{ team, user, membership }`, throws 401/403/404. Every generated endpoint lives at `/api/teams/[id]/<layer>-<plural>/` and starts:

```ts
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
const { team } = await resolveTeamAndCheckMembership(event)
// every query takes team.id
```

Client side: `useTeamContext()` (`packages/crouton-core/app/composables/useTeamContext.ts`) reads the `[team]` route param. There is **no opt-out** — the generator hardcodes the auth import and passes `team.id` to every query (invariant 3). Core also wires a `#crouton/team-auth` nitro alias as a compat path; generated code uses the direct import.

## 5. Manifest-driven field types

Field types are **not hardcoded in the CLI**. Each package declares a `crouton.manifest.ts` (`defineCroutonManifest` from `@fyit/crouton-core/shared/manifest`); the CLI's manifest loader merges them into the type mapping. Core's manifest declares the base types (`string`, `text`, `number`, … — exact list in the file) with `db`/`drizzle`/`zod`/`tsType`/`defaultValue`/`component`, plus **aliases** (`integer`→`number`, `datetime`→`date`) that resolve to canonical *before* generators run — the #285 incident is why (`datetime` once leaked through: raw `<UInput>` + a `text` column). The manifest also owns `autoGeneratedFields` (`id, teamId, owner, createdAt, …` — never declare these), reserved field/collection names, `bundled` (read by the meta module), and `detects` patterns for addon generator contributions. Full tables: sibling `crouton-generation-reference`. **Adding a field type = a manifest change, not a CLI patch.**

## 6. Invariants (compressed to pointers — read the canonical source, don't re-derive)

| # | Invariant | Canonical source | Incident / why |
|---|---|---|---|
| 1 | Dep direction `crouton-layout → crouton-core`, never reverse (shared layout types live in core so feature packages contribute blocks dep-free) | `packages/crouton-layout/CLAUDE.md` ("HARD RULE") | reverse = cycle |
| 2 | Optional components via stub-priority, never `resolveComponent()` | root `CLAUDE.md` § Critical Gotchas | why: §3 |
| 3 | Every collection team-scoped, no opt-out (§4) | the generated handlers themselves | tenancy leaks; API tests go red if `teamId` dropped (#791) |
| 4 | `packages/` is edit-guarded (HARD GATE) | root `CLAUDE.md` § Packages Boundary; hook `gate-package-edits.sh`; flow → `crouton-change-control` | every consumer inherits the change |
| 5 | Never re-extend bundled `auth`/`admin` alongside core | `packages/crouton-cli/CLAUDE.md` | duplicate layers → SSR `$setup.t is not a function` |
| 6 | `hub: { db: 'sqlite' }`, never `hub: { database: true }`; NuxtHub = storage only, never deploy | root `CLAUDE.md` § Critical Gotchas | breaks schema.entry resolution + local migrations |
| 7 | Translatable fields `required: false` at the root column (real value in `translations.{locale}.field`; root is cache/fallback) | `packages/crouton-cli/CLAUDE.md` ("Why this matters") | `NOT NULL` root fails translation-only inserts |
| 8 | Layout is data (a `LayoutTree` in team-scoped `layout_configs`), not generated `.vue` | `crouton-layout/server/database/schema/layoutConfigs.ts` (code) | runtime-editable + diffable for the agent⇄human loop |
| 9 | Field types / capabilities are manifest-declared (§5) — one source, three consumers (CLI, MCP, meta module) | `crouton.manifest.ts` per package | hardcoded tables drift per consumer (#285) |
| 10 | Core's `ensure-hub-blob` module loads before `@nuxthub/core`; don't reorder core's `modules` | comment in `packages/crouton-core/nuxt.config.ts` | `db: 'sqlite'`-only apps still get blob |

(Install/postinstall/typecheck invariants → sibling `crouton-build-and-env`; deploy invariants → `crouton-ci-and-deploy-map`.)

## 7. Known-weak points (plainly)

| Weak point | Evidence | Status |
|---|---|---|
| **Production-SSR 500 on collection pages** — an internal data-fetch loses the auth cookie under `nuxt preview`, so the entire e2e harness runs against `nuxt dev` (source of its huge timeouts) | `e2e/CLAUDE.md`; tracked as **#246** (per the `e2e-smoke` skill) | **unresolved**, load-bearing |
| **`getCroutonLayers()` has zero in-repo callers** — the meta module IS consumed, but its headline extends-assembly API is unexercised; apps hand-list `extends` (CLI-synced) | grep in re-verify block | open question — aspirational or deprecation candidate (owner call) |
| **`packages/crouton-core/CLAUDE.md` is stale** — title claims `@fyit/crouton` (the meta package), references dead names (`nuxt-crouton-i18n`, `@crouton/auth`) | the file itself | don't trust its import examples; full stale list → `crouton-docs-trust-map` |
| **ISR routeRules contradiction** — root `CLAUDE.md` recommends a wildcard `/api/teams/*/...` ISR rule that live code comments mark BROKEN | owner: `crouton-diagnostics-index` § "The ISR routeRules contradiction" | don't add such wildcard rules |
| **CLI mirrors block sizing contracts by hand** — `crouton-cli/lib/compose-layout.ts` "keep in sync" comment (whose own target list has drifted; live default registry is in `crouton-layout/app/app.config.ts`) | the file's comment | silent-drift hazard on `minWidth`/`defaultSize` changes |
| **`packages/crouton-layout/CLAUDE.md` self-contradicts** — marks server-side extraction pending while `layout_configs` schema + API exist on disk | files exist | trust the code |

## Provenance and maintenance

verified: 2026-07-02

Facts checked against the working tree (velo/core/crouton/auth/layout/cli configs + CLAUDE.mds, `fixtures/minimal` generated tree, `e2e/CLAUDE.md`). Issue numbers cited from discovery-report summaries — check the issue if load-bearing. Volatile facts live below, not in the prose:

```bash
ls packages | wc -l                                                             # package count (31 at verification)
grep -rln "modules: \['@fyit/crouton'\]" apps fixtures pocs 2>/dev/null | wc -l # meta-module consumers (15 at verification)
grep -n "extends" apps/velo/nuxt.config.ts                                      # extends chain still hand-listed?
grep -rn "getCroutonLayers" apps/*/nuxt.config.ts fixtures/*/nuxt.config.ts pocs/*/nuxt.config.ts  # still 0 callers?
ls packages/crouton-core/app/components/stubs/                                  # stub list (7 at verification)
grep -n "priority" packages/crouton-core/nuxt.config.ts                         # stubs still -1?
grep -n "500 under production SSR" e2e/CLAUDE.md                                # #246 still unresolved?
grep -n "Keep in sync" packages/crouton-cli/lib/compose-layout.ts               # CLI sizing-mirror comment still there?
node scripts/harness-stages.mjs packages/crouton-core                           # packages still edit-guarded/test-first?
```
