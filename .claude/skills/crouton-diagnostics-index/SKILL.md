---
name: crouton-diagnostics-index
layer: stack
description: Symptom → root-cause lookup table for nuxt-crouton's recurring failure modes — exact error strings mapped to their known cause, fix, and evidence issue. Use when you hit an error you don't recognize in this repo, before debugging from first principles. Trigger phrases and symptoms: "Cannot resolve entry module .nuxt/hub/db/schema.entry.ts", "Could not load '@fyit/crouton'", "No migrations present", "No schema files found", "$setup.t is not a function", "does not provide an export named 'Map'", "no such table: translations_ui", "collection pages 500 in production", "the build was green but the app is broken", "is this a known issue?".
---

# crouton-diagnostics-index

One lookup table: exact symptom → known root cause → fix → evidence. Check here FIRST — most errors in this repo have already been fought once and have a one-line answer. Two kinds of rows: **pointer rows** (the fix is fully documented in a canonical home — root `CLAUDE.md`, the `db-migrations` or `e2e-smoke` skill — so the row is just verdict + pointer) and **full rows** (code-derived fixes with no other home — this table IS their canonical home). No row retells an incident's story — "why this rule exists" always lives in sibling `crouton-failure-archaeology`.

Context for readers new to the repo: **crouton** is this monorepo's code-generation framework (schema JSON → full CRUD Nuxt layers); apps in `apps/`/`pocs/` consume `packages/@fyit/crouton-*` as Nuxt layers, some of them **dist-consumed** (must be built before use). Storage is NuxtHub → Cloudflare D1/KV/R2; deploys go to Cloudflare Workers.

## When to use / when NOT to use

| You want | Go to |
|---|---|
| "I hit error X — is it known?" — domain interpretation of a symptom | **this skill** |
| The PROCESS for a reported bug (first-bad-commit protocol, `git log -S`/`bisect`, ruling out non-code causes) — a HARD GATE before any fix | `bug-archaeology` skill |
| The full narrative behind an incident (what was tried, why the fix is shaped that way, rejected approaches) | sibling `crouton-failure-archaeology` |
| Install/build/typecheck trap depth (cold-start sequence, pins, toolchain) | sibling `crouton-build-and-env` |
| Boot/seed/inspect/observe a running app | sibling `crouton-run-and-operate` |
| Migration mechanics (build-first recipe, package-owned tables) | `db-migrations` skill |
| Running the fixture smoke + its failure triage | `e2e-smoke` skill |

Rule of engagement: a table hit here does NOT waive the `bug-archaeology` gate for a *reported* bug — it makes the archaeology fast (you already know the likely first-bad class; confirm and record it on the issue).

## The lookup table

### Boot / install / typecheck

| Symptom (exact text where known) | Root cause | Fix / action | Evidence |
|---|---|---|---|
| `Cannot resolve entry module .nuxt/hub/db/schema.entry.ts` | app config used `hub: { database: true }` | use `hub: { db: 'sqlite' }` — canonical: root `CLAUDE.md` §Critical Gotchas | root `CLAUDE.md`; depth: `crouton-build-and-env` |
| `Could not load '@fyit/crouton'` (or any `@fyit/*`) during install / `nuxt prepare` / boot | dist-consumed package not built; a bare `postinstall: nuxt prepare` aborts the whole install | `pnpm build:packages` + guarded postinstall — canonical: root `CLAUDE.md` §postinstall guard | root `CLAUDE.md`; depth: `crouton-build-and-env` §2 |
| `Could not load @fyit/crouton-devtools` in a DEPLOY workflow only | shared layer-build cache keyed without build-set identity (fixed) | should not recur; if it does, suspect the deploy workflow's cache key | #740 → #745; why: `crouton-failure-archaeology` §B |
| Thousands of typecheck errors at once | `nuxt typecheck` run outside an app dir | `pnpm typecheck` from root — canonical: root `CLAUDE.md` §MANDATORY TypeScript Checking | root `CLAUDE.md` |
| `Cannot find module '@vue/compiler-sfc'` (or similar phantom type error) after a dep bump | stale/unhoisted `node_modules`, not code | `rm -rf node_modules && pnpm install` — canonical: `dependency-sweep` skill | the #424 class |
| Code "regression" right after pulling / switching worktrees, `git log` shows nothing | stale local install (e.g. missing pnpm symlink) — non-code cause | rule out non-code causes BEFORE blaming a commit — protocol: `bug-archaeology` skill | #424; story: `crouton-failure-archaeology` §C |
| `npx playwright install` fails → "no browser" | download host egress-blocked; chromium IS pre-installed at `/opt/pw-browsers/` | never conclude "no browser" — canonical: root `CLAUDE.md` §headless browser; `crouton-harness-observability` §5 | #629 |

