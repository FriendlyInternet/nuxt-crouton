# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### 4. Task Management with TodoWrite (MANDATORY)

**CRITICAL**: Use the TodoWrite tool proactively for ALL complex tasks.

**When to use:** Any task with 3+ steps, multi-file changes, debugging, feature implementations.
**When NOT to use:** Single straightforward tasks, trivial changes, purely conversational queries.

**Critical Rules:**
- Exactly ONE task must be `in_progress` at any time
- Mark tasks `completed` IMMEDIATELY after finishing
- ONLY mark complete when FULLY accomplished — never if tests fail or work is partial

Each todo requires:
- `content`: Imperative form (e.g., "Fix authentication bug")
- `activeForm`: Present continuous (e.g., "Fixing authentication bug")

## Task Execution Workflow (MANDATORY)

Every task is a **GitHub issue** (see `### GitHub Issue Tracking` below) and follows this 5-step flow:

```
1. Claim the issue   → set it in-progress, use TodoWrite for the local breakdown
2. Do The Work       → Follow CLAUDE.md patterns, KISS principle
3. Run Type Checking → pnpm typecheck (runs per-app), fix errors immediately
4. Update the issue  → comment progress / tick acceptance criteria
5. Git Commit        → ALWAYS use /commit skill, reference (#NN) — NEVER git commit directly
```

### GitHub Issue Tracking

**ISSUE-FIRST (HARD GATE): open the tracking issue BEFORE writing code.** For any new feature/package/app/initiative, the *first* action is creating the GitHub issue (epic + sub-issues for anything multi-step) via the `github-tasks` skill — not after the work, not at PR time. If you catch yourself editing files for an initiative that has no issue, STOP and open it first. New package or app? It also needs its `pkg:`/`app:` label in `.github/labels.yml`. This is the step most easily skipped — treat a missing issue like a failing build.

Tasks are tracked as **GitHub issues** (`pmcp/nuxt-crouton`) — see the `github-tasks` skill. The issue is the unit of work: open an **epic + sub-issues** for an initiative, label each by **package or app** (never `root`; exactly one `type:*`). Work lands via a **PR** on a feature branch (commit with `/commit`, reference `(#NN)`, put `Closes #NN` in the PR body to auto-close on merge) — not direct pushes to `main`. `writeups/PROGRESS_TRACKER.md` becomes an optional phase-level rollup, not the per-task tracker.

**Always link issues & PRs when you mention them in chat.** Whenever you reference an issue or PR to the user (in prose, lists, or tables), include its full URL so it's one click to open — `#NN` alone isn't clickable. Format: `#303` → `[#303](https://github.com/pmcp/nuxt-crouton/issues/303)` for issues, `…/pull/376` for PRs. This is a **chat-reply** convention only — keep bare `(#NN)` in commit messages, and use `Closes #NN` (not a URL) in PR bodies so GitHub's auto-close works.

