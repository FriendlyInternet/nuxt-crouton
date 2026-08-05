# Epic plan (DRAFT rev 7, sixth review folded): CLI-owned migration generation — kill the nuxt-build round trip

> **Status: rev 7 (2026-07-11) — TRACKED: epic
> [#1445](https://github.com/FriendlyInternet/nuxt-crouton/issues/1445), sub-issues
> #1446 (WS1a) · #1447 (WS1b) · #1448 (WS2.0 spike) · #1449 (WS2) · #1450 (WS3) · #1451 (WS4) ·
> #1452 (WS5 sub-epic: #1453–#1457). The epic is now the source of truth for status; this brief
> is the design record.** Six adversarial review
> passes on 2026-07-11. **Sixth review verdict: approve-with-changes — this rev folds its
> findings 1–10; nothing blocks `/issue-dedup` → epic creation.** Rev 7 folds: line cites
> **re-anchored to `63098d3c7`** (origin/main — `f9249a4db`/#1414 and `52fff0b31`/#1415 via
> PR #1418 both MERGED; the predicted +14 late-file shift verified exact and applied); WS5's
> layout removal now names the **package.json dep** too (both halves — the #1121 lesson the
> brief itself teaches in §0); with-sales demoted from "the repo's only" to "the only
> fixture-sized" layer-reachable-twice case (fanfare has the same shape); probe-0 FALSE
> branch (b) corrected (a tolerated stale id is live-but-broken, NOT self-healed on first
> deploy); §8 7c's assertions pinned (a naive implementation already exits non-zero — the
> recipe is what discriminates); §7 Q6's evidence made precise (devDependencies; scaffolds pin
> `^0.31.0` non-catalog; velo dep cite `:43`); probes 0a/0c tightened (pure-rename sub-step;
> secret must be functional, not just listed); **WS2.0 extracted — the esbuild-config-import
> probe runs as a pre-flight spike BEFORE WS2's test sign-off**; WS1b's
> execute-at-generate-time hazard noted; WS3's no-dialect case labelled a regression guard.
> Rev 6 folded the fifth review's findings 1–12: the WS5 runbook's
> window-(a) contradiction fixed (prod-down is bounded by `/deploy-production`, NOT the PR
> merge); **drizzle-kit version ownership specified** (resolve from the app dir; the
> second-run-no-op contract case now runs via the app's own `pnpm db:generate`); the
> secrets-survival check added to probe 0; `with-sales` removed from the benign-duplicate list
> (verified: it doesn't extend bookings and no bridge in its graph re-exports auth); the
> `hub:db:schema:extend`-unused claim converted to a repo-wide grep assertion in the WS1
> contract suite; the nesting-only parity fixture NAMED (`fixtures/nested-schema`); a
> no-Nuxt-aliases sabotage added (§8 7c); the enumeration loader named (**jiti** — already the
> CLI's runtime, `bin/crouton-generate.js:15`); WS1 split into WS1a/WS1b and WS5 reshaped into
> an adoption sub-epic; probe-0 FALSE branches made concrete; **§7 Q6 resolved → runtime
> resolution** (baked list recorded in §6); §7 header/numbering fixed.
> Rev 5.1 (same day) recorded the **owner decision: crouton-layout stays out of everything for
> now — it's still a POC** (resolves §0 gate 1 + the old §7.5; revisit at
> [#983](https://github.com/FriendlyInternet/nuxt-crouton/issues/983)) and added the
> issue-sweep cross-links (§3, "Issue-sweep additions") — comment on those at epic creation.
> Line cites are anchored to **`63098d3c7`** (origin/main at the sixth review, 2026-07-11) —
> re-anchored in rev 7 after `fix/1414-partial-locale-patch` (`f9249a4db`) merged (+14 applied
> to all `generate-collection.ts` cites past ~1440; early-file cites unchanged; every shifted
> cite re-verified against origin/main, not arithmetic alone). NB `generate-collection.ts` is a
> hot file (two merges in one week: #1414, #1415) — re-verify cites at WS2 pickup.
> **Method rule (rev 5, kept): every load-bearing claim in this brief must carry a named way to
> test it** — a contract test, a §8 sabotage step, or a pre-flight probe. A claim with no test
> is a hypothesis and must be labelled as one.
> On approval: run `/issue-dedup`, create the epic + sub-issues via `github-tasks`, labels
> `pkg:crouton-cli` + `type:feat` + `epic`.
> Per `writeups/` rules this file is context, not agent instructions.
> Prior positive evidence stands (rev 5 lineage, all re-verified fifth pass): drizzle-kit
> 0.31.10 loads a real app barrel incl. the `@fyit/crouton-auth` dist subpath (18 tables,
> exit 0); the identity-aware duplicate rule, the velo/triage #1385 instances, the WS5 runbook
> mechanics, and the WS4 DROP-on-next-generate consequence all held against the code.

## 0. Prerequisite — NOT in this epic, and gated on a product decision

**[#1121](https://github.com/FriendlyInternet/nuxt-crouton/issues/1121) has a small fix under the
CURRENT pipeline** and must not wait for (or be credited to) this epic: the scaffold omits
`@fyit/crouton-layout` from new apps — `lib/utils/framework-packages.ts` has no layout entry AND
`scaffold-app.ts`'s `buildDependencies` never adds the workspace dep, so the fix needs **both** the
`extends` entry and the `package.json` dep. NuxtHub's scan (`@nuxthub/core@0.10.4`,
`dist/module.mjs:302-306`) picks up `crouton-layout`'s `server/db/schema.ts` bridge wherever the
layer is actually resolved.

**Two gates on filing it, found in the second review:**
1. **crouton-layout is WIP** (owner, 2026-07-11) — scaffolding it default-on into every new app is
   a *product decision* about the package's readiness, not a mechanical bug fix.
   **→ RESOLVED (owner, 2026-07-11, rev 5.1): layout stays out of everything for now — it's
   still a POC.** The #1121 extends/dep fix is DEFERRED, not filed; the revisit trigger is the
   layout graduation epic [#983](https://github.com/FriendlyInternet/nuxt-crouton/issues/983)
   (POC → package, test-first). Until then new scaffolds correctly omit layout.
2. The fix helps **future scaffolds only**. **Eight** in-tree apps already extend crouton-layout
   and still have no `layout_configs` migration: `pocs/snippets`, `alexdeforce`, `kvr`,
   `sintlukas`, `crouton-builder-demo`, `fixtures/minimal`, **plus (found fourth review)
   `apps/velo` (nuxt.config.ts:16) and `apps/triage` (:15)**. (`apps/fanfare` extends it too
   but got the table in `0018_redundant_blizzard.sql`.) That is **#1385, which this precursor
   does NOT fix** (rev 2 wrongly bundled it here). See §1: #1385 is motivating evidence for this
   epic — and the velo/triage instances feed the WS5 baseline decision directly.

This epic's success is measured WITHOUT the layout symptom either way (see §2).

## 1. Problem statement

To produce a D1 migration today, the CLI round-trips through Nuxt — twice, in two different ways
(line numbers as of `63098d3c7`, 2026-07-11):

- **`crouton config` path** (`lib/generate-collection.ts:1446-1520`, `runBatchDatabaseSetup`,
  called at `:1604`): `execAsync('npx nuxt db generate')` behind a **30s** timeout (`:1485-1492`).
  Its only job is to make Nuxt produce/refresh `.nuxt/hub/db/schema.mjs` and run drizzle-kit
  against it.
- **`crouton init` / `crouton add` path** (`lib/utils/generate-migrations.ts`, called from
  `init-app.ts:74` and `add-module.ts:184`): spawn `npx nuxt build` (NITRO_PRESET=node-server),
  poll up to **180s** for the bundle to appear (two candidate paths: `.nuxt/hub/db/schema.mjs` and
  `node_modules/.cache/nuxt/.nuxt/hub/db/schema.mjs`), kill the build, then run the app's
  `db:generate`. **It reuses a pre-existing bundle by default** (`reuseExistingBundle = true`
  default at `generate-migrations.ts:66`, takes effect at `:76`) — a stale bundle predating an `extends` change silently yields
  migrations missing the new layer's tables. `init` also calls `runConfig` first (step 2), which
  itself attempts `runBatchDatabaseSetup` — a redundant double-attempt per scaffold.

What that Nuxt build actually provides is small and reproducible: NuxtHub globs
`server/db/schema.ts` (+ `schema.<dialect>.ts`, `schema/*.ts`) per resolved layer dir
(via `getLayerDirectories(nuxt)`), writes a `schema.entry.ts` that is a flat
`export * from '<abs path>'` list, and tsdown-bundles it to `schema.mjs` (globs + entry template
at `module.mjs:303-339`; the tsdown build itself lives in `dist/db/lib/build.mjs`, called from
`:331`/`:342`; note `nuxt prepare` emits only `schema.entry.ts`, never the `.mjs` — the
#523/#529 root cause).
**The bundle is a static barrel for this repo** — a `hub:db:schema:extend` hook exists but is used
nowhere in the monorepo (verified), and a dialect-metadata filter drops other-dialect files, which
the resolver's `schema.<dialect>.ts` pattern already mirrors. The CLI already writes and maintains
the `server/db/schema.ts` bridge files that feed the scan (`lib/utils/update-schema-index.ts`).
The Nuxt build contributes only (a) the layer resolution and (b) TS→ESM bundling. drizzle-kit can
load TS itself (bundled tsx/esbuild), and every schema source in the repo imports only
`drizzle-orm`/`nanoid`/relative paths/one package subpath — no Nuxt aliases (re-verified rev 3:
the only `@crouton/auth` hit is inside a doc comment).

Every hop in the current chain has minted a real incident:

| Incident | What broke | Status |
|---|---|---|
| [#523](https://github.com/FriendlyInternet/nuxt-crouton/issues/523) | fresh scaffold shipped **zero migrations, silently** (schema.mjs only exists after build) | patched build-first by PR #529 — the round trip this epic removes |
| [#1286](https://github.com/FriendlyInternet/nuxt-crouton/issues/1286) | `crouton config` printed `✓ migration generated` while writing ZERO files; "the single biggest time-waster" behind ~22-min CI worker loops | patched by PR #1302: verifies a file was written + prints recipe — **but still exits 0** (verified in current code: `console.error` only, no throw/`process.exit` in `1474-1520`); the round trip itself was kept |
| [#285](https://github.com/FriendlyInternet/nuxt-crouton/issues/285) / [#678](https://github.com/FriendlyInternet/nuxt-crouton/issues/678) | schema-resolution fragility of the bundle approach (exports-map gaps; #678 = a latent raw-`.ts` export unmasked by 0.10's tsdown `skipNodeModulesBundle` externalization) | patched; #678 constrains this epic (see §6) |
| [#680](https://github.com/FriendlyInternet/nuxt-crouton/issues/680) | migrations omit transitively-pulled package tables (`translations_ui`) → fresh DB 500s | patched by graceful degradation (#700), not by fixing coverage |
| [#1385](https://github.com/FriendlyInternet/nuxt-crouton/issues/1385) | `pocs/snippets` **extends crouton-layout and still has no `layout_configs` migration** — the extends fix (#1121) can't be the cause. **Mechanism is OUR hypothesis, not the issue's** (the issue itself hypothesizes a barrel-export gap — weakened by the forensics below): third-review forensics show snippets landed in one commit (#1316) with layout hand-added during #1356, its *current* `.nuxt` `schema.entry.ts` **includes** the layout bridge, yet the committed `0000` lacks the table → the migration was generated before layout entered the resolved set and **never re-generated**; whether `reuseExistingBundle` specifically was involved is unobservable from git | **open — motivating evidence FOR this epic**: a resolver that reads source on every run structurally cannot serve a stale schema picture |
| [#1121](https://github.com/FriendlyInternet/nuxt-crouton/issues/1121) | scaffold omits crouton-layout entirely (extends + dep) | open — the §0 precursor, gated on the layout-WIP decision |

The patches fixed symptoms at each hop. This epic removes the hop structure: **generation produces
code + migration atomically, with no Nuxt process in the loop.**

**What this epic does NOT remove (stated honestly):** the built-`dist` prerequisite. App barrels
re-export `@fyit/crouton-auth/server/database/schema/auth`, whose exports map resolves to the
gitignored `dist/schema/auth.mjs` (`packages/crouton-auth/package.json:29-33`) — and mapping it to
source was tried and broke NuxtHub 0.10 (#678). #1286's "Could not load @fyit" is a **dist**
error, not a Nuxt error. So "cold" throughout this brief means: **no `.nuxt`, no Nuxt process,
packages built.** The warm-dist mitigation ([#1222](https://github.com/FriendlyInternet/nuxt-crouton/issues/1222))
**shipped 2026-07-10** via PR [#1312](https://github.com/FriendlyInternet/nuxt-crouton/pull/1312)
(content-addressed dist cache + build-all fallback) — it removes the cold-build tax on dist;
this epic removes the remaining Nuxt round trip. Complementary, both needed.

## 2. Hypothesis

- **We think that** the migration step's fragility and multi-minute cost come from paying a Nuxt
  build to reproduce a schema picture the CLI can assemble itself: the same layer walk NuxtHub does
  (recursive extends resolution) over the same bridge files the CLI already maintains, fed to
  drizzle-kit directly (it loads TS natively; `Config.schema` accepts `string | string[]` —
  `drizzle-kit@0.31.10` `index.d.ts:119`).
- **We'll do that by** (1) a **schema-source resolver** in the CLI: recursively walk the app's
  extends graph (nested package extends included — topology verified: core→i18n/auth/admin,
  sales→printing, bookings→editor; note bookings→editor carries **zero schema**, editor has no
  `server/` dir), node-resolve `@fyit/*` names, and collect the same `server/db/schema*` globs
  NuxtHub collects; (2) invoking **`drizzle-kit generate` (CLI, not the programmatic API — see §6)**
  against that resolved path list via a **generated-with-header `drizzle.config.ts`** (decision
  resolved in second review — see WS2), with the app's existing
  `out: server/db/migrations/sqlite` + `meta/`. drizzle-kit stays the single diff engine and sole
  `meta/` snapshot owner. Both Nuxt invocations (30s + 180s) are deleted.
- **We'll be right if** on a cold tree (no `.nuxt`, packages built), `crouton config` for a new
  collection produces the collection **and** its `NNNN_*.sql` + updated `meta/` in one run, in
  seconds, with no Nuxt process spawned — and failure (missing dist, unresolvable source,
  **two DISTINCT table definitions sharing a name across the resolved set** — identity-aware,
  see WS1) is a **non-zero exit with a recipe**
  (a strengthening of #1302, which currently prints ✗ but exits 0).
- **We'll know by** (numbers stated before the run; **today-baseline = the quotes run**: 22 min /
  186 turns overall, ~17 min / 85 turns for the scaffold+generate leaf, #1277/#1281 — NB the
  [#1313](https://github.com/FriendlyInternet/nuxt-crouton/issues/1313) retest
  (PR [#1382](https://github.com/FriendlyInternet/nuxt-crouton/pull/1382)) closed **without
  recording clean numbers** (confounded: key drain, runner saturation, #1367 detour), so the
  absolute thresholds below are the criteria, not a delta vs #1313):
  1. WS2 contract test green: cold generate → exactly one new expected `.sql`; **second run —
     via the app's own `pnpm db:generate`, not the CLI (fifth review: this one choice makes the
     case catch cross-version snapshot drift AND generated-config correctness at once)** — is a
     no-op; induced failure (package dist deleted) → non-zero exit + recipe, never "✓"; induced
     duplicate **definition** → non-zero exit naming both resolved files; **benign duplicate
     (the bookings topology: same table via bridge + app barrel) → SUCCESS** (negative case,
     fourth review — see WS1's identity-aware rule);
  2. WS1 coverage test green: resolver path-set **=** NuxtHub bundle path-set for
     `fixtures/minimal`, `fixtures/with-sales` + `pocs/booking-demo` — equality, not superset:
     rev 3 adds no bridges (see §6), so there is no expected delta. **Caveat (third review):
     with-sales lists `@fyit/crouton-printing` explicitly before sales, so as-is it exercises the
     sales→printing edge only as a dedup case** — the test set must also include a
     **nesting-only case** (a schema-bearing package reachable solely via a transitive extends;
     **fixture NAMED fifth review: `fixtures/nested-schema` — see WS1**), an
     **unlisted-`layers/*`-dir case** (see WS1), and a **no-duplicate-paths
     assertion** (fourth review: path-*set* equality collapses duplicates, so a non-deduping
     resolver is invisible to parity alone), plus a one-time fanfare parity run at
     adoption (its twelve `@fyit/crouton-themes/<name>` subpath extends are the resolver's
     crash-risk case);
  3. wall-clock: migration step for one new collection **< 10s cold** as defined above (today:
     30s-timeout dice-roll or a multi-minute build; reproduced twice: drizzle-kit CLI on a 2-file
     schema list ~1.1s warm npx / 4.4s cold npx / 0.4s direct bin — and it loads a real app
     barrel incl. the `@fyit/crouton-auth` dist subpath, 18 tables, exit 0);
  4. WS5 adoption check green (greenfield — owner confirmed no apps have users): each of velo,
     fanfare, triage gets a **squashed baseline** (regenerate `0000_` from current schema, recreate
     D1s) and a fresh D1 migrates + boots end-to-end — **velo first, as the canary** (fourth
     review). No drift reconciliation, no `/db-clone`. Baselines contain **no `layout_configs`**:
     the layout-out decision (rev 5.1) removes the `@fyit/crouton-layout` extends from all three
     apps in their squash PRs — verified a no-op (zero layout references in any of the three
     apps' code; fanfare's `0018` table was dead weight).

## 3. Dedup evidence (rev 3, re-gathered 2026-07-11 after second review)

- **Reuse/replace candidates: none.** No open issue or PR proposes removing the build dependency
  (PR search: `drizzle`, `db:generate`, `schema bundle`, `barrel`, `nuxt prepare` — empty; re-run
  after second review, still empty).
- **Adjacent, must link:**
  - [#1281](https://github.com/FriendlyInternet/nuxt-crouton/issues/1281) (open epic): this is the
    structural fix for its biggest time sink. Its [#1222](https://github.com/FriendlyInternet/nuxt-crouton/issues/1222)
    (warm dist) **closed 2026-07-10, shipped via PR [#1312](https://github.com/FriendlyInternet/nuxt-crouton/pull/1312)**
    — complementary and already landed (rev 2 wrongly said "remains necessary/open"). Recommend
    standalone epic cross-linked.
  - [#1282](https://github.com/FriendlyInternet/nuxt-crouton/issues/1282) (OPEN, #1281 WS2, added
    rev 3): the scripted deterministic POC scaffold+generate — **this epic's first consumer**; its
    script wraps whatever the CLI migration step becomes. Coordinate the interface.
  - [#1313](https://github.com/FriendlyInternet/nuxt-crouton/issues/1313) / PR
    [#1382](https://github.com/FriendlyInternet/nuxt-crouton/pull/1382) (closed 2026-07-10, added
    rev 3): the snippets full-flow retest after #1286+#1222 — **closed without clean
    turns/wall-clock numbers** (third-review finding: the run was confounded by a key drain,
    runner saturation, and the #1367 detour; its postmortem records no measured snippets number).
    The usable baseline stays the quotes run (#1277/#1281); §2 keys on absolute thresholds.
  - [#1357](https://github.com/FriendlyInternet/nuxt-crouton/issues/1357) (OPEN):
    `crouton init` generate step fails on a chdir/path bug **and exits 0** (both halves verified)
    — same surface, same exit-code disease WS2 fixes. Evidence trail:
    [#1316](https://github.com/FriendlyInternet/nuxt-crouton/issues/1316) / PR
    [#1356](https://github.com/FriendlyInternet/nuxt-crouton/pull/1356) (added rev 3). Coordinate:
    fix or absorb its exit-code half in WS2.
  - [#1286](https://github.com/FriendlyInternet/nuxt-crouton/issues/1286)→PR #1302 (closed):
    regression guard to keep AND strengthen (non-zero exit).
  - #529 (merged PR): installed the build-first round trip (closes #523) — the prior art being
    retired; its "why" (fresh scaffolds must ship migrations) stays an acceptance.
  - #680/#685/**#700**: the package-table story. **Constraint inherited — #700's own words
    (verified quote; #685 is the inverted precedent — the PR that shipped a package-owned
    migration, replaced by #700):** *"NuxtHub applies every package/layer's
    `server/db/migrations` **before** the app's own dir (directory order, not filename order —
    confirmed: even renamed `9999_…` it still applied first)."* The CI failure was specifically
    against non-idempotent app migrations; "packages must NOT ship applied migrations" is the
    rule we draw from it. This epic keeps migrations app-owned; the resolver
    only reproduces what the *app's* diff already sees. Per-package journals = successor epic.
  - [#678](https://github.com/FriendlyInternet/nuxt-crouton/issues/678) (closed): crouton-auth's
    raw-`.ts` schema export was a latent fault unmasked by NuxtHub 0.10's builder swap — any
    exports-map change must keep serving the runtime consumer. Constraint on WS1.
  - [#226](https://github.com/FriendlyInternet/nuxt-crouton/issues/226) (open): schema barrel (and
    app.config + extends) not pruned on collection removal. **Interaction:** a resolver derived
    from config could turn staleness into surprise `DROP TABLE`s — see the WS1 source-of-truth rule.
  - [#679](https://github.com/FriendlyInternet/nuxt-crouton/issues/679) (open): POC functional
    smoke gate — WS5's verification rail.
  - [#1121](https://github.com/FriendlyInternet/nuxt-crouton/issues/1121): the §0 precursor (gated
    on the layout-WIP decision). [#1385](https://github.com/FriendlyInternet/nuxt-crouton/issues/1385):
    motivating evidence for this epic (§1), NOT fixed by §0.
  - [#459](https://github.com/FriendlyInternet/nuxt-crouton/issues/459) (open, opinion-stack map):
    receives the "sqlite is the opinion; pg is unexercised" note (see Out). Supportive precedent:
    it already tiers the drizzle-kit migration flow as "swappable with work".

**Issue-sweep additions (fifth pass, 2026-07-11) — comment/cross-link on each at epic creation:**

- [#1246](https://github.com/FriendlyInternet/nuxt-crouton/issues/1246) (OPEN, bug): non-dry-run
  `crouton generate` throws a ReferenceError (`promptedConfigs` out of scope) — an open bug in
  the exact file WS2 rewrites (`generate-collection.ts`). Coordinate: fix it first or absorb it
  in WS2's rewrite; either way its repro becomes a WS2 regression case. Comment when WS2 starts.
- [#322](https://github.com/FriendlyInternet/nuxt-crouton/issues/322) (OPEN): rename the fanfare
  app/worker to "kassa". Interacts with fanfare's WS5 squash PR — that PR recreates fanfare's
  D1s and re-commits ids, which is the cheapest possible moment to also take the rename (new
  names once, not twice). Sequence the two deliberately; comment on #322 before fanfare's
  squash PR is cut.
- [#224](https://github.com/FriendlyInternet/nuxt-crouton/issues/224) (OPEN): planned
  `with-relations` e2e fixture. WS1's parity suite needs a new micro-fixture for the
  nesting-only case (fifth review: `fixtures/nested-schema`) — coordinate so the two fixture
  additions don't collide in `fixtures/` layout or naming conventions.
- [#827](https://github.com/FriendlyInternet/nuxt-crouton/issues/827) (OPEN): generator-output
  smoke — prove emitted `*.test.ts` run green without the manual fixture dance. Same
  test-harness territory as WS1/WS2's contract tests; reuse its harness decisions rather than
  minting a parallel one. Comment at test sign-off.
- [#1263](https://github.com/FriendlyInternet/nuxt-crouton/issues/1263) (OPEN): generated apps
  declare runtime deps + emit audit-clean code. Touches `scaffold-app.ts` templates — the same
  file WS2 edits (`tmplDrizzleConfig`). Rebase-awareness only; comment if both land in the same
  window.
- [#1264](https://github.com/FriendlyInternet/nuxt-crouton/issues/1264) /
  [#1209](https://github.com/FriendlyInternet/nuxt-crouton/issues/1209) (OPEN): the quotes and
  bookmark-stash tiny-POC pipeline tests — natural **retest vehicles** for §2's wall-clock/turn
  numbers after this epic lands (#1313 closed without clean numbers; these are the next
  scheduled full-flow runs). Comment when the epic merges so the run records the after-numbers.
- [#983](https://github.com/FriendlyInternet/nuxt-crouton/issues/983) (OPEN, epic): crouton-layout
  graduation (POC → package, test-first) — the **revisit trigger** for the rev 5.1 layout-out
  decision (§0, WS5). When it closes, re-open the #1121 scaffold question and the
  baseline-content question. Comment at epic creation so the linkage is discoverable from both
  sides.
- [#234](https://github.com/FriendlyInternet/nuxt-crouton/issues/234) (closed, provenance):
  the catalog bump that pinned drizzle-kit 0.31.10 — the version every experiment in this brief
  ran against; the pnpm catalog is the single place the version lives (relevant to the fifth
  review's finding 2: the CLI must resolve drizzle-kit from the app, and the catalog keeps
  app/CLI versions aligned in-monorepo). No comment needed; cite in WS2.

## 4. Scope

**In:** the migration-generation path of `packages/crouton-cli` (config mode + init/add), the dead
pg fallback cleanup, rollback's DB story (incl. the dangling-export bug found in review), the
generator/rollback barrel-path asymmetry, greenfield baseline squash for velo/fanfare/triage, docs.

**Out (successor / sibling work, do not fold in):**
1. **pg demotion** (separate standalone chore issue, not this epic): stop documenting pg as a
   co-equal dialect (`crouton-cli/CLAUDE.md`), note "unexercised" in #459. Demote, don't delete.
2. **Thin generated files, fat runtime** — successor epic (raised in priority by #1260).
3. **Per-package migration journals + baseline adoption** (the #700-safe design) — successor epic.
   Bridge-less package tables (crouton-i18n/-atelier/-events) stay invisible until then — see §6.
4. **Stage-aware DB policy** (`push`-style sync for `pocs/*`) — successor decision.
5. **Retiring the app-local `translations-ui.ts` copy** — belongs to the per-package-journal epic;
   touching it now interacts with the duplicate-table rule (§6).

## 5. Workstreams (proposed sub-issues)

`packages/*` logic → **Test Sign-Off gate (#774) applies to WS1/WS2**: contract tests written and
approved first.

### WS1 — Schema-source resolver (the layer walk, without Nuxt)
**Split into two leaves (fifth review, #774 leaf test): WS1a = the resolver + parity suite
(including creating `fixtures/nested-schema`); WS1b = the identity-aware duplicate gate
(depends on WS1a's output type).** Each gets its own test sign-off; together they exceed one
focused run. Described here as one workstream for coherence.
New `lib/utils/schema-sources.ts`: given an app dir, recursively resolve the extends graph
(app `nuxt.config.ts` → package `nuxt.config.ts` extends, node-resolving `@fyit/*`, including
local `./layers/*` entries) and collect the NuxtHub globs per layer: `server/db/schema.ts`,
`server/db/schema.<dialect>.ts`, `server/db/schema/*.ts`. Returns an ordered absolute-path list.
NB the seed runner's discovery (`lib/seed-app.ts`) is **inspiration only, not a template** — it
BFSes `package.json` deps+peerDeps, a *different graph* that over-discovers (its own comments say
so) and misses local `./layers/*` entirely; the resolver must walk `extends`.
- **Source-of-truth rule (the #226 guard):** the resolver reads the **filesystem** (extends chain +
  bridge files as they exist), never `crouton.config.js` collections; `--only` must NOT narrow it.
  A collection's disappearance from the schema view (→ `DROP TABLE`) can only happen via explicit
  rollback (WS4), never as a side effect of config drift.
- **Exact-glob rule (never widen):** the glob set above is load-bearing. Example:
  `packages/crouton-bookings/server/db/translations-ui.ts` defines a third `translations_ui` and
  is invisible **only because** the glob is exact — widening to `server/db/*.ts` would
  double-define it for every bookings app.
- **Reproduce Nuxt's REAL resolution, not just the extends array (third review, from
  `@nuxt/kit` 4.4.8 / c12 3.3.3 source — each of these lets the parity test pass while the
  resolver is structurally non-equivalent):**
  1. **The app root is itself a globbed layer** — and it carries the *largest* bridge (the
     app-managed `server/db/schema.ts` re-exporting auth + translations-ui + every collection).
     Forgetting the root is the single worst possible resolver bug.
  2. **Auto-scanned `layers/*`:** kit globs the app's `layers/*` dir and extends every entry
     *without it appearing in the extends array* (reverse-alphabetical, processed before
     `extends`). The resolver must glob `layers/*` in the app dir like kit does, not trust the
     array. Benign today (every app also lists its local layers explicitly, and generated
     collection schemas live at `server/database/`, outside the glob) — but this is exactly the
     latent-parity-gap class the epic exists to kill.
  3. **Dedup by realpath'd rootDir, first-wins** (attribution tightened fourth review, verified
     against installed source: the dedup lives in **@nuxt/kit** — `processedLayers` keyed on the
     resolved rootDir — the realpathing happens upstream in **exsolve** during c12's resolution,
     and c12 itself never dedups; net instruction for the resolver is unchanged: realpath before
     dedup, or a layer extended via two parents double-counts).
  4. **Per-layer resolution origin + subpath extends:** c12 resolves each layer's extends *from
     that layer's own directory* (pnpm strict isolation — `@fyit/crouton-printing` resolves from
     crouton-sales's dir, not the app's), and extends entries may be package *subpaths* resolved
     via the exports map to a config file (fanfare extends twelve `@fyit/crouton-themes/<name>`
     entries — no schema, but the walk must not crash on them).
  Out of scope, documented: `.nuxtrc` (incl. user-global) can contribute `extends` a static
  resolver never sees — no in-repo usage; documented limitation, not handled.
- **Duplicate-table hard-fail — a deliberate strictness DELTA, not parity — and it MUST be
  identity-aware (fourth review):** drizzle-kit does NOT dedupe or error on two same-named
  `sqliteTable`s across the schema list — **it silently last-wins, order-dependently**
  (reproduced twice against 0.31.10: swapping file order flips which definition lands in the
  SQL, exit 0, no warning; drizzle even reports "1 tables"). NB NuxtHub doesn't hard-fail
  either — rolldown treats two same-named star-exports of *different* bindings as ambiguous and
  *silently omits* the name (build warning only) — so the hard-fail is the CLI being
  deliberately stricter than the system it replaces; the parity claim is path-set equality plus
  this one intentional behavior delta. **But naive NAME-uniqueness is wrong and would hard-fail
  the standard topology on day one:** the same auth tables are legitimately re-exported by BOTH
  the bookings bridge (`crouton-bookings/server/db/schema.ts`, auth-only re-export) AND every
  app barrel (e.g. `apps/velo/server/db/schema.ts:5`) — so every bookings-extending app
  (`pocs/booking-demo`, `fixtures/with-bookings`; NB **not** `with-sales` — fifth review
  verified it doesn't extend bookings and no bridge in its graph re-exports auth, so the
  benign duplicate is confined to the bookings topology) has the same table *names*
  reachable via two resolved files, benignly (ESM star-exports of the SAME binding are not
  ambiguous; rolldown keeps them; drizzle-kit loads them fine — the 18-table experiment).
  The check therefore is: **import each resolved file via jiti (named fifth review — jiti is
  already the CLI's runtime for all of `lib/`, `bin/crouton-generate.js:15`, so no new loader
  enters the system; loading bridge and barrel through the SAME jiti instance is what makes
  the identity comparison valid — its module cache returns the same object for the same
  resolved file; the dist prerequisite in §1 already covers loadability), collect the exported
  drizzle table objects, and fail iff two DISTINCT definitions (different object identity /
  module of origin) share a table name** — exiting non-zero naming both *resolved* files
  (bridge/barrel level, not the deep definition site).
  A definition-regex scan over the collected files is also wrong: it misses the re-export
  hazard §6's i18n-bridge example is about (the duplicate arrives via `export * from`, not a
  `sqliteTable(` call in the globbed file). Identity-aware import-and-collect catches both the
  direct-definition and the re-export duplicate classes, keeps the benign topology working, and
  makes resolver ordering non-load-bearing. NB this means WS1 ships a small **table-enumeration
  step** (import + inspect exports), not just a path list — stated here so its cost is visible.
  Corollary (sixth review): the enumeration **executes** each resolved schema file at generate
  time (jiti import). Every in-repo schema source is side-effect-free today (table definitions
  only), but a schema file with top-level side effects (env reads, I/O) would run inside the
  CLI — documented hazard, accepted; no test, labelled a hypothesis about future code.
- **No new bridges (reversed from rev 2):** the six packages with collectable
  `server/db/schema.ts` bridges today are crouton-core, -layout, -bookings (auth-only re-export;
  bookings' only own table, `translations_ui` in `server/db/translations-ui.ts`, sits outside the
  glob), -flow, -printing, -sales — inventory re-verified third review against all 31 packages, no
  seventh. crouton-i18n/-atelier/-events have tables
  but no bridge and stay invisible — same as today (`translations_ui` canonically comes from the
  **app-local copy** `server/db/translations-ui.ts`; adding an i18n bridge would double-define it
  and, per the last-wins finding, silently diverge). Footnote: crouton-auth
  (`server/database/schema/*`) and crouton-core (`server/database/schema/redirects.ts`) also
  define tables outside the glob — they reach the bundle only via re-exports (bookings/app
  bridges; core's own bridge), never via the glob on those packages. Bridge-less coverage is the
  per-package-journal successor epic's problem. Parity is therefore **equality**, not superset.
- Files: new `lib/utils/schema-sources.ts` only.
- **Contract test (sign-off first):** for `fixtures/minimal`, `fixtures/with-sales`, and
  `pocs/booking-demo`, resolver path-set **equals** the real NuxtHub `schema.entry.ts` path-set
  (parity run CI-only; **cheaper than a full build — `nuxt prepare` already emits
  `schema.entry.ts`, fifth review, so parity runs on prepare, not build**); plus (third review
  additions): a **nesting-only** case — a schema-bearing package reachable solely via a
  transitive extends — **fixture NAMED (fifth review): `fixtures/nested-schema`, a new
  micro-fixture extending `@fyit/crouton-core` + `@fyit/crouton-sales` ONLY, so
  `crouton-printing`'s schema is reachable solely via the transitive sales→printing edge;
  parity-only, no `e2e.manifest.json`. Do NOT modify `with-sales` instead — with-sales as-is
  (printing listed explicitly AND reachable via sales) is the repo's only **fixture-sized**
  layer-reachable-twice case (sixth review: `apps/fanfare` has the same shape — printing
  explicit at `nuxt.config.ts:26` AND reachable via sales — so its one-time adoption parity
  run doubles as a second reachable-twice exercise), i.e. the natural CI host for the
  no-duplicate-paths assertion; we need both fixtures.
  Coordinate the `fixtures/` addition with #224's planned `with-relations` fixture (§3)**;
  an **unlisted `layers/*` dir** containing a glob-matching schema file → collected;
  a duplicate-**definition** fixture → non-zero exit; and a **fanfare walk** (must not crash on
  the themes subpath extends) — full fanfare parity once at adoption. Plus (fourth review):
  the **benign-duplicate NEGATIVE case** — `pocs/booking-demo` (auth tables reachable via
  bookings bridge AND app barrel) resolves **and generates** cleanly, proving the hard-fail
  does not fire on same-binding re-exports; and a **no-duplicate-paths assertion** on the
  resolver output (path-set parity cannot detect a non-deduping resolver). Plus (fifth
  review): a **repo-wide grep assertion that no source registers `hub:db:schema:extend`** —
  the "hook is used nowhere" claim is otherwise a point-in-time grep that can silently rot
  (a package adopting the hook later would diverge the resolver invisibly; parity CI covers
  only three fixtures), so the suite makes the limitation self-announcing.
- Acceptance: resolves cold (no `.nuxt`; packages built); follows nested extends; includes the
  app root and auto-scanned `layers/*`; dedupes by realpath first-wins; duplicate check is
  identity-aware (benign re-exports pass, distinct definitions fail); no Nuxt import anywhere
  in the resolver.

### WS2 — drizzle-kit against the resolved sources; Nuxt out of the loop
**Split (sixth review, #774): WS2.0 = the esbuild-config-import probe as a timeboxed
pre-flight SPIKE, run BEFORE WS2's test sign-off** — the probe's outcome pins the
generated-config design (runtime resolution vs the §6 baked-list fallback), so sequencing it
inside the leaf risks rewriting a signed-off contract mid-build. WS2.0 also lands
`tmplDrizzleConfig` + velo's normalizing diff if the probe passes; the remainder (invocation
swap + failure contract + deferral) is one leaf.
`crouton config` / `init` / `add` invoke **`drizzle-kit generate` (CLI)** against the WS1 path
list. **Version ownership (fifth review — the sole-snapshot-owner acceptance depends on it):
the CLI resolves the `drizzle-kit` binary FROM THE APP DIR** — apps carry their own dep
(`apps/velo/package.json:43`, `catalog:`; NB `:16` is the `db:generate` script), the pnpm
catalog keeps app/CLI versions aligned **in-monorepo** (#234; precision, sixth review:
scaffolded apps pin `drizzle-kit: '^0.31.0'` in devDeps, deliberately non-catalog per #141,
so outside the monorepo alignment rests on the `^0.31` range), and a single writer per app
prevents cross-version `meta/` snapshot-format drift. The
named test is §2.1's respecified second-run case (second run via `pnpm db:generate` must be a
no-op — fails if two drizzle-kit versions alternate as snapshot writers).
Config ownership (§7 Q2, resolved second review): the scaffolded `drizzle.config.ts` is a
**generated-with-header file**; **§7 Q6 resolved fifth review → RUNTIME RESOLUTION**: the
generated config imports the WS1 resolver and resolves the schema list on execution (it's
executed TS). Evidence: (1) the feared new dep already exists — every scaffolded app
gets `'@fyit/crouton-cli': 'workspace:*'` in **devDependencies** (`scaffold-app.ts:125-128`;
precision, sixth review: devDeps, not dependencies — the right class, since the config
executes at generate/dev time, wherever `pnpm db:generate` runs); (2) a baked list is stale
between an `extends` edit and the next CLI run, and on the standalone `pnpm db:generate` path
that staleness is a silently-incomplete migration — a miniature of the exact #1385 disease
this epic kills (baked list recorded in §6). Named risk + test for the winner: drizzle-kit
loads config via its own esbuild bundling, so the config importing the jiti-run CLI resolver
must actually work in that context — probe: cold scratch app, add a schema-bearing package to
`extends`, bare `pnpm db:generate` with NO `crouton` run in between → the new package's tables
appear (this is §7 Q6's runtime-branch test; a baked list cannot pass it). If the esbuild
import proves impossible, fall back to baked-list-plus-loud-staleness and swap the §6 entry.
The header says "regenerated by crouton, do not hand-edit".
**Hard constraint (third review): the generated config must contain NO generation-time-resolved
absolute paths** — relative paths, or runtime resolution inside the config
(`createRequire(import.meta.url).resolve(...)` — it's executed TS). NuxtHub's own
`schema.entry.ts` demonstrates the failure mode: it bakes absolute worktree paths, which in this
worktree-heavy setup (`~/.supacode/repos/...`) means permanent cross-machine/CI churn in a
committed file. The current scaffold template is already machine-neutral (relative candidates +
lazy `existsSync`), committed, excluded from typecheck, and orthogonal to the wrangler pipeline —
keep those properties; keep `out:` equal to wrangler.jsonc's `migrations_dir`. Two known touches:
velo gets a one-time normalizing diff (it still carries the older single-path config variant),
and NuxtHub's parallel `.nuxt/hub/db/drizzle.config.ts` becomes dead weight once Nuxt is out of
the loop — leave it (it's gitignored build output), note it in docs.
Delete `runBatchDatabaseSetup`'s `npx nuxt db generate` + 30s timeout
(`generate-collection.ts:1474-1520` as of `63098d3c7`) and `generateMigrations`' `nuxt build`
dance (`lib/utils/generate-migrations.ts`); `init`/`add` reuse the same code path as config
(removes their current redundant double-attempt — `init` step 2's `runConfig` already triggers
`runBatchDatabaseSetup` before step 3 calls `generateMigrations`).
- **Failure contract (strengthens #1302, fixes the #1357 disease):** zero files when a change was
  expected, any resolution error, or a duplicate table name → **non-zero exit** + recipe, never
  success text.
- **Graceful deferral kept, trigger redefined (§7 Q5, resolved third review; scope clarified
  fourth review):** today's `deps-missing` branch keys on `existsSync(<app>/node_modules)` — the
  wrong predicate for the new path — **and it exists ONLY on the init/add path
  (`generate-migrations.ts:69-71`); the config path (`runBatchDatabaseSetup`) has NO guard at
  all today**, so this workstream *extends* the deferral to a surface that never had one, with
  the redefined trigger. In-monorepo bare scaffolds resolve `@fyit/*` via directory walk-up to the **root**
  `node_modules/@fyit/` (verified — all packages present), so they usually just work; only apps
  scaffolded *outside* the monorepo genuinely can't resolve. New trigger: **attempt resolution,
  defer with a recipe on resolution failure** — not on the mere absence of a local node_modules.
- Files: `lib/generate-collection.ts`, `lib/utils/generate-migrations.ts` (deleted or gutted),
  `lib/init-app.ts`, `lib/add-module.ts`, `lib/scaffold-app.ts` (`tmplDrizzleConfig`, `:356`).
- **Contract test (sign-off first):** cold tree → generate new collection → exactly one new
  `NNNN_*.sql` with the expected `CREATE TABLE`; journal + snapshot updated; **second run via
  the app's own `pnpm db:generate` is a no-op** (catches cross-version snapshot drift + config
  correctness, fifth review); `--only` run produces no schema-set narrowing; deleted
  crouton-auth dist → non-zero exit + recipe; the §7 Q6 staleness case (extends edit + bare
  `db:generate`, no CLI run → new package's tables present under runtime resolution).
- Acceptance: existing `meta/` snapshots stay valid (drizzle-kit sole snapshot writer); app-level
  `pnpm db:generate` still works; wall-clock < 10s cold.

### WS3 — remove the dead pg fallback + fix the docs that teach it
Review finding: `loadAndPrepareConfig` injects `defaults: { dialect: 'sqlite' }` via c12
(`generate-collection.ts:1628`, defaults at `:1639-1643`), so the `config.dialect || 'pg'`
fallbacks (`:1808`, `:1891`) are unreachable **for an absent key** (caveat from second review: an
explicit `dialect: null`/`''` in a config file survives defu and still hits `'pg'` — pathological
but real). Replace both with `|| 'sqlite'`, and fix the stale doc that still teaches the pg
fallback (`packages/crouton-cli/CLAUDE.md` Key Options table). The `runGenerate`/bin path already
defaults sqlite independently. No hard error needed.
- Files: `lib/generate-collection.ts`, `packages/crouton-cli/CLAUDE.md`. Trivial; still gets a test
  (config with `dialect: null` → sqlite artifacts — the **discriminating** case, hits `'pg'`
  today; config with no dialect → sqlite artifacts — passes today via the c12 default, kept as
  a labelled regression guard, sixth review).

### WS4 — rollback learns about the table (and both sides stop hardcoding the barrel path)
Three parts, one file-set:
1. **Bug fix (found in review):** `cleanSchemaIndex` (declared `:43`) targets
   `server/database/schema/index.ts` (the hardcoded path at
   `lib/rollback-collection.ts:44`) but modern apps keep the barrel at `server/db/schema.ts` — so
   rollback currently no-ops the cleanup (it's the file's only barrel handling) and leaves a
   **dangling export to a deleted file**, breaking the next generate. Route it through
   `update-schema-index.ts`'s `getSchemaPath` (which already checks modern→legacy in order).
2. **Generator-side asymmetry (added rev 3):** `buildSchemaExportNames` hardcodes
   `server/db/schema.ts` (`generate-collection.ts:341-352`) instead of using `getSchemaPath` —
   route it through the same helper, or the asymmetry just moves.
3. `crouton rollback --drop-table` emits (not applies) a `DROP TABLE` migration into the app's
   migration dir via the WS2 machinery. Default behaviour stays code-only, **but (fourth review,
   WS4↔WS2 interaction): once part 1 fixes the barrel, a code-only rollback removes the table
   from the resolved schema view — so the NEXT `crouton config` run emits the DROP TABLE as a
   side effect, bundled into an unrelated migration.** (Today this is masked by the
   dangling-export bug breaking that next generate outright.) This does not violate the WS1
   source-of-truth rule — the rollback *was* explicit — but it violates the reader's expectation
   of "unchanged", so: the summary names the orphaned table AND warns "the next generate will
   emit DROP TABLE <name>", and the contract test asserts that exact sequence (code-only
   rollback → next generate for an unrelated collection → migration contains the DROP).
   **`--dry-run` mechanism (fourth review):** drizzle-kit's CLI has no dry-run flag and §6
   rejects the programmatic API — so dry-run = generate against a copied `meta/` into a temp
   `out` dir, print the SQL, discard.
- Files: `lib/rollback-collection.ts`, `lib/generate-collection.ts`.
- Acceptance: rollback leaves a loadable barrel; `--dry-run` shows the would-be migration
  (temp-out mechanism, nothing written to the app); without the flag, output names the orphan +
  the next-generate DROP warning; the rollback→next-generate DROP sequence is covered by a test.

### WS5 — greenfield adoption (baseline squash) + end-to-end verify + docs
**Reshaped into an adoption sub-epic (fifth review, #774 — five separately-gated units, not one
leaf): WS5.0 pre-flight probe (step 0 below) → WS5.1 velo canary → WS5.2 fanfare → WS5.3 triage
(5.2/5.3 blocked on 5.1's green staging smoke) → WS5.4 cold-scaffold e2e + docs sync. The issue
tree mirrors the runbook it enforces; each squash PR is its own sub-issue.**
1. **Adoption = reset, not reconcile (rewritten rev 3 — owner confirmed all apps/pocs are
   greenfield, no users):** for velo, fanfare, triage — **squash to a fresh baseline**: delete
   `server/db/migrations/sqlite/` + `meta/`, regenerate `0000_` from the current resolved schema,
   recreate/wipe the staging and prod D1s, migrate, boot. This deliberately replaces rev 2's
   `/db-clone` + expected-diff machinery, and in one gesture disposes of the drift the second
   review found: triage's hand-written `0017/0018` applied remotely but absent from drizzle's
   journal (would have produced duplicate-column ALTER failures on any diff-based adoption), and
   fanfare prod's never-applied `0012-0018` backlog.
   **Baseline content is mechanical, not §0-gated (corrected fourth review):** velo, fanfare and
   triage **all already extend `@fyit/crouton-layout`** (velo `nuxt.config.ts:16`, fanfare `:22`,
   triage `:15`); fanfare's migrations carry `layout_configs` since `0018`, velo's and triage's
   never did (two of §0's eight #1385 instances). Regenerating `0000_` from the resolved schema
   would **add `layout_configs` to the velo/triage baselines automatically** — the §0/#1121
   scaffold decision governs only *future scaffolds* and does not gate this.
   **Pre-squash owner decision → RESOLVED (owner, 2026-07-11, rev 5.1): layout stays out of
   everything — remove the `@fyit/crouton-layout` extends **AND the
   `"@fyit/crouton-layout": "workspace:*"` package.json dep** (velo `package.json:32`, fanfare
   `:31`, triage `:28` — both halves, the same extends+dep pair #1121 teaches in §0; sixth
   review) from all three apps in each app's own
   squash PR, so the regenerated `0000_` baselines contain no `layout_configs`.** Named test for
   the "removal is a no-op" claim: grep verified zero layout references in any of the three
   apps' code (components, composables, server — 2026-07-11), and the canary flow itself is the
   runtime check (step 4's staging boot + smoke fails if anything actually needed the layer).
   Fanfare's existing `0018` table is dead weight and disappears with the squash. Revisit when
   [#983](https://github.com/FriendlyInternet/nuxt-crouton/issues/983) graduates the package.
   **Runbook (third review; extended fourth review — nothing in CI keys on migration
   filenames/counts/prior DB state, and a recreated staging D1 is fully reconstituted by one
   deploy: migrate → idempotent `crouton-seed` → review-login seed → smoke. Steps are tagged
   with WHERE they run — 🧑‍💻 = owner machine with CF-authenticated wrangler, 🤖 = CI; none of
   the 🧑‍💻 steps can run in a chat-agent env (no CF creds). Ship **velo first as the canary**;
   fanfare + triage only after velo's staging smoke is green. **One squash PR per app**, not one
   batch — keeps each stale-id window per-app and the revert cheap. Steps MUST land in this
   order):**
   0. 🧑‍💻 **Pre-flight probe (the method rule applied — the runbook's three external-behavior
      claims are hypotheses until demonstrated):** on a throwaway Worker + D1, (a) apply a
      migration, squash/rename it, re-apply → confirm the squash re-apply fails
      `table already exists` (sixth review: include a **pure rename** sub-step —
      content-identical file, new name — if the "keys on filename" *mechanism* claim is to be
      kept; the squash sub-step alone demonstrates the operative failure under ANY keying
      scheme, which is all the runbook needs); (b) delete the D1, redeploy with the stale
      committed id → confirm Cloudflare really rejects the binding; (c, fifth review) set a
      secret on the Worker before deleting its D1 → confirm it survives the recreate +
      redeploy — **assert the secret is FUNCTIONAL (a request through the Worker), not just
      listed** (`wrangler secret list` can show stale metadata; the redeploy is the vector
      under test — the D1 deletion is almost certainly irrelevant to Worker-scoped secrets;
      sixth review) (backs
      step 5's "secrets are unaffected" claim — if false, all three prods would come back with
      dead auth). Ten minutes; de-risks three apps. **Concrete FALSE branches (fifth review;
      (b) corrected sixth review):**
      (a) FALSE → the squash re-applies cleanly, so D1 recreation and the local-state
      wipe are unnecessary — drop steps 1 and 3, the squash becomes a pure PR; (b) FALSE →
      do NOT relax step 2: a tolerated stale id means the first deploy ships a Worker bound to
      a dead DB — live-but-broken, not self-healed (`sync:ids` runs AFTER `wrangler deploy`
      and its rewrite lands in the ephemeral CI workspace; nothing commits it, so healing
      needs a second deploy off a corrected commit — verify the no-commit-step hypothesis in
      `deploy-app.yml` while running the probe). Keep the commit-ids-in-PR ordering and
      investigate before changing the runbook; (c) FALSE → add a re-set-secrets
      step (`wrangler secret bulk`) to step 5's checklist. Update this runbook before
      proceeding either way.
   1. 🧑‍💻 Recreate the app's two D1s **with the same names** — the pipeline never
      creates/deletes D1s; same-name recreation is what lets `sync:ids` self-heal. On an
      existing (non-recreated) D1 a squash is fatal: `d1_migrations` tracks applied files **by
      filename** (probe 0a), so the renamed `0000_` re-applies onto live tables → `table
      already exists` → the `&&`-chained `cf:staging` fails. **From this moment two windows
      open (fourth review; bounds corrected fifth review): (a) the RUNNING prod Worker still
      binds the deleted prod D1 id → this app's prod is hard-down — bounded by step 5's
      `/deploy-production`, NOT by the PR merge (the merge deploys staging only); (b) `main`
      carries the stale committed ids, so any unrelated path-triggered deploy of this app
      fails — bounded by shipping the PR promptly.** Both greenfield-acceptable; per-app PRs
      keep each window per-app, and step 5 should follow the merge immediately.
   2. 🧑‍💻 Run `pnpm sync:ids` for the app **locally** and **commit the two new `database_id`s
      in that app's squash PR** — in `cf:staging`/`cf:deploy`, `wrangler deploy` runs *before*
      `sync:ids`, and Cloudflare rejects a Worker whose D1 binding points at a deleted database
      (probe 0b), so a stale committed id fails the first CI deploy before the self-healing
      step runs.
   3. 🧑‍💻 Wipe the app's local state — `.wrangler/state/v3/d1/` and `.data/db/sqlite.db` —
      their `d1_migrations` key on the old filenames and hit the same table-already-exists
      failure.
   4. 🤖 Merge the PR → the path-filtered staging deploy reconstitutes staging end-to-end
      (migrate → idempotent `crouton-seed` → review-login seed → smoke). Staging green = this
      app's canary passed.
   5. 🧑‍💻 **Prod does not come back by itself:** run `/deploy-production` for the app —
      human-only per the #318 standing rule; an agent cannot perform this step, so it must be
      on the owner's checklist explicitly. Prod returns **schema-only and empty** (`cf:deploy`
      has no seed step) — fine under greenfield, but until this step runs, this app's prod
      stays down (window (a) from step 1). Secrets are expected unaffected (Worker-scoped; the
      Workers aren't recreated) — **demonstrated by probe 0c before relying on it** (fifth
      review: this was an untested external-behavior claim). Never `/db-clone` a pre-squash
      dump into a squashed app — the dump carries the source's stale `d1_migrations` rows and
      re-breaks the next migrate.
2. Cold-scaffold a throwaway POC end-to-end (scaffold → generate → migrate → boot → seed → layout
   applies if enabled), run the e2e fixture smoke, hook #679's functional smoke.
3. Docs sync: `db-migrations` skill (build-first gotcha → historical), `crouton-cli/CLAUDE.md`,
   `crouton-generation-reference` migration row, diagnostics-index entries for #523/#1286.
- Acceptance: `## 🧪 Verify the whole thing` rollup posted on the epic.

## 6. Considered & rejected

- **drizzle-kit programmatic API (`drizzle-kit/api`) as the invocation path** (rev 1's WS2) → ❌
  verified against the installed 0.31.10: `generateSQLiteDrizzleJson`/`generateSQLiteMigration`
  are a pure in-memory diff returning an array of SQL statement strings (`api.mjs:75364-75391`) —
  no `meta/` reads, no journal, no `NNNN` allocation, no file writes. Using it means reimplementing
  drizzle's snapshot/journal bookkeeping = the "second producer for `meta/`" failure this section
  already rejects. The CLI invocation produces the complete artifact set and is the plan.
- **Add `server/db/schema.ts` bridges to the bridge-less packages (i18n/atelier/events)** (rev 2's
  WS1 recommendation) → ❌ reversed in second review: drizzle-kit **silently last-wins** on
  duplicate table names (prototyped — order-dependent, no warning), so an i18n bridge +
  the app-local `translations-ui.ts` copy would silently diverge rather than error; and
  crouton-layout is WIP. Coverage for bridge-less packages goes to the per-package-journal
  successor epic. The resolver's duplicate-table hard-fail (WS1) turns this hazard class loud.
- **CLI hand-emits SQL from fieldsFile-JSON diffs** → ❌ reimplements the diff engine; second
  snapshot producer (unchanged from rev 1).
- **Packages ship applied migrations** → ❌ rejected precedent (**PR #700** verbatim: applied
  before the app's own, by directory order, not filename; renames tried and failed in CI).
  Successor epic revisits via per-package journals + baseline.
- **Map crouton-auth's schema export to source `.ts` to drop the dist prerequisite** → ❌ tried,
  broke NuxtHub 0.10 (#678, latent fault unmasked by the tsdown builder swap); the exports map
  serves the runtime bundle too. Dist stays required; the failure contract makes it loud.
- **Diff-based adoption with drift reconciliation (`/db-clone` + journal backfill +
  `IF NOT EXISTS` hand-patches, the fanfare-0018 pattern)** (rev 2's WS5) → ❌ obsoleted by the
  greenfield confirmation: with no user data to preserve, baseline squash is strictly simpler and
  disposes of all discovered drift at once. Revisit reconciliation machinery only when a real app
  launches (the per-package-journal epic's "baseline adoption" already covers it).
- **Baked path list in the generated `drizzle.config.ts`** (WS2's original plan, §7 Q6) → ❌
  resolved fifth review in favour of runtime resolution: the baked list goes stale between an
  `extends` edit and the next CLI run, and on the standalone `pnpm db:generate` path that
  staleness is a silently-incomplete migration — a #1385 miniature inside the fix for #1385.
  Its one advantage (no runtime dep on the CLI) turned out to be already spent:
  `scaffold-app.ts:128` gives every scaffolded app `@fyit/crouton-cli` as a dependency.
  Falls back in ONLY if the esbuild-config-import probe (WS2) fails.
- **Runtime schema-sync at boot** → ❌ non-reviewable DDL against prod D1 (unchanged from rev 1).
- **Per-package SQLite databases** → ❌ D1 has no `ATTACH` (unchanged from rev 1).
- ~~"Point drizzle.config at the barrel, keep the current flow" rejected as a half measure~~ →
  **rev 1 rejected this on a false premise** ("keeps shelling out and the timeout" — the timeout
  guards Nuxt, not drizzle-kit). The corrected version of this option — resolved source list +
  drizzle-kit CLI, Nuxt deleted — **is** the plan above.

## 7. Risks / open questions (review record — sixth review complete, folded in rev 7)

Resolved in second review (kept for the record): ~~bridges vs special-case~~ → no bridges,
duplicate-table hard-fail; ~~drizzle.config ownership~~ → generated-with-header.
Resolved in third review: ~~Q1 baseline squash mechanics~~ → works; the manual steps are
enumerated in the WS5 runbook (extended fourth review to six steps 0–5 with where-tags, the
pre-flight probe, per-app canary PRs, and the explicit `/deploy-production` step; nothing in CI
keys on migration filenames/counts);
~~Q2 parity scope~~ → keep the three CI parity apps, add the nesting-only + unlisted-`layers/*`
contract cases, run fanfare parity **once at adoption** (its themes subpath extends are the
crash-risk case, not a schema case); ~~Q5 bare scaffold~~ → premise was half wrong — in-monorepo
scaffolds resolve `@fyit/*` via the root `node_modules` walk-up; the deferral survives with its
trigger redefined to "resolution failed" (WS2).
Resolved in fifth review: ~~Q6 baked list vs runtime resolution~~ → **runtime resolution**
(evidence + fallback probe in WS2; baked list recorded in §6); ~~pre-squash layout decision~~ →
**layout out of everything** (owner, 2026-07-11; see WS5).

1. **Epic placement:** standalone epic cross-linked to #1281 and #1282 (unchanged
   recommendation, three reviews concur; #1282's script does not exist yet — interface
   coordination only).
2. **WS2 exit-code change is user-visible:** `crouton config` currently exits 0 even when the
   migration step fails (verified at both surfaces: the config path's `console.error`-only block
   and #1357's init path); scripts/CI that tolerated that will now fail. Acceptable
   (that's the point), but flag any pipeline that needs updating (`task-worker`, the #1282 script,
   POC retest flows).
3. **Housekeeping → DONE rev 7:** `f9249a4db` merged into main; cites re-anchored to
   `63098d3c7` (+14 on late-file cites, each re-verified against origin/main). Rebase
   awareness — #1403/#1406/#1415 (merged via PR #1418) touched `api-endpoints.ts` /
   `form-component.ts` (uncited, no behavior overlap); `generate-collection.ts` is a hot file
   (two merges in one week) — re-verify cites at WS2 pickup, and note the open #1246 sits in
   the same file (§3).
4. ~~**Q6 (fourth review) — generated drizzle config: baked path list vs runtime
   resolution**~~ → **RESOLVED fifth review: runtime resolution.** Full reasoning, the
   esbuild-config-import probe, and the fallback live in WS2 (probe extracted to **WS2.0**,
   a pre-flight spike before WS2's test sign-off — sixth review); the rejected baked list is
   in §6.
   The staleness test stays in the WS2 contract suite: edit an app's `extends` (add a
   schema-bearing package), run bare `pnpm db:generate` WITHOUT a `crouton` run in between →
   the new package's tables must appear.
5. ~~**Pre-squash owner decision (fourth review, blocks WS5)**~~ → **RESOLVED (owner,
   2026-07-11, rev 5.1): layout out of everything — remove the `@fyit/crouton-layout` extends
   **+ workspace dep** (sixth review: both halves, per #1121's own lesson)
   from velo/fanfare/triage in their squash PRs; baselines ship without `layout_configs`.**
   Verified no-op (zero layout usage in all three apps); WS5 carries the details; revisit at
   [#983](https://github.com/FriendlyInternet/nuxt-crouton/issues/983). WS5 is no longer
   blocked on an owner call.

## 8. 🧪 How to test (epic-level)

For someone who knows crouton but not this change:
1. Fresh clone, `pnpm install`, `pnpm build:packages` (dist required — see §1; the epic removes
   the Nuxt build, not the package build).
2. `crouton init scratch && cd scratch` → add a `widgets` schema JSON → `crouton config`.
3. Before: the migrate step either burned a multi-minute nuxt build, or hit a 30s timeout, or
   (pre-#1302) lied. After: `server/db/migrations/sqlite/0000_*.sql` exists containing `widgets`,
   in <10s, and `ps` shows no `nuxt` process ever spawned.
4. `pnpm db:migrate && pnpm dev` → app boots.
5. Sabotage 1: `rm -rf packages/crouton-auth/dist` → the step fails with a recipe and **exit ≠ 0**
   (`echo $?`).
6. Sabotage 2: add a second file defining a **different** `sqliteTable('widgets', …)` in another
   resolved layer → the step fails non-zero naming both resolved files (never a silent
   last-wins migration).
6b. Negative check (fourth review): generate in an app extending `@fyit/crouton-bookings`
   (e.g. `pocs/booking-demo`) — the same auth tables are reachable via BOTH the bookings bridge
   and the app barrel, and the step must **succeed** (the hard-fail is identity-aware; benign
   same-binding re-exports never trip it).
7. Rollback: `crouton rollback <layer> widgets --drop-table --dry-run` shows the DROP migration
   (temp-out, nothing written); without flags, the summary names the orphaned table AND warns
   that the next generate will emit the DROP, and the next `crouton config` still works
   (no dangling export) — and its migration indeed contains `DROP TABLE widgets`.
7b. Sabotage 3: drop a `layers/scratch/` dir with a `nuxt.config.ts` + `server/db/schema.ts`
   into the app WITHOUT listing it in extends → the resolver still collects it (parity with
   Nuxt's auto-scan).
7c. Sabotage 4 (fifth review — the "no Nuxt aliases in schema sources" claim was a
   point-in-time grep until this): add an `import ... from '#server/...'` line to a resolved
   schema file → the step fails **non-zero with a recipe naming the offending file**, never a
   raw stack dump or a silent partial migration. **Pinned assertions (sixth review — a naive
   implementation already exits non-zero via drizzle-kit's raw esbuild error, so the exit code
   alone doesn't discriminate; the recipe half does):** exit ≠ 0 AND stderr contains the
   offending file's path AND a `Fix:` line AND no raw stack frames. Mechanism: WS1b's jiti
   enumeration imports every resolved file BEFORE drizzle-kit runs — the CLI's jiti carries no
   Nuxt aliases and no app defines a package.json `imports` field (verify with a one-line grep
   when writing the test) — so the CLI catches the unresolvable import first and owns the
   message.
8. Adoption: **velo only, as the canary** — follow the WS5 runbook **in order** (step-0
   scratch-app pre-flight probe → recreate D1s same-name → `sync:ids` + commit ids in velo's
   own squash PR, which also removes the `@fyit/crouton-layout` extends + package.json dep
   (rev 5.1 decision, both halves; the
   baseline must contain no `layout_configs`) → wipe local `.wrangler/state` + `.data` →
   merge: staging migrates, boots, seeds, smokes → human runs `/deploy-production`). Only
   after velo's staging smoke is green: repeat for fanfare, then triage, each in its own PR.
   Expect prod to come back empty (no prod seed step) and to stay down until the
   `/deploy-production` step runs.