### Database / migrations / seeding

| Symptom | Root cause | Fix / action | Evidence |
|---|---|---|---|
| `No schema files found for path config ['.nuxt/hub/db/schema.mjs']` from `db:generate` | the bundled schema `.mjs` exists only after `nuxt build` | build-first recipe — canonical: `db-migrations` skill | #523; `packages/crouton-cli/lib/utils/generate-migrations.ts` |
| `No migrations present` on the STAGING migrate step, though migrations exist on disk | `--config .output/server/wrangler.json` doubles the relative `migrations_dir` | drop `--config` from the staging apply — canonical: root `CLAUDE.md` §Scripts | #138 |
| `No migrations present` on a FRESH scaffold's first deploy | old CLI ran `db:generate` with no build → silently zero migrations | CLI now builds first; on an old scaffold run the build-first recipe + **commit** the migrations — canonical: `db-migrations` skill | #523/#457; why: `crouton-failure-archaeology` §B |
| Fresh app 500s on every admin load; server log shows `no such table: translations_ui` | app gets crouton-i18n transitively (via crouton-core) but never created the overrides table | already fixed by graceful degradation — reads try/catch "no such table" → `[]`, `useT()` falls back to bundled locale JSON (`packages/crouton-i18n/server/utils/translationsQueries.ts`). Seeing this on current code ⇒ stale package dist — rebuild. Do NOT "fix" by shipping the migration from the package — rejected approach; why: `crouton-failure-archaeology` §B (#685). Package-owned-table pattern: `db-migrations` skill | #680 → #700 (fix), #685 (rejected) |
| Ran `db:seed` but the running dev app shows no data | seeder writes miniflare D1; `nuxt dev` reads `<app>/.data/db/sqlite.db` — two different files | owned by sibling `crouton-run-and-operate` (the miniflare-vs-`.data` split) | code-derived; see that skill |

### Runtime / SSR / dev server

| Symptom | Root cause | Fix / action | Evidence |
|---|---|---|---|
| SSR error `$setup.t is not a function` (or other composable suddenly "not a function") | duplicate layer loading: the app re-extends `@fyit/crouton-auth` / `-admin` / `-i18n` alongside `@fyit/crouton-core`, which already bundles all three | remove the explicit extends — core provides them | `packages/crouton-cli/lib/utils/framework-packages.ts`; `packages/crouton-cli/CLAUDE.md` |
| `module '.../maplibre-gl.js' does not provide an export named 'Map'` — maps forms crash, collection viewer never mounts (dev) | maplibre-gl v5 is CJS-only; having it in `build.transpile` makes Vite resolve named imports against raw CJS | it must be in `vite.optimizeDeps.include` (esbuild synthesizes named exports), NOT in `build.transpile` — already set in `packages/crouton-maps/nuxt.config.ts`; the pattern generalizes to any CJS-only dep | #624; caught by the `with-maps` e2e fixture; story: `crouton-failure-archaeology` §B |
| Collection pages **500 under production SSR** (`nuxt preview` / prod preset) while `nuxt dev` works | **OPEN — no confirmed root cause.** Best current description: "an internal data-fetch loses the auth cookie" | no fix yet; tracked #246. Workaround everywhere: the e2e harness deliberately runs against `nuxt dev` (source of its huge timeouts). Don't burn a session re-deriving this; if you actually root-cause it, record on #246 | `e2e/CLAUDE.md`; `.claude/skills/e2e-smoke/SKILL.md` |
| `pnpm dev` hard-fails with ENOENT in a devtools-enabled app that has no events package | server handlers with **literal cross-package import specifiers** — nitro eagerly resolves them at build; fixed by registering the events RPC handlers only `if (hasEventsPackage)` | fixed in `packages/crouton-devtools/src/module.ts`; treat as a footgun CLASS when writing server handlers that import another package's paths | #799 |
| `node .output/server` dies with `ERR_MODULE_NOT_FOUND` on drizzle-orm paths (node-server preset) | Nitro's externalizer mangles drizzle-orm's internal cross-imports in this pnpm monorepo (broken absolute pnpm-store paths) | inline it: `nitro.externals.inline: ['drizzle-orm']` for the non-Cloudflare target — see `apps/fanfare/nuxt.config.ts`; any second node-server app WILL hit this | #798 |
| `z.record(valueSchema)` mysteriously fails under Vitest + Zod v4 | Zod v4 bug with the implicit-key form | always `z.record(keySchema, valueSchema)` — encoded as a do-not-use sanity test | `packages/crouton-i18n/app/composables/__tests__/zod-sanity.test.ts` |

### Tests / e2e / evidence

| Symptom | Root cause | Fix / action | Evidence |
|---|---|---|---|
| `exports is not defined` in e2e config/specs | `import.meta.url` used — repo root is CommonJS, Playwright transpiles to CJS | use `__dirname` / `join` in `e2e/**` — canonical: `e2e/CLAUDE.md` §Gotchas | `e2e/CLAUDE.md` |
| A piped command "succeeded" but the run clearly failed (classic: browser launch) | `… \| tail` masks the real exit code | check the tail **content**, never `$?` after a pipe — canonical: `e2e-smoke` skill | that skill |
| `Could not initialize provider bunny/google` in dev/test logs | font-provider egress 403 — noise; ignore | canonical: `e2e-smoke` skill | that skill |
| e2e auth/setup failure ("Could not authenticate test user") | missing `BETTER_AUTH_SECRET` or stale `e2e/.auth/` state | triage owned by the `e2e-smoke` skill (delete `.auth/` + rerun) | that skill, Step 4 |
| **Green build + clean typecheck + live deploy URL — app 500s on every request** | the "proxies for done lie" class (missing `server/db/schema.ts`, ported POC code, self-reported success) | verify with a REAL probe: `node scripts/smoke-deployed.mjs --url <preview> …` (login + CRUD round-trip), never a build signal. Case law + why: `crouton-failure-archaeology` §A; the done-rule: `AGENTS.md` §"Done is signed off, not asserted" | #988, #603, #1019 |

### Silently-OFF features that look like bugs

Things a user may report as broken that are **deliberately disabled** — don't debug them as regressions:

| "Bug" report | Reality | Evidence |
|---|---|---|
| "Password breach check (haveIBeenPwned) isn't firing" | commented out on purpose: better-auth's plugin reads AsyncLocalStorage inside `password.hash()`, which is lost on CF Workers (confirmed on `/reset-password`); path-exclusion doesn't help | `packages/crouton-auth/server/lib/auth.ts` (`KNOWN ISSUE` + `TODO: Re-enable` markers) |
| "Pages API responses aren't ISR-cached" | ISR for pages is disabled — see the contradiction below | `packages/crouton-pages/nuxt.config.ts` |
| "Non-admin team members can edit UI translations" | known gap, not a regression: the admin check is a TODO (`// TODO: Add admin check when isTeamAdmin is available`), only membership is enforced | `packages/crouton-i18n/server/api/teams/[id]/translations-ui/index.{post,patch,delete}.ts` |

## ⚠️ The ISR routeRules contradiction (the repo contradicts itself)

- Root `CLAUDE.md` (§"ISR/SWR Caching") **recommends** exactly: `'/api/teams/*/pages/**': { isr: 3600 }`.
- `packages/crouton-pages/nuxt.config.ts` has that **exact rule commented out and marked `BROKEN: conflicts with pages-pages layer routes`** — "Wildcards like '/api/teams/*/pages/**' break layer route matching in Nitro 2.13.1".
- `apps/velo/nuxt.config.ts` independently warns: the wildcard "conflicts with radix3's :id parameter routing and breaks ALL /api/teams/:id/* generated collection routes".

The nominal doc trust order (see `crouton-docs-trust-map` §1) doesn't settle this — it's a **doc-vs-working-code** conflict, not doc-vs-doc: two independent code comments record a live runtime failure the doc's example causes. **Operational rule: do NOT add wildcard `/api/teams/*/...` routeRules; treat root CLAUDE.md's ISR example as stale/known-broken.** Whether a newer Nitro fixes the radix3 conflict is unverified — re-test before re-enabling. Fixing the root doc is tracked as issue #1095.

## Discriminating experiments (cheap probes that split hypothesis classes)

Run the ONE probe that halves your hypothesis space before reading any code:

1. **Stale install vs code bug** — `rm -rf node_modules && pnpm install && pnpm build:packages`, retry. Gone ⇒ non-code cause (#424 class); record that per `bug-archaeology`, don't "fix" code.
2. **Source vs dist skew** — fix exists in `packages/*` source but the app still misbehaves? The package is dist-consumed and stale: `pnpm --filter @fyit/<pkg> build` (or `pnpm build:packages`), retry.
3. **Data vs code** — wipe the local dev DB (`rm -rf <app>/.data`) and reboot; NuxtHub re-applies all migrations at dev boot. Gone ⇒ bad data/state, not code.
4. **Local vs deployed** — reproduce against a fixture (`E2E_FIXTURE=minimal pnpm test:e2e`) or local dev. Only-deployed failures point at env/secret/binding: `npx wrangler tail <worker>` + `node scripts/db-counts.mjs --app <app> --env staging` (see `crouton-run-and-operate`).
5. **Dev vs prod preset** — works under `nuxt dev`, fails built? Check preset-conditional code (`isCloudflare`, `NITRO_PRESET`) and remember collection pages 500 under production SSR anyway (#246) — don't attribute that known-open failure to your change.

## Provenance and maintenance

Every error string was grepped to its source in the working tree; file paths and symbol names above are the durable anchors — line numbers are deliberately kept OUT of the prose (they drift; re-locate with the greps below). Issue numbers (#138 #246 #424 #457 #523 #603 #624 #680 #685 #700 #740 #745 #798 #799 #988 #1019) are cited from the discovery sweep's issue summaries — check the issue before relying on its narrative. The #740–#745 cache-key story and the #988/#603/#1019 false-green class are **issue-derived, not reproduced here** (their narratives live in `crouton-failure-archaeology`).

verified: 2026-07-02

```bash
grep -n "database: true\|isr: 3600" CLAUDE.md                          # gotcha + stale ISR example still in root doc? (#1095 open?)
grep -n "isr" packages/crouton-pages/nuxt.config.ts apps/velo/nuxt.config.ts   # contradiction comments still live? (was pages:110-115, velo:75-77)
grep -n "500 under production SSR" e2e/CLAUDE.md                       # #246 still open? (was e2e/CLAUDE.md:307-309)
grep -n "haveIBeenPwned" packages/crouton-auth/server/lib/auth.ts      # breach check still off? (was auth.ts:708-714)
grep -rn "TODO: Add admin check" packages/crouton-i18n/server/api/     # i18n admin-check gap still open? (unfixed as of 2026-07-02)
grep -n "no such table" packages/crouton-i18n/server/utils/translationsQueries.ts   # graceful degradation still in place? (was :124)
grep -n "optimizeDeps" packages/crouton-maps/nuxt.config.ts            # #624 fix still in place? (was :44-63)
grep -n "hasEventsPackage" packages/crouton-devtools/src/module.ts     # #799 guard still in place? (was :157-163)
grep -n "drizzle-orm" apps/fanfare/nuxt.config.ts                      # #798 inline still in place? (was :93-101)
grep -n "z.record" packages/crouton-i18n/app/composables/__tests__/zod-sanity.test.ts   # sanity test still present? (was :55-66)
```