**Write issues & epics as bets, not task lists (default).** Frame work as an assumption — *We think that* if we do X, then Y will happen (and Y is what we want) · *We'll do that by* … · *We'll be right if* … · *We'll know by* … — so we can later check whether we were right. It's a lens over the existing 👤/🤖/🧪 sections (open with `## 🎯 The bet`), not a new heading. Use it for every epic/issue as much as possible; trivial chores may opt out. Full template + worked examples in the `github-tasks` skill (epic #359).

### Task Decomposition Pipeline (`/task-decompose`)

For a big/fuzzy initiative, you can let agents do the epic→sub-issue breakdown **and** the work. `/task-decompose "<task>"` (or `/task-decompose #NN` to reuse an existing epic) creates the epic, then spawns a recursive agent pipeline that builds out the whole issue tree and works the leaves:

```
/task-decompose '<task>'
  └─ task-orchestrator (depth 0)   reads epic → 2–6 sub-issues → spawns a decomposer per child
       └─ task-decomposer (depth 1+, RECURSIVE)   LEAF TEST one issue:
            ├─ leaf / at depth cap → spawn task-worker (worktree) → PR (Closes #N)
            └─ too big            → create sub-issues → spawn a decomposer per child (recurse)
```

**Stop-conditions** (so it can't run away): `MAX_DEPTH = 3`, `MAX_CHILDREN = 6`, and a four-part **LEAF TEST** (single coherent change · bounded files · clear/testable acceptance · doable in one focused run). All four true ⇒ build it, don't split. Tune in `.claude/agents/task-decomposer.md`. Everything persists as real GitHub issues (it obeys the same `github-tasks` + `/commit` + no-squash rules); it does **not** auto-merge. Details: `.claude/skills/task-decompose/SKILL.md` and `.claude/agents/CLAUDE.md`. (Epic #249.)

### Commit Format (enforced by /commit skill)
```
<type>(<scope>): <description>
```
Types: `feat` | `fix` | `refactor` | `docs` | `test` | `chore`

Scopes (canonical list lives in the `/commit` skill): `crouton` | `crouton-core` | `crouton-cli` | `crouton-i18n` | `crouton-editor` | `crouton-flow` | `crouton-assets` | `crouton-devtools` | `crouton-auth` | `crouton-triage` | `crouton-pages` | `crouton-bookings` | `docs` | `playground` | `rakim` | `root`

### Merge Policy (preserve curated commits — don't squash by default)

**Default: merge a PR preserving its commits (merge commit or rebase) — do NOT squash.** Optimise history for an *AI agent doing archaeology later* (`git blame` a line → read that commit's *why*; `git bisect` a regression → land on a small diff). That rewards small, single-concern, green commits with rich messages — which `/commit` already produces.

- **Squash collapses signal here.** A typical PR bundles an epic's several sub-issues (each its own atomic `/commit` with a 👤/🤖 body). Squashing turns that into one giant, multi-concern megacommit: `blame` lands on a 1000+-line blob spanning unrelated changes, and the per-issue rationale is blurred into one summary.
- **Squash ONLY when a PR's own history is noisy** — `wip`, `fix typo`, `oops`, half-broken intermediate states. Messy-granular is the *worst* case for an agent (bisect hits broken commits); squashing that is an improvement. Clean-granular beats both.
- **The real requirement** (not the merge button): every commit landing on `main` is atomic, **green/buildable**, single-concern, and carries a real "why". Keep that true and granular history is strictly more useful than squashed.
- **Corollary:** don't bundle many unrelated concerns into one PR and then squash — that's how you get an unblameable megacommit. One PR = one coherent change set (an epic + its sub-issues is fine; the commits stay separate).

### Issue Status Updates
- Move the issue through its states: open → in-progress → closed (via the PR's `Closes #NN` on merge)
- `writeups/PROGRESS_TRACKER.md` is an **optional** phase-level rollup, not the per-task tracker — update it only when keeping a phase summary current.

### Multi-Agent Continuity
When starting or resuming: read the relevant GitHub issue/epic first (plus `writeups/PROGRESS_TRACKER.md` if a phase rollup exists). Check git status for uncommitted work.

### Critical Reminders
- ✅ ALWAYS use `/commit` skill for ALL commits
- ✅ ALWAYS run `pnpm typecheck` after code changes
- ✅ ALWAYS keep the GitHub issue updated (in-progress → closed via `Closes #NN`)
- ✅ ALWAYS link the full issue/PR URL when mentioning one in chat (e.g. `[#303](https://github.com/pmcp/nuxt-crouton/issues/303)`) — bare `#NN` isn't clickable
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

**NuxtHub here is ONLY the storage abstraction, NOT the deploy tool.** `hub: { db: 'sqlite', kv?, blob? }` maps to Cloudflare **D1 / KV / R2** at runtime. We do **NOT** use `npx nuxthub deploy` or the NuxtHub Admin/managed cloud — do not suggest it.

**Apps deploy to Cloudflare WORKERS (static assets) with auto-provisioning** — the crouton standard (#108/#114; *not* Pages — ignore older docs/commits that say Pages). Wrangler auto-creates the app's D1 + KV on the first deploy (no manual resource/project creation, no id-juggling). Canonical examples: **`apps/triage`**, **`apps/velo`**, **`apps/fanfare`** (their `wrangler.jsonc` is generated by the **`/deploy` skill** — copy that pattern, don't invent one).

**Two-domain topology (#133):** production → **`<app>.friendlyinter.net`**, staging → **`<app>.pmcp.dev`** (separate registrable domains = bulletproof session/cookie isolation). The deploy env is named **`staging`** (not `preview`).

**🟦 STANDING RULE — deploy to STAGING, never production (#318).** The default deploy target is **always staging**: agents, skills, and routine work deploy to staging only (`/deploy` skill / `cf:staging` / push to `staging`). **NEVER deploy to production** except via the dedicated **`/deploy-production`** skill, invoked on an **explicit human request** to ship to prod. Production stays a deliberate, manual `workflow_dispatch` (env=production) — never a side effect of an agent flow.

The pattern, end to end:
- **`wrangler.jsonc`** (Workers): **no** `pages_build_output_dir`; `compatibility_flags: ["nodejs_compat"]`; bindings `DB` (D1), `KV`/`BLOB` (R2) as needed — **id-less** so the first deploy auto-provisions them; plus an **`env.staging`** block with **separate** staging ids + a `<app>.pmcp.dev` custom-domain `route` (bindings do NOT inherit across envs). `name`/`main`/`assets` are injected by the preset at build.
- **Build preset**: `NITRO_PRESET=cloudflare_module nuxt build` → output in `.output/`.
- **Scripts**: `cf:deploy` (prod: build → `wrangler deploy` auto-provision → `sync:ids` → migrate `--remote`), `cf:staging` (build → `inject-wrangler-env` → `wrangler deploy --env staging` → `sync:ids` → migrate), `sync:ids` (writes provisioned ids back into `wrangler.jsonc`), `db:migrate*`. NB: the staging migrate step must **not** pass `--config .output/...` (doubles the path → "no migrations"; #138).
- **CI** (`.github/workflows/deploy-<app>.yml`): a thin caller of the reusable **`deploy-app.yml`** (#114). Push to `staging` (path-filtered) → staging; manual `workflow_dispatch` env=production → prod. The caller's `deploy` job must declare `permissions: { contents: read, pull-requests: write }`. Auth via `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (the token needs **account** Workers Scripts/D1/KV/R2 Edit **and** **zone** Workers Routes + DNS Edit for custom-domain binding).
- **First-time setup / migrating a Pages app**: run the **`/deploy` skill** — don't hand-roll it. Worker secrets do NOT transfer from Pages — re-set them (`wrangler secret bulk … --env staging`), pointing `BETTER_AUTH_URL` at the deployed URL.

**Local-only testing** needs no Cloudflare: `pnpm dev` with `hub: { db: 'sqlite' }`. For a quick public URL without a full deploy, a Cloudflare Tunnel over `pnpm dev` works; a stable URL means `cf:staging` / the `/deploy` skill.

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
- `crouton-i18n/app/stubs/` — for `crouton-ai`
- All stubs dirs use `priority: -1` in nuxt.config.ts

Addon packages must register in `croutonApps` (in `app/app.config.ts`) to be detectable via `hasApp()`.

### Where new apps live: `pocs/` first, `apps/` on launch

**A new experimental / proof-of-concept app goes in `pocs/`, NOT `apps/`.** The two folders carry different rules on purpose, so it's always clear what's safe to break:

- **`pocs/`** — the incubator. Experimental, churny, **safe to fail**; deploys are staging-only previews. This is where a "build an app" request (incl. `/task-decompose "build X"`) scaffolds **by default**. See `pocs/CLAUDE.md`.
- **`apps/`** — **launched** apps with a production counterpart and full CI / two-domain deploy / issue rigor. An app earns its way here only when promoted to production.
- **`fixtures/`** — throwaway e2e harness apps (not real apps).

So: scaffold a new app at **`pocs/<name>`** (label `poc:<name>`); **promote `pocs/<name>` → `apps/<name>` only at production launch** (then it takes on the `apps/` rules, the `app:<name>` label, and prod deploy). Mirror `apps/velo` / `apps/fanfare` for structure either way. The endpoint of building a POC is a **deployed staging preview URL** (see the `/deploy` skill), not just merged code.

### New App `postinstall` Must Be Guarded

**Every app in `apps/` MUST use `"postinstall": "nuxt prepare 2>/dev/null || true"` — NEVER a bare `nuxt prepare`.**

A Cloudflare build (and any whole-monorepo `pnpm install`) runs *every* workspace's `postinstall`. On a fresh install the dist-consumed `@fyit/*` workspace packages aren't built yet, so a bare `nuxt prepare` errors with `Could not load '@fyit/crouton'`, exits 1, and **aborts the entire install — failing the deploy of every other app, including the docs site.** The `2>/dev/null || true` guard always exits 0; the real prepare/build still runs in each app's own deploy pipeline. When scaffolding a new app, copy the guarded form from `apps/velo/package.json`.

## MANDATORY: TypeScript Checking
**EVERY change requires `pnpm typecheck`** (runs per-app via `pnpm -r --filter './apps/*' typecheck`). Never run `npx nuxt typecheck` from root — it has no Nuxt app context and produces thousands of false positives. Fix errors immediately. Never skip.

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
pnpm dev / pnpm build / pnpm preview
pnpm typecheck        # Runs per-app typecheck (NEVER npx nuxt typecheck from root)
npx nuxt db generate  # Database migrations
pnpm test / pnpm test:unit / pnpm test:e2e
pnpm lint / pnpm lint:fix
pnpm --filter <app> cf:staging    # Deploy to Workers staging (usually via CI; see .github/workflows/deploy-*.yml)
npx wrangler d1 migrations apply  # Remote DB migrations
```

### Updating Dependencies

Shared versions live in the `catalog:` block of `pnpm-workspace.yaml` (single source of truth — bump there once, not in each `package.json`). We deliberately use **no update bot** (Renovate/Dependabot); for a solo dev that's PR noise, not help. Update on-demand with **`taze`** (catalog-aware):

```bash
npx taze minor -r -w   # review + write available minor/patch bumps across the monorepo
pnpm install           # then verify: pnpm -r --filter './apps/*' typecheck
npx taze major -r      # majors: review only (-w to write), one family at a time
```

For the full flow — sweep → triage (safe/deliberate/wait) → catalog bump → typecheck + e2e gate → tracking — invoke the **`dependency-sweep` skill** (don't hand-roll it). It encodes the gotchas (caret ranges don't downgrade; stale-install `@vue/compiler-sfc` false error; framework minors aren't auto-safe). A recurring **quarterly sweep ticket** keeps it on the calendar.

## E2E Fixture Harness

A Playwright smoke that boots a **real generated crouton app** and verifies it
still **boots → authenticates → does CRUD → renders package surfaces**. This is
the "did a `packages/` change or dependency bump break a consuming app" check —
run it after touching `crouton-core`/`crouton-auth`/the CLI, or after a dep bump.

Two folders, one split:
- **`fixtures/<name>/`** — the apps under test (real generated crouton apps, one
  per package config: `minimal`, `with-pages`, `with-bookings`). Throwaway, not
  deployed. What each one smokes is declared in its `e2e.manifest.json`. See
  **`fixtures/CLAUDE.md`**.
- **`e2e/`** — the Playwright harness (config, generic manifest-driven specs,
  auth flow). The full reference — manifest format, auth realities, adding a
  fixture, gotchas — lives in **`e2e/CLAUDE.md`**.

Run via the **`e2e-smoke` skill** (`.claude/skills/e2e-smoke/`), or directly:
`E2E_FIXTURE=<name> BETTER_AUTH_SECRET=dev BETTER_AUTH_URL=http://localhost:3000 pnpm test:e2e`.

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
  '/api/teams/*/pages/**': { isr: 3600 },      // ISR: cached + revalidated
  '/api/teams/*/translations/**': { swr: 600 }, // SWR: stale-while-revalidate
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

## UI Sign-Off (mock before you build) — epic #307

**When a task changes a visual surface, mock it before you build it.** Treat work as
UI-touching if it adds/changes a `.vue` component, `app/components|layouts|pages/**`, a theme
(`crouton-themes`, a `ui:` block in `app.config.ts`), or app CSS/theme tokens. Pure
`<script>`/composables/types, `server/**`, config, tests, and docs are **not** UI — skip this.

For a UI change: run the **`ui-proposal`** skill to produce a before/after (or after-only)
mockup + PNG, get a human to sign off on the look-and-feel **first**, and only then build the
real component. In the agent pipeline this is automated as a gate in `.claude/agents/task-worker.md`
(post the mockup on a draft PR → hold on `status:blocked` → revise on feedback (#310) → build →
real screenshot (#311)). In an interactive session, do the same by hand: propose, get a yes,
then build. Be conservative — when unsure whether a diff is "visual", don't gate.

**Give feedback on the diff, not the image.** The proposed change is committed as a text
artifact (the UI "what changes" list `<slug>.md`, or a schema's `.md` field table), so it shows
up in the PR's "Files changed" — inline-comment the exact line, no copying. The agent reads
those inline review comments and revises that specific item.

**What counts as approval** (the sign-off signal): a reply containing `approve`/`lgtm`, a 👍 on
the mockup comment, or the `ui-approved` label. Anything else is a change request — revise the
mockup in place (edit the same sticky comment, re-render the PNG) and iterate until approved (#310).

## Schema Sign-Off (review the data model before you generate) — epic #314

**When a task creates or changes a collection schema, review it before generating.** Before
running `crouton config` / `generate_collection` (or editing a `schemas/*.json` fieldsFile), run
the **`schema-review`** skill to render the field table, get a human to sign off on the **data
model** first, and only then generate. The schema is the foundation — every Form/List/API/
migration derives from it, so a wrong type or missing relationship is cheap to fix here and
expensive after. This sits **after** the machine `validate_schema` step (the human gate on top of
it). In the agent pipeline it's a gate in `.claude/agents/task-worker.md`; interactively, do the
same by hand. It **reuses the same revision/approval loop and signal as the UI gate** (#310) —
feedback goes inline on the committed `<collection>.md` in the diff; approval (`lgtm`/👍/
`ui-approved`) unblocks generation.

## Documentation Organization

```
writeups/           # internal project docs (the docs SITE now lives at top-level docs/)
├── briefings/      # [feature-name]-brief.md
├── reports/        # [type]-report-YYYYMMDD.md
├── guides/         # [topic]-guide.md
├── setup/          # [component]-setup.md
└── architecture/   # [domain]-architecture.md
```

**After changes**: Search `docs/content` for references and update external docs.

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
| Add new package | Create `packages/{name}/CLAUDE.md` |
| Add/modify/remove a skill (`.claude/skills/`) | Run `node scripts/gen-skills-doc.mjs` (regenerates `writeups/architecture/skills-and-triggers.html`; add new skills to its `META` map). CI `skills-doc.yml` enforces it. |

## Claude Code Configuration

### Available Artifacts

| Type | File | Purpose |
|------|------|---------|
| Skill | `.claude/skills/crouton.md` | Collection generation workflow |
| Skill | `.claude/skills/sync-docs/SKILL.md` | Doc sync before commits |
| Skill | `.claude/skills/i18n-audit.md` | Translation audit + fix |
| Skill | `.claude/skills/github-tasks/SKILL.md` | GitHub issue tracking (epics, labels, workflow) |
| Skill | `.claude/skills/epic-digest/SKILL.md` | Daily "where are we?" digest — render-only HTML+text email of last-24h activity + a progress snapshot of every open epic (gathers via GitHub MCP, renders dependency-free). For a status rapport / "what moved this week". Sending + scheduling are follow-ups (#357) |
| Skill | `.claude/skills/ecosystem-check/SKILL.md` | Check Nuxt/UnJS/Vite/OSS prior art before building |
| Skill | `.claude/skills/e2e-smoke/SKILL.md` | Run the Playwright fixture smoke harness (boot + auth + CRUD) after a dep bump or `packages/` change |
| Skill | `.claude/skills/db-migrations/SKILL.md` | The migrate step (`db:generate` schema.mjs-after-build gotcha) + package-owned infra tables. App collections use the `crouton` CLI, not this |
| Skill | `.claude/skills/db-clone/SKILL.md` | Mirror one Cloudflare D1 database into another env (`scripts/db-clone.mjs` / `pnpm db:clone`) — refresh staging from prod, seed a preview. Full mirror; `--dry-run` first; prod target needs typed-confirm + backup. Not for per-collection seeding (use `seedData/`) or migrations (use db-migrations) |
| Skill | `.claude/skills/dependency-sweep/SKILL.md` | The "get dependencies current" flow — sweep, triage (safe/deliberate/wait), bump the pnpm catalog, prove it with the typecheck + e2e gate. No update bot by design (#141); run on-demand or when the quarterly sweep ticket is due |
| Skill | `.claude/skills/task-decompose/SKILL.md` | Entry point to the recursive task-decomposition pipeline (`/task-decompose`) — one task → an epic + tree of sub-issues → agents. See "Task Decomposition Pipeline" below |
| Skill | `.claude/skills/ui-proposal/SKILL.md` | Generate a before/after UI mockup (offline HTML/CSS/SVG) + render it to PNG for design sign-off before building UI. Part of the UI sign-off loop (#307) |
| Skill | `.claude/skills/schema-review/SKILL.md` | Render a collection schema (field-definition JSON) into a human-readable field table + relationships (HTML + PNG + Markdown) for data-model sign-off before `crouton config` generates code. Part of the schema sign-off loop (#314) |
| Agent | `.claude/agents/task-orchestrator.md` | Reads an epic, fans it into 2–6 top-level sub-issues, spawns a decomposer per child |
| Agent | `.claude/agents/task-decomposer.md` | Recursive: LEAF TEST one issue → spawn a worker (leaf) or split into sub-issues + spawn a decomposer per child |
| Agent | `.claude/agents/task-worker.md` | Implements one leaf issue on an isolated worktree branch → `pnpm typecheck` → `/commit` → PR (`Closes #NN`) |
| MCP Server | `packages/crouton-mcp/` | AI collection generation |
| Themes | `packages/crouton-themes/` | Swappable UI themes |

### MCP Server Tools
`design_schema` → `validate_schema` → `generate_collection` | also: `list_collections`, `list_layers`

Resources: `crouton://field-types`, `crouton://field-types/json`, `crouton://schema-template`

### Themes Package
Available: `KO` theme (hardware-inspired). Usage: `extends: ['@fyit/crouton-themes/ko']`

## MCP Improvement Capture

When any task reveals repetitive work an MCP tool/resource/prompt could automate, capture with `/mcp-idea <description>` or add to `.claude/mcp-ideas.md`.

MCP Servers: CLI MCP (`packages/crouton-mcp/`), Docs MCP (`docs/server/mcp/`)

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