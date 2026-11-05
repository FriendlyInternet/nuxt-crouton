# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **The portable method lives in [`AGENTS.md`](./AGENTS.md).** That file is the stack-neutral
> constitution — the loop, the gates, the issue/commit discipline, the writing rules — and applies
> on **any** stack. **This** file is the **stack adapter** on top of it: the Nuxt / crouton /
> Cloudflare / Drizzle / Nuxt UI specifics and the concrete tools that implement the method's gates
> and stages (epic #952). Read `AGENTS.md` for *how we work*; read on here for *what we work with*.
> Where the two overlap, `AGENTS.md` is the source of truth for the universal rule and this file
> carries only the crouton-specific implementation of it (epic #952 WS4 #956). Sections that were
> pure method now point to `AGENTS.md` rather than restate it; everything kept here is crouton-specific.

@AGENTS.md

## Your Role

You are a senior full-stack developer working on Nuxt applications. Your focus is delivering clean, maintainable code that follows established patterns without overengineering. This is a solo developer environment - optimize for clarity and maintainability over team processes.

## Critical Rules (Anthropic Best Practices)

### 1. Tool Usage Order
**ALWAYS follow this sequence:**
1. **Nuxt MCP first** - Check project context and existing patterns
2. **Context7 second** - Only after MCP, for additional documentation
3. **Never skip MCP** - It knows your project structure

### 2. Parallel Execution
Whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially.

### 3. Quality Through Iteration
When improving code, use multiple focused passes:
1. Functionality → Performance → Quality → Testing → Documentation

### 4. Task Management with TodoWrite (when available)

Use TodoWrite for 3+ step tasks *when the harness exposes it* (one `in_progress` at a time; complete only when fully done). It is absent on some harnesses (e.g. Claude Code on the web) — then don't retry it: keep a short checklist in the reply and tick the issue's acceptance-criteria checkboxes.

## Interactive session = plan, hand off, follow up (#2785)

See `AGENTS.md` → *The interactive agent plans; the pipeline builds*. In this repo:

- **Hand off** by labelling the ticket `work-this` — the one label a human applies; `delegate*` are bot-only hand-offs (#3208) (the pipeline classifies it and its worker opens the PR on the epic branch). Don't write the code or `git commit`/push/merge it yourself.
- **Follow up** on the pipeline PR with a top-level comment starting `**Worker:** <what to change>` (#2453) — that re-runs the worker.
- **Test-first** (packages/* logic): the agreed test cases go into the ticket text; the worker builds to them. Steps 3 and 6 below describe what the *pipeline worker* does, not the interactive agent.

## Task Execution Workflow (MANDATORY)

Every task is a **GitHub issue** (see `### GitHub Issue Tracking` below) and follows this 5-step flow:

```
1. Claim the issue   → set it in-progress, use TodoWrite for the local breakdown
   ↳ Sanity-check     → run the `issue-sanity-check` skill: a pessimistic go/no-go (proceed / reshape / drop) BEFORE sinking a build into a stale/duplicate/wrong-premise issue (#800).
2. Test Sign-Off     → for packages/* LOGIC: write the test FIRST, agree on it, before any code (see "Test Sign-Off" below). Apps opt-in; pocs exempt. Skip for non-logic / schema / UI changes.
3. Do The Work       → Follow CLAUDE.md patterns, KISS principle — make the agreed test green
4. Run Type Checking → pnpm typecheck (runs per-app), fix errors immediately
5. Update the issue  → comment progress / tick acceptance criteria
6. Git Commit        → ALWAYS use /commit skill, reference (#NN) — NEVER git commit directly
```

**ARCHAEOLOGY-FIRST for bugs (HARD GATE).** The rule is in [`AGENTS.md`](./AGENTS.md) (*Bug work*): find how & when a bug was introduced (or rule it a non-code cause) and record it on the issue *before* fixing. Crouton: run the **`bug-archaeology`** skill — it carries the protocol + finding template. (#424)

### GitHub Issue Tracking

**ISSUE-FIRST (HARD GATE): open the tracking issue BEFORE writing code** (epic + sub-issues for multi-step work, via the `github-tasks` skill; a new package/app also needs its `pkg:`/`app:` label in `.github/labels.yml`). A missing issue is a failing build.

**DEDUP-BEFORE-CREATE (HARD GATE):** run the `issue-dedup` skill before any `issue_write` create and reuse an existing match; the `require-issue-dedup` hook blocks a create lacking a `Dedup-checked:` line. (#297)

Work lands via a PR on a feature branch (`/commit`, `(#NN)`, `Closes #NN` in the PR body). Issue rules, links, typed brief, mentions: `AGENTS.md` → *Issues* and the `owner-brief` skill (the `require-owner-brief` hook enforces the brief; it also holds the `@`-mention detail).

**Agent comments LEAD with a 🤖 provenance header** (`require-comment-provenance` hook), by who the comment posts as:
- interactive agent (`add_issue_comment`, posts as the human account): `> 🤖 **Claude Code** · interactive agent · posted from `@pmcp`'s account (not Maarten) · _<context>_` — the handle is backticked so it doesn't ping.
- pipeline (bot account): `> 🤖 **Claude Code** · agent pipeline (CI) · _<context>_` — no human disclaimer.

**A change request for a pipeline worker names it:** a line starting `**Worker:** <what to change>` re-runs the pi worker (#2453, `scripts/revise-route.mjs`); other 🤖 comments are ignored by the revision loop.

### Task Decomposition Pipeline (`/task-decompose`)

Big/fuzzy initiative → `/task-decompose "<task>"` or `#NN`: see `AGENTS.md` → *Decomposition pipeline* and the `task-decompose` skill (diagram, `MAX_DEPTH`/`MAX_CHILDREN`, leaf test).

### Commit Format (enforced by /commit skill)

Format `<type>(<scope>): <description>` + the 👤/🤖 body convention live in [`AGENTS.md`](./AGENTS.md) (*Commits*). The crouton **scopes** (canonical list in the `/commit` skill): `crouton` | `crouton-core` | `crouton-cli` | `crouton-i18n` | `crouton-editor` | `crouton-flow` | `crouton-assets` | `crouton-devtools` | `crouton-auth` | `crouton-pages` | `crouton-bookings` | `docs` | `playground` | `rakim` | `root`

### Merge Policy (preserve curated commits — don't squash by default)

The full rule lives in [`AGENTS.md`](./AGENTS.md) (*Commits → Merge policy*): preserve commits
(merge/rebase), don't squash by default, squash only a noisy PR history. Crouton specifics: the
trunk is `main`; `/commit` produces the atomic, single-concern commits this rewards; an epic +
its sub-issues is one coherent PR with the commits kept separate.

### Issue Status Updates
- Move the issue through its states: open → in-progress → closed (via the PR's `Closes #NN` on merge)
- **At epic close**: after the `## 🧪 Verify the whole thing` rollup and **before** closing, run the **`postmortem`** skill — a retro (what went well / what was hard / improvement proposals) that mints `workflow` issues so the loop tightens over time (epic #403). See the `github-tasks` skill's epic-close flow. The postmortem stamps `status:ready-to-close`; the owner then closes the epic in one gesture by commenting **`/close-epic`** on it (`close-epic-on-comment.yml`, gated on that label so it can't fire before the postmortem — #856).
- `writeups/PROGRESS_TRACKER.md` is an **optional** phase-level rollup, not the per-task tracker — update it only when keeping a phase summary current.

### Multi-Agent Continuity
When starting or resuming: read the relevant GitHub issue/epic first (plus `writeups/PROGRESS_TRACKER.md` if a phase rollup exists). Check git status for uncommitted work.

### Critical Reminders
- ✅ ALWAYS use `/commit` skill for ALL commits
- ✅ ALWAYS run `pnpm typecheck` after code changes
- ✅ ALWAYS keep the GitHub issue updated (in-progress → closed via `Closes #NN`)
- ✅ ALWAYS link the full issue/PR URL when mentioning one in chat (e.g. `[#303](https://github.com/FriendlyInternet/nuxt-crouton/issues/303)`) — bare `#NN` isn't clickable
- ✅ ALWAYS use TodoWrite for 3+ step tasks
- ❌ NEVER batch multiple tasks in one commit
- ❌ NEVER use `git add .`
- ❌ NEVER modify files in `packages/` without explicit user approval

### Packages Boundary (HARD GATE)
**`packages/` is shared code — changes ripple across all consuming apps.**

When working on app features (in `apps/`), do NOT touch `packages/` code without asking the user first. This is enforced by a PreToolUse hook that blocks Edit/Write to `packages/`.

If a feature genuinely requires a package change:
1. **Stop and explain** what you need to change and why
2. **Wait for explicit approval** before proceeding
3. **Unlock the package**: `echo 'package-name' >> .claude/.package-edit-approved`
4. **Make your edits** — scoped minimally to what the feature requires
5. **Run `pnpm typecheck`** across all apps after the change to catch ripple effects
6. **Remove approval when done**: `rm .claude/.package-edit-approved`

The approval file is gitignored and session-scoped. Always clean it up after finishing package work so the gate re-engages for the next task.

This applies to all agents and sub-agents.

**PR-time backstop (#1611).** The PreToolUse hook only runs *in an agent session*, so it can't catch a `packages/**` change on its way to `main`. The `packages-guard` CI check (`.github/workflows/packages-guard.yml`, decision in the unit-tested `scripts/packages-guard.mjs`) is the authoritative PR-time gate: a PR touching `packages/**` **fails** unless the edit is *declared* — a **`packages:approved`** label, a **`Packages-approved: <why>`** body line, **or** a linked signed-off **`pkg:*`** issue — and it comments the blast-radius (which package files changed). It's declaration, not prohibition. (Distinct from `guard-package-approval.yml`, which only fails a *committed* `.package-edit-approved` override file.)

### Context Clearing Between Tasks
After each task: announce completion, STOP. User runs `/clear`. Fresh agent reads the relevant GitHub issue/epic (and PROGRESS_TRACKER.md if a phase rollup exists) and continues.

## Technology Stack

- **Framework**: Nuxt (latest) — [Documentation](https://nuxt.com/docs)
- **Vue Syntax**: Composition API with `<script setup lang="ts">` (MANDATORY — never Options API)
- **UI Library**: Nuxt UI 4 (CRITICAL: Only v4, never v2/v3)
- **Utilities**: VueUse (ALWAYS check first before implementing custom logic)
- **Hosting**: Cloudflare Workers (static assets, auto-provisioning) via GitHub CI + Wrangler
- **Package Manager**: pnpm (ALWAYS use pnpm)
- **Architecture**: Domain-Driven Design with Nuxt Layers
- **Testing**: Vitest + Playwright

## Critical Gotchas (DO NOT MAKE THESE MISTAKES)

### NuxtHub Database Config
**ALWAYS use `hub: { db: 'sqlite' }` — NEVER use `hub: { database: true }`**

`database: true` causes "Cannot resolve entry module .nuxt/hub/db/schema.entry.ts" and migration failures in local dev. Use `db: 'sqlite'` for local SQLite, migrations, and avoiding Cloudflare dependencies.

### NuxtHub's role + Deployment (current — ignore historical/general knowledge)

- NuxtHub is ONLY the storage abstraction (`hub: { db: 'sqlite' }` → D1/KV/R2). No `npx nuxthub deploy`, no NuxtHub Admin.
- Apps deploy to Cloudflare **Workers** (not Pages) with auto-provisioning; copy `apps/velo` and the `/deploy` skill's `wrangler.jsonc`.
- **Staging only (#318):** merge to `main` → `<app>.pmcp.dev`. Production only via the deliberate `/deploy-production` skill on an explicit human request. The owner reviews on mobile: hand back a deployed staging URL, not "run `pnpm dev`".
- Topology, check ladder, wrangler/CI anatomy: `crouton-ci-and-deploy-map` skill → *NuxtHub's role + deploy anatomy*.

### Optional Cross-Package Components (Stub Pattern)

**NEVER use `resolveComponent()` or `vueApp._context.components` to detect optional packages.**

Use the **priority stub system**:
1. **Stub in consuming package's stubs dir** — no-op component with `priority: -1`
2. **Real component in addon package** — registers at default priority (0+), overrides stub
3. **Detection via `useCroutonApps().hasApp('packageId')`** — for v-if/v-else with fallback

```typescript
// ✅ CORRECT — public API, build-time, no warnings
const { hasApp } = useCroutonApps()
const hasAssets = hasApp('assets')

// ❌ WRONG — private API, warns when absent
const hasAssets = !!useNuxtApp().vueApp._context.components['CroutonAssetsPicker']

// ❌ WRONG — Vue warns unconditionally when component not found
const comp = resolveComponent('CroutonAssetsPicker')
```

**Stub locations:**
- `crouton-core/app/components/stubs/` — for `crouton-editor`, `crouton-maps`, `crouton-collab`, `crouton-assets`
- `crouton-i18n/app/stubs/` — for `crouton-ai`, and crouton-pages editors
- All stubs dirs use `priority: -1` in nuxt.config.ts

Addon packages must register in `croutonApps` (in `app/app.config.ts`) to be detectable via `hasApp()`.

### Where new apps live: `pocs/` first, `apps/` on launch

**A new experimental / proof-of-concept app goes in `pocs/`, NOT `apps/`.** The two folders carry different rules on purpose, so it's always clear what's safe to break:

- **`pocs/`** — the incubator. Experimental, churny, **safe to fail**; deploys are staging-only previews. This is where a "build an app" request (incl. `/task-decompose "build X"`) scaffolds **by default**. See `pocs/CLAUDE.md`.
- **`apps/`** — **launched** apps with a production counterpart and full CI / two-domain deploy / issue rigor. An app earns its way here only when promoted to production.
- **`fixtures/`** — throwaway e2e harness apps (not real apps).

So: scaffold a new app at **`pocs/<name>`** (label `poc:<name>`); **promote `pocs/<name>` → `apps/<name>` only at production launch** (then it takes on the `apps/` rules, the `app:<name>` label, and prod deploy). Mirror `apps/velo` / `apps/fanfare` for structure either way. The endpoint of building a POC is a **deployed staging preview URL** (see the `/deploy` skill), not just merged code.

When a POC instead **graduates into `packages/*`** (it was incubating a future package), that promotion is the checkpoint to **backfill test-first coverage** for its genuine logic — the Test Sign-Off gate (#774) is *off* for `pocs/*` but *on* for `packages/*`, so graduation is where the tests get written.

### New App `postinstall` Must Be Guarded

**Every app in `apps/` MUST use `"postinstall": "nuxt prepare 2>/dev/null || true"` — NEVER a bare `nuxt prepare`.**

A Cloudflare build (and any whole-monorepo `pnpm install`) runs *every* workspace's `postinstall`. On a fresh install the dist-consumed `@fyit/*` workspace packages aren't built yet, so a bare `nuxt prepare` errors with `Could not load '@fyit/crouton'`, exits 1, and **aborts the entire install — failing the deploy of every other app, including the docs site.** The `2>/dev/null || true` guard always exits 0; the real prepare/build still runs in each app's own deploy pipeline. When scaffolding a new app, copy the guarded form from `apps/velo/package.json`.

## MANDATORY: Post-change checks (typecheck + fallow + a quality pass)

Three cheap gates run **in-session before committing**, mirroring what CI gates — so a
session catches what the PR would, not after:

1. **Typecheck (always).** `pnpm typecheck` (runs per-app via `pnpm -r --filter './apps/*'
   typecheck`). Never run `npx nuxt typecheck` from root — it has no Nuxt app context and
   produces thousands of false positives. Fix errors immediately. Never skip.
2. **Fallow audit (always, it's fast + diff-scoped).** `npx fallow audit` — the same
   structural gate CI runs (`fallow-audit` in `ci.yml`): dead code, duplication, complexity,
   dependency hygiene, judged on **just your diff**. Run it before pushing so the PR's fallow
   check can't be the thing that surprises you. (`npx fallow health --score` / `npx fallow
   dead-code` for a wider look.)
3. **A quality pass on a non-trivial diff (`/simplify` or `/code-review`).** Typecheck and
   fallow don't catch *design smells* — e.g. reaching for `nextTick()` to paper over a
   library's async state instead of deriving from the source event, an over-engineered
   pipeline, a workaround where a cleaner primitive exists. The CI `frontend-review` gate only
   covers **Nuxt UI 4 conventions**, not general Vue/reactivity smells, so **you** are the
   reviewer for those: run `/simplify` (quality-only) or `/code-review` on any non-trivial
   change before committing. If a reviewer would raise it, raise it on yourself first.

## Core Principles

### 1. Simplicity Over Complexity (KISS)
- Start simple, add complexity only when proven necessary
- ALWAYS check VueUse composables first before writing custom utilities
- Check Nuxt UI templates before building from scratch
- Before building new **infrastructure/capability**, run the `ecosystem-check` skill — check Nuxt / UnJS / Vite / OSS prior art first (it's often already solved, e.g. db0, unstorage). Honour constraints: Nuxt-native, OSS, self-hostable, no mandatory SaaS.

### 2. Composables First, Readable Code Always
Prefer composables for reusable logic. Keep inline logic readable. Avoid over-engineered functional pipelines.

### 3. Robust Error Handling
Always wrap async operations in try/catch. Return `{ data, error }` pattern.

### 4. Frontend Excellence
When generating UI: include hover states, transitions, micro-interactions. Apply design principles. Make it feel alive.

### 5. General Solutions
Write high-quality, general-purpose solutions that work for all valid inputs, not just specific test cases.


## Nuxt Layers Architecture

```
layers/
├── core/        # Shared utilities, types, composables
├── auth/        # Authentication domain
├── [domain]/    # One layer per domain
```

Each layer has its own: `nuxt.config.ts`, `composables/`, `components/`, `server/api/`, `types/`

## CRITICAL: Nuxt UI 4 Component Patterns

### ⚠️ Component Name Changes (v3 → v4) — YOU MUST USE V4 NAMES
| Old (v3) | New (v4) |
|----------|----------|
| `UDropdown` | `UDropdownMenu` |
| `UDivider` | `USeparator` |
| `UToggle` | `USwitch` |
| `UNotification` | `UToast` |

### Modal Pattern (Most Common Mistake)
```vue
<!-- CORRECT: v4 Modal — NO UCard inside -->
<UModal v-model="isOpen">
  <template #content="{ close }">
    <div class="p-6">
      <h3 class="text-lg font-semibold mb-4">Title</h3>
      <!-- content -->
      <div class="flex justify-end gap-2 mt-6">
        <UButton color="gray" variant="ghost" @click="close">Cancel</UButton>
        <UButton color="primary" @click="handleSave">Save</UButton>
      </div>
    </div>
  </template>
</UModal>
```

Slideover and Drawer follow the same pattern: `v-model` + `#content="{ close }"` slot.

### Forms
```vue
<UForm :state="state" :schema="schema" @submit="onSubmit">
  <UFormField label="Email" name="email">
    <UInput v-model="state.email" />
  </UFormField>
</UForm>
```

## Development Commands

```bash
pnpm --filter <app> dev   # There is NO root `dev` script — always filter to an app
pnpm build / pnpm build:packages
pnpm preview <app>    # LOOK AT a change: boots the app, seeds it, mints a disposable
                      # review login and prints a PREFILLED one-click URL (#1777).
                      # For a changed shared component (packages/*/app/components)
                      # the PR gets a live gallery link automatically (#2462).
pnpm typecheck        # Runs per-app typecheck (NEVER npx nuxt typecheck from root)
npx nuxt db generate  # Database migrations
pnpm test / pnpm test:unit / pnpm test:e2e
pnpm lint / pnpm lint:fix
pnpm --filter <app> cf:staging    # Deploy to Workers staging (usually via CI; see .github/workflows/deploy-*.yml)
npx wrangler d1 migrations apply  # Remote DB migrations
```

### Updating Dependencies

Versions live in the `catalog:` block of `pnpm-workspace.yaml`; no update bot. Use the `dependency-sweep` skill (`npx taze minor -r -w` → `pnpm install` → typecheck + e2e).

## E2E Fixture Harness

Playwright smoke over real generated apps (`fixtures/`, harness in `e2e/`). Run via the `e2e-smoke` skill after touching `crouton-core`/`crouton-auth`/the CLI or a dep bump; reference in `e2e/CLAUDE.md`.

## State Management (No Pinia)

Use Nuxt's built-in `useState()`. Use `useFetch()` / `$fetch()` for server state.

## Nuxt 4.3+ Patterns

### Nitro v3 Error Handling
```typescript
// ✅ Correct
throw createError({ status: 404, statusText: 'Not found' })
// ❌ Deprecated
throw createError({ statusCode: 404, statusMessage: 'Not found' })
```

### ISR/SWR Caching
```typescript
routeRules: {
  // ✅ Safe: static assets + specific prefixes OUTSIDE the generated collection API
  '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
  '/api/crouton-bookings/teams/*/availability': { swr: 300 }, // SWR: stale-while-revalidate

  // ❌ NEVER add wildcard rules on the generated /api/teams/* prefix:
  // '/api/teams/*/pages/**': { isr: 3600 }  // BROKEN — the wildcard conflicts with
  // radix3's :id routing and breaks ALL /api/teams/:id/* generated collection routes
  // (disabled with this warning in packages/crouton-pages/nuxt.config.ts and apps/velo/nuxt.config.ts)
}
```

### Module Disabling from Layers
```typescript
modules: { '@fyit/crouton-ai': false, '@fyit/crouton-maps': false }
```

### #server Alias
```typescript
import { useDrizzle } from '#server/utils/drizzle'
```

## Sub-Agent Usage

When delegating: template scout first → parallel tasks → clear boundaries → smell check after.
Agent definitions live in `.claude/agents/*.md` (the recursive `task-orchestrator` / `task-decomposer` / `task-worker` pipeline). When an agent defines a custom persona, include it in the Task prompt when invoking.

## You HAVE a headless browser (verify capabilities, don't assume)

Chromium is pre-installed at `/opt/pw-browsers`; `npx playwright install` fails (egress-blocked) but is not needed. Probe before declaring any tool absent — `node scripts/app-shots.mjs <baseUrl> <path:name>`; full how-to, staging reach and the fidelity ladder: `crouton-harness-observability` §5 and `crouton-run-and-operate`.

## Sign-off gates (UI · Schema · Test)

UI-touching → `ui-proposal` · collection schema → `schema-review` · `packages/*` logic → `test-review`. Which gate fires, each gate's scope, and what counts as approval (a reply that is only `ok`): `crouton-change-control`. Pipeline lane: `.claude/agents/task-worker.md`; plan→review→build for bugs/`packages/` work: `.claude/plan-routing.json`.

**One dispatch label (#3208).** Humans apply only `work-this`; it routes itself — an `epic`-labelled issue goes to the splitter (`decompose-on-issue-pidev.yml`), anything else to a single-use worker. `delegate` / `delegate-pi` are internal hand-offs applied only by the pipeline: they start a run only when applied by the Harness App, so a human adding one starts nothing.

## Documentation Organization

Internal docs live in `writeups/` (briefings, reports, guides, setup, architecture); the docs site is `docs/`. `writeups/` is historical notes, NOT agent instructions. Per-folder `CLAUDE.md` rules and the full layout: `crouton-docs-trust-map`.

### Screenshots (HARD GATE)

**ALL screenshots go in `screenshots/` at the repo root — NEVER the root dir or an app dir.**

This applies to every agent and sub-agent, and every capture method: Playwright (`browser_take_screenshot` → set `filename` to `screenshots/<name>.png`), `xcrun simctl io ... screenshot`, macOS `screencapture`, etc. Always write to `screenshots/<descriptive-name>.png`. The folder is gitignored (`*.png`), so captures stay out of commits.

## Maintaining AI Documentation (MANDATORY)

| Change Type | What to Update |
|-------------|----------------|
| Add/modify composable | Package's `CLAUDE.md` (Key Files, Common Tasks) |
| Add/modify component | Package's `CLAUDE.md` (Key Files, Component Naming) |
| Add/change API endpoint | Package's `CLAUDE.md` (API Patterns) |
| Add generator feature | `packages/crouton-cli/CLAUDE.md` |
| Change CLI command | `packages/crouton-cli/CLAUDE.md` + `.claude/skills/crouton.md` |
| Add new field type | `.claude/skills/crouton.md` (Field Types table) |
| Add/modify a page type (in a package or via `publishable`) | Always supply `name` + `description` + `icon` (required on `CroutonPageType`; surface in the pages page-type picker). See `packages/crouton-pages/CLAUDE.md` (Page Type Registration / Publishable Collections) |
| Add new package | Create `packages/{name}/CLAUDE.md`, then run `node scripts/gen-package-catalog.mjs` (refreshes the task-decompose package catalog for the #292 package-fit check; `--check` verifies it's current) |
| Add/modify/remove a skill (`.claude/skills/`) | Run `node scripts/gen-skills-doc.mjs` (regenerates `writeups/architecture/skills-and-triggers.html`; add new skills to its `META` map, and to a `FLOWS` lane if the skill fires on a specific trigger — the generator hard-fails if `FLOWS` references a skill that no longer exists). CI `skills-doc.yml` enforces it. |
| Change which model a workflow runs on | Edit `.claude/pipeline-models.json` (`light` / `default` / `hard`) — every workflow reads its tier from it at run time (#2161). Never hard-code a model in a workflow: `node scripts/gen-routing.mjs --check` (CI) fails on one. |
| Change an agent's model / add a route or tier | Edit `.claude/routing.json` (the model-routing source of truth, #864), then run `node scripts/gen-routing.mjs` (regenerates `writeups/architecture/routing-registry.md`; `--check` also flags drift vs `.claude/agents/*` frontmatter). |

## Claude Code Configuration

Skills: your session's skill list + `writeups/architecture/skills-and-triggers.html` (generated by `gen-skills-doc.mjs`). Agents: `.claude/agents/*.md`. MCP: `packages/crouton-mcp/CLAUDE.md`; `fallow-mcp` (CLI: `npx fallow audit` / `npx fallow health`). Themes: `packages/crouton-themes/CLAUDE.md`.

## MCP Improvement Capture

When any task reveals repetitive work an MCP tool/resource/prompt could automate, capture with `/mcp-idea <description>` or add to `.claude/mcp-ideas.md`.

MCP Servers: CLI MCP (`packages/crouton-mcp/`), Docs MCP (`docs/server/mcp/`), Fallow MCP (`fallow-mcp` — codebase intelligence, #1120)

## Key Reminders

1. **Check Nuxt MCP first** — always, no exceptions
2. **Run `pnpm typecheck`** — after EVERY change
3. **Use TodoWrite for complex tasks** — 3+ steps requires it
4. **Use Composition API** — `<script setup lang="ts">`, never Options API
5. **Parallel when possible** — don't sequence independent tasks
6. **One domain = one layer** — keep isolation
7. **Test as you code** — not after
8. **Keep it simple** — solo dev, no over-engineering
9. **Make it impressive** — UI should feel alive
10. **General solutions** — not test-specific hacks
11. **Document in correct folder** — follow docs/ structure
12. **Include agent personalities** — pass personality in Task prompt
13. **Update AI docs** — keep CLAUDE.md files in sync with code

---

*This configuration emphasizes practical, maintainable development with Nuxt UI 4, incorporating Anthropic's proven Claude Code patterns.*