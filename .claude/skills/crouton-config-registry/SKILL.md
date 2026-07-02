---
name: crouton-config-registry
layer: stack
description: The catalog of every config-as-data surface in nuxt-crouton — which file controls what, who actually reads it, its drift hazards, and how to change it safely. Use when asking "where is X configured", "who reads this file", "what happens if I edit harness.config.mjs / routing.json / digests.yml / labels.yml / a deploy.config.json / an e2e.manifest.json", when a setting change had no effect (silent no-op), when adding a new config surface, or when a gen-*.mjs --check fails. Trigger phrases: "where do I configure", "what reads this config", "config drift", "the setting didn't do anything", "stale generated doc", "add a new config-as-data surface".
---

# crouton-config-registry

One-line purpose: the master index of every configuration axis in this monorepo — file → what it controls → who READS it → drift hazard → how to change it safely.

Background for a fresh session: this repo deliberately prefers **config-as-data** (versioned, PR-reviewed files read by deterministic scripts) over hosted settings UIs or workflow-embedded constants. That means the answer to "where is X configured" is always a file — but some files have *no live reader* (silent no-ops, tracked in [#1098](https://github.com/FriendlyInternet/nuxt-crouton/issues/1098)), and several generated artifacts drift unless their `--check` mode is run. This skill is the map.

## When to use / when NOT to use

Use this skill to locate a config surface, find out who consumes it, or check whether an edit will actually take effect.

Do NOT use it for the depth those surfaces' owners carry:

| Topic | Go to instead |
|---|---|
| `wrangler.jsonc` anatomy, `deploy.config.json` semantics, secrets/tokens, workflow inventory | sibling `crouton-ci-and-deploy-map` |
| `pnpm-workspace.yaml` catalog/overrides rationale, install traps | sibling `crouton-build-and-env` |
| `crouton.config.js` / `schemas/*.json` field format, what generation produces | sibling `crouton-generation-reference` (workflow: the `crouton` skill) |
| What `croutonApps` / `croutonCollections` / `croutonLayoutBlocks` *mean* architecturally | sibling `crouton-architecture-contract`; layout blocks: `crouton-layout-reference` |
| The ISR/routeRules breakage itself | sibling `crouton-diagnostics-index` (§ "The ISR routeRules contradiction") |
| Which sign-off gate a change needs, packages-edit approval mechanics | sibling `crouton-change-control` |
| Digest content/cadence mechanics | the `housekeeping`, `epic-digest`, `skills-digest` skills |

Trust order when sources disagree: see sibling `crouton-docs-trust-map` §1.

## Master index (all paths repo-relative)

### A. Harness configuration (`.claude/`, `.github/`)

| File | Controls | Read by | Drift hazard |
|---|---|---|---|
| `harness.config.mjs` (repo root) | The **stage model** (epic #952): stage → paths → gates → deploy target → `editGuard` — see the file's own header | `scripts/harness-stages.mjs` (resolver + `stageForPath`/`gateMode` exports; contract test `scripts/harness-stages.test.mjs`). Referenced (not imported) by `.claude/agents/task-worker.md` and several skills | The packages-edit hook `.claude/hooks/gate-package-edits.sh` **hardcodes `packages/*` on purpose** (perf; #955). Rename/repoint the `package` stage here and the hook is out of sync until you edit it too — both files document this |
| `.claude/routing.json` | Model-routing registry (#864) — **DESCRIPTIVE, not prescriptive**: it mirrors `.claude/agents/*.md` frontmatter; see the file's own header | `scripts/gen-routing.mjs` (→ `writeups/architecture/routing-registry.md`; `--check` fails on stale registry OR tier drifting from agent frontmatter). CI: `routing-registry.yml`. JSON not YAML so the check job needs zero deps (#1062) | Its `_known_gaps` states plainly: the top-level CI agent loop (`claude.yml`, `decompose-on-issue.yml`, fix-ci, daily sweeps) runs on the claude-code-action **default model — unpinned**. Routes only cover the named agents |
| `.claude/settings.json` | Wires the hooks (PreToolUse `Edit\|Write` → `gate-package-edits.sh` + `gate-spec-signoff.mjs`; PreToolUse `mcp__github__add_issue_comment` → `require-comment-provenance.mjs`; SessionStart → `session-start.sh`) + the `mcpServers` entries | The Claude Code harness itself | The `mcpServers.crouton` path was a silent no-op until fixed under #1098 — verify with `ls` before trusting |
| `.claude/hooks/pre-commit-sync-reminder` | Optional **git** pre-commit reminder (manual install; not wired by settings.json) | git, only if a human ran `cp` / `core.hooksPath` | Greps were dead (long-renamed package dirs) until fixed under #1098; still only live if a human installed it |
| `.github/digests.yml` | Cadence + delivery per recurring report (housekeeping / epic-digest / skills-digest / eval-scoreboard), as data — schema in the file's own header | `.claude/skills/housekeeping/schedule.mjs`, invoked by workflows `housekeeping.yml`, `skills-digest.yml`, `eval-scoreboard.yml` — each cron fires **daily as a cheap wake-up** and `schedule.mjs` exits early on non-send days | **Editing workflow `cron:` is the wrong move** — edit this file. (`epic-digest.yml` was the one exception — hard-coded cron, no `schedule.mjs` — until the #1139 retrofit; all four reports now gate through it) |
| `.github/labels.yml` | The label taxonomy: `pkg:*` / `app:*` / `poc:*` / `worker:*` mirrors of the source dirs, plus `type:*` / status / meta labels | `labels.yml` workflow (crazy-max/ghaction-github-labeler, `skip_delete: true` — never removes); coverage-checked by `labelCoverage()` in `.claude/skills/housekeeping/gather.mjs` (source dirs on disk vs declared labels; report-only) | New package/app/poc dir without a matching label = housekeeping-report finding, not a build failure. Some doubled `app:*`/`poc:*` entries exist for apps that moved to `pocs/` (harmless) |
| `.claude/launch.json` | Per-app dev-server launch configs (name, `pnpm --filter <app> dev`, port) | Editor/launcher tooling; no repo script reads it | Contains stale app names. Low stakes |

### B. Per-app configuration (`apps/<name>/`, same shape in `pocs/` and `fixtures/`)

| File | Controls | Read by | Drift hazard |
|---|---|---|---|
| `crouton.config.js` | Generation input: `features` (which `@fyit/crouton-*` packages to enable), `collections` (name + `fieldsFile` + options like `formComponent`, `hierarchy`), `targets` (layer → collections), `dialect` | `crouton config` (the CLI, `packages/crouton-cli/lib/generate-collection.ts`, loaded via c12); also probed by `packages/crouton/src/module.ts` and `packages/crouton-core/nuxt.config.ts` hooks | `fieldsFile` paths resolve relative to the **config file**, but output lands in **cwd** — run the CLI from inside the app. Format/details: sibling `crouton-generation-reference` |
| `schemas/*.json` (fieldsFiles) | The field definitions per collection — the data model | The CLI via `crouton.config.js`. Changing one = a schema change → **Schema sign-off gate (#314)** applies (see `crouton-change-control` / `schema-review` skill) | Editing a schema without regenerating leaves generated code stale; regenerating without sign-off skips a gate |
| `app/app.config.ts` | The three runtime registries (defu-merged across layers): `croutonCollections` (app registers each generated `*Config`), `croutonApps` (addon packages self-register — powers `useCroutonApps().hasApp()` detection), `croutonLayoutBlocks` (packages contribute layout blocks) | Nuxt at runtime; `useCroutonApps`, the layout engine, collection machinery | The generator **upserts** `croutonCollections` entries on generate — hand edits near those imports can be clobbered/duplicated. Semantics: sibling `crouton-architecture-contract` |
| `deploy.config.json` | Opt-in unit for CI deploys: `stagingUrl`, `productionUrl`, `layerPackages`, `watchPaths`, optional `smoke.required` | `.github/workflows/deploy-apps.yml` `detect` job | Owned by sibling `crouton-ci-and-deploy-map` |
| `wrangler.jsonc` | Cloudflare Workers bindings (top-level = prod, `env.staging` = staging; id-less until first deploy auto-provisions, then `scripts/sync-wrangler-ids.mjs` writes ids back — **commit them**) | wrangler / Nitro `cloudflare_module` preset / the app's `cf:*` scripts | Anatomy, nitro#3429 env-stripping, and the #138 migrate gotcha: sibling `crouton-ci-and-deploy-map` |
| `nuxt.config.ts` `routeRules` | ISR/SWR/prerender caching per route | Nitro | ⚠️ **Do NOT add wildcard `/api/teams/*/...` rules** — breaks ALL generated `/api/teams/:id/*` routes via a radix3 conflict (live warning comment in `apps/velo/nuxt.config.ts`); root CLAUDE.md's ISR example shows the broken pattern as an explicit ❌ (fixed under #1095). Full story: sibling `crouton-diagnostics-index` |

### C. Per-package and per-fixture

| File | Controls | Read by | Drift hazard |
|---|---|---|---|
| `packages/*/crouton.manifest.ts` | Package self-description via `defineCroutonManifest` (from `@fyit/crouton-core/shared/manifest`): `id`, `bundled`, `fieldTypes` (+ `aliases` — canonical field-type source), `autoGeneratedFields`, reserved names, `provides`, `detects` | Two consumers: the meta module `packages/crouton/src/module.ts` (regex-scans `packages/crouton-*` + `node_modules/@fyit/crouton-*` for `id`/`bundled`) and the CLI's type mapping `packages/crouton-cli/lib/utils/manifest-loader.ts` (jiti-loads, caches) | Adding a field type = manifest change, not a CLI hardcode. The meta scan is **regex, not import** — keep `id:` / `bundled:` literal. Field-type catalog: sibling `crouton-generation-reference` |
| `fixtures/<name>/e2e.manifest.json` | What the fixture smokes: `packages` (drives PR-affected fixture selection), `collections` (key/heading/create/requiredField for the generic CRUD spec), `i18n` block | `.github/workflows/e2e.yml` `detect` job (jq over `.packages`); the generic specs `e2e/collection.smoke.spec.ts`, `e2e/surface.smoke.spec.ts`, `e2e/helpers.ts` | A new fixture without a manifest is invisible to the smart selection. Format reference: `e2e/CLAUDE.md`, `fixtures/CLAUDE.md`, `e2e-smoke` skill |

### D. Workspace-wide toolchain

| File | Controls | Read by | Drift hazard |
|---|---|---|---|
| `pnpm-workspace.yaml` | Workspace globs + the `catalog:` block (single source of shared dep versions, #142) | pnpm | Catalog/pins depth + the deliberately-uncataloged families: sibling `crouton-build-and-env`; change flow: `dependency-sweep` skill |
| root `package.json` `pnpm.overrides` / `onlyBuiltDependencies` / `ignoredBuiltDependencies` | Workaround version pins (exact pins — see the block itself) and the build-script allowlist | pnpm | Don't "upgrade" exact pins casually — sibling `crouton-build-and-env` |
| `vitest.config.ts` (root) | Test **projects** = `packages/*/vitest.config.ts` (each package with a vitest config is a project); excludes `node_modules/dist/.nuxt` | `pnpm test` (= `vitest run`) and CI `ci.yml` `test` job | A package without its own `vitest.config.ts` has no tests in the sweep — silently untested. Coverage reality: sibling `crouton-validation-reality` |
| `eslint.config.mjs` (root) | Lint for `packages/*` only (`dirs.src: ['packages']`) via `@nuxt/eslint-config/flat` + stylistic (no Prettier) + all `eslint-plugin-vuejs-accessibility` recommended rules at `warn` (epic #726, warn-first) | `pnpm lint`; apps carry their own `eslint.config.mjs` | Root lint does NOT cover `apps/`; a11y rules are warnings, not errors ("tighten to error once backlog cleared" — still open) |

### E. Generated artifacts and their `--check` modes

Each `scripts/gen-*.mjs` renders a config file into a committed artifact; `--check` fails when stale. Current exit statuses: run the one-liner below — don't trust remembered ones.

| Generator | Source → artifact | CI wiring |
|---|---|---|
| `scripts/gen-skills-doc.mjs` | skill frontmatter + its in-file `META`/`FLOWS` maps → `writeups/architecture/skills-and-triggers.html` | `skills-doc.yml` (PRs touching `.claude/skills/**`); also imported by `skills-digest` (#841). Asymmetry: a skill missing from `META` is only a `console.warn` (lands "Uncategorised"), but a `FLOWS` entry naming a deleted skill **hard-fails** |
| `scripts/gen-routing.mjs` | `.claude/routing.json` → `writeups/architecture/routing-registry.md` (+ frontmatter-drift check) | `routing-registry.yml` |
| `scripts/harness-layers.mjs` | `layer:` frontmatter of every skill/agent → inventory (`--json`); legacy no-frontmatter skills via its hardcoded `OVERRIDES` | `skills-doc.yml` runs `--check` (wired under #1098) |
| `scripts/gen-package-catalog.mjs` | package CLAUDE.md files → `.claude/skills/task-decompose/package-catalog.md` (#292 package-fit check) | none (root CLAUDE.md mandates running it on package add; no workflow) |

```bash
for s in gen-skills-doc gen-routing harness-layers gen-package-catalog; do node scripts/$s.mjs --check; echo "$s exit=$?"; done
```

## Silent no-ops (config that looks live but isn't)

A **silent no-op** is a config surface with no live reader — a stale path, a long-renamed package name, or a check documented as CI-enforced but wired into no workflow — so editing it changes nothing. The live catalog is tracked in [#1098](https://github.com/FriendlyInternet/nuxt-crouton/issues/1098); detection is always the same move: **find the reader first** (`grep -rln '<filename>' scripts/ .claude/ .github/`).

## How to change a config surface safely (checklist)

1. **Find the reader first** (tables above; when in doubt: `grep -rln '<filename>' scripts/ .claude/ .github/`). A config file nobody reads is a doc, not a control — editing it changes nothing.
2. **Check for a paired generated artifact** (table E). If one exists: edit the source, run the generator, commit **both**.
3. **Check for a hardcoded twin.** Two known: `gate-package-edits.sh` hardcodes `packages/*` (twin of `harness.config.mjs` `editGuard`); the `META`/`FLOWS` maps in `gen-skills-doc.mjs` are the out-of-band twin of skill frontmatter (frontmatter carries no trigger/group).
4. **Route through the right gate** — schema files → schema sign-off; `packages/*` files (incl. `crouton.manifest.ts`) → the packages-edit guard; see `crouton-change-control`.
5. **Verify the effect, not the edit** — e.g. after a `digests.yml` change, `node .claude/skills/housekeeping/schedule.mjs` locally; after a stage change, `node scripts/harness-stages.mjs <path>`.

## Adding a NEW config-as-data surface (the house pattern)

Modeled on `digests.yml` and `routing.json` (both files state the rationale in header comments):

- A versioned, PR-reviewed file with a **self-documenting header comment** (why it exists, field schema, who reads it) — never a hosted UI, never constants buried in a workflow.
- A **dependency-free Node reader** (`scripts/*.mjs` or a skill-local `*.mjs`) — CI check jobs never install `node_modules`.
- If it renders an artifact: give the generator a `--check` mode **and actually wire it into a workflow** (the harness-layers gap is the cautionary tale).
- Register the surface: root CLAUDE.md "Maintaining AI Documentation" table + this skill's index.

## Provenance and maintenance

verified: 2026-07-02

Facts checked against the working tree: read in full — `harness.config.mjs`, `.claude/routing.json`, `.claude/settings.json`, `.github/digests.yml`, `vitest.config.ts`, `apps/velo/{crouton.config.js,deploy.config.json,wrangler.jsonc,app/app.config.ts}`, `fixtures/minimal/{crouton.config.js,e2e.manifest.json}`, `packages/crouton-core/crouton.manifest.ts` (head), `eslint.config.mjs` (head), `pnpm-workspace.yaml`, root `package.json` (pnpm block); ran the four `--check` modes and the reader-greps. From discovery reports, cited not reproduced: the labels.yml doubled `app:*`/`poc:*` entries; routing A/B history (#824). Volatile facts (counts, exit codes, no-op states) — re-verify here, not in the prose:

```bash
for s in gen-skills-doc gen-routing harness-layers gen-package-catalog; do node scripts/$s.mjs --check; echo "$s exit=$?"; done
grep -rln harness-layers .github/ || echo "still unwired"        # layer check still outside CI?
ls packages/nuxt-crouton-mcp-server 2>&1                          # settings.json MCP path still stale? (see #1098)
node scripts/harness-stages.mjs packages/crouton-core/x.ts        # stage model unchanged?
grep -c '^- name' .github/labels.yml                              # label count (78 at verification)
ls packages/*/crouton.manifest.ts | wc -l                         # manifests (25 at verification)
ls fixtures/*/e2e.manifest.json | wc -l                           # fixture manifests (7 at verification)
```

Table E's exit codes change as work lands (e.g. new skills trip gen-skills-doc until registered in `META` + the HTML regenerated) — trust the commands, not a remembered status.
