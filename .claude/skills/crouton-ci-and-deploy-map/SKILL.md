---
name: crouton-ci-and-deploy-map
layer: stack
description: The map of nuxt-crouton's GitHub workflows and the deploy-pipeline anatomy — what each workflow gates, how a merge reaches Cloudflare, which secrets/tokens exist where, and how the agent-pipeline workflows chain. Use when a CI check fails and you need to know what it is, when asked "which workflow deploys X / why did staging update / what does this check gate / where is that secret / why didn't my label trigger anything", when wiring a new app into CI, or when debugging a deploy that never fired. Trigger phrases: "what runs on merge to main", "map of the workflows", "WORKER_SECRETS_JSON", "why is the daily sweep not running", "deploy-apps vs deploy-app", "which token does this workflow use".
---

# CI & Deploy Map

One-line purpose: the ground-truth inventory of `.github/workflows/` (count it: `ls .github/workflows | wc -l`) plus the anatomy of how code reaches Cloudflare Workers — so you can answer "what fires when, gated by what, authenticated how" without re-reading every workflow.

Context for newcomers: this monorepo deploys Nuxt apps to **Cloudflare Workers** (never Pages — older docs lie). Trunk is `main`; merging to `main` auto-deploys **staging** (`<app>.pmcp.dev`); **production** (`<app>.friendlyinter.net`) is reachable only via a deliberate `workflow_dispatch` (#318). Much of CI is an agent pipeline: GitHub-issue-driven Claude runs that decompose epics, work leaves, and gate PRs.

## When to use / when NOT to use

| You want to... | Use instead |
|---|---|
| Actually deploy an `apps/*` app to staging (steps, bootstrap, troubleshooting) | `deploy` skill |
| Ship to production | `deploy-production` skill |
| Give a `pocs/*` app a preview URL | `poc-deploy` skill |
| Tear an app + its CF resources down | `remove-app` skill |
| Generate/apply DB migrations, "No schema files found" | `db-migrations` skill |
| Mirror a D1 database between envs | `db-clone` skill |
| Know which sign-off gate applies to your change and how approval works | `crouton-change-control` sibling |
| Observe a deployed app (tail, smoke, screenshots) | `crouton-run-and-operate` sibling |
| Look up a specific error string | `crouton-diagnostics-index` sibling |

This skill is the **map**: inventory, anatomy, secrets, cadences, and the drift between docs and reality. It carries no deploy runbook steps.

## 1. Workflow inventory

Grouped by role; the file count drifts — count it fresh (`ls .github/workflows | wc -l`).

### CI checks (push / PR to main)

| Workflow | Trigger | Gates what |
|---|---|---|
| `ci.yml` | push/PR (no path filter; `changes` runs `scripts/ci-detect.mjs`) | **Stage-aware (#2894).** `changes` outputs `stage` (poc/app/package/infra/none), `apps` (changed apps + apps depending on a changed package), `packages`, `pocs`, `mcp`. Jobs: `prepare` (builds all package dist once → `package-dist` artifact), `typecheck-apps` (only the affected apps on a PR; all on push), `build-kassa` (only if kassa is in `apps`), `poc-typecheck` (changed POCs: typecheck + their own tests), `mcp` (only `packages/crouton-mcp`), `test`, `compile-check`, `package-check` (only `packages/**`), `node-checks` (docs, schema drift, sync, scripts tests, shellcheck — no install), `fallow-audit`, `gate` (always; the required check). `changeset-check` was deleted (warn-only). |
| `e2e.yml` | push/PR (paths `packages/**, fixtures/**, e2e/**`, lockfile) + nightly cron full matrix + dispatch | Playwright fixture smoke. Leaf PRs into `epic/*` skip the matrix unless they touch `fixtures/**`/`e2e/**`; E2E Gate still reports. Smart selection (#622): PRs run only fixtures affected per each fixture's `e2e.manifest.json`; push-to-main/nightly run all. Regenerates fixtures with the current CLI, so a generator regression = red PR (#197) |
| `guard-package-approval.yml` | PR to main | Fails the PR if `.claude/.package-edit-approved` is committed (would disable the packages/ HARD GATE, #350). Epic-scoped approval uses the `CROUTON_PACKAGE_EDIT_APPROVED` env var instead |
| `skills-doc.yml` | push/PR touching `.claude/skills/**` | `writeups/architecture/skills-and-triggers.html` must be regenerated (`node scripts/gen-skills-doc.mjs`) |
| `routing-registry.yml` | push/PR touching `.claude/routing.json`, `.claude/agents/**` | Model-routing registry drift check (#864) |

### LLM review gates (per-PR, agent-run)

All three share one pattern: a claude-code-action run writes a `<name>-verdict.json` at repo root + a sticky PR comment; a deterministic step then fails the check on the worst severities. Missing verdict file = **red check** with a PR comment (fail-closed, #3070); a cancelled run posts nothing.

| Workflow | Fires on PRs touching | Fails check on |
|---|---|---|
| `review.yml` › red-team (epic → main) | `**/server/**`, `**/app/**`, `**/nuxt.config.ts`, plus all of `packages/**`, `apps/**`, `pocs/**` — i.e. effectively every code PR (skips docs/config-only PRs; drafts and bot-authored PRs are skipped by the job `if`) | high/critical security finding |
| `review.yml` › a11y (epic → main) | `**/*.vue` | axe critical/serious |
| `review.yml` › frontend-review (all PRs incl. drafts; blocks on epic → main) | `**/*.vue` | 🔴 critical incl. hand-rolled UI (e.g. Nuxt UI v3 component names) |

### Deploys

| Workflow | Trigger | Role |
|---|---|---|
| `deploy-app.yml` | `workflow_call` only | THE reusable pipeline (#114) — see §2 |
| `deploy-apps.yml` | push to main + PR (paths `apps/**, packages/**`, lockfile) + `workflow_dispatch(app, environment, review_pr)` | **The one generic caller for every `apps/*` app** (epic #481 WS2). An app opts in by committing `apps/<name>/deploy.config.json`. Replaced the per-app `deploy-<app>.yml` callers. Its `report-bumped-preview` job comments on a PR whose preview deploys were *cancelled* by queue-bumping (a sibling run took the shared per-app staging slot) — cancelled ≠ failed (#1150) |
| `deploy-pocs.yml` | PR touching `pocs/**` + dispatch(app, mode) | POC staging previews; `mode: version` = immutable Workers-version preview URL. Steps: `poc-deploy` skill |
| `deploy-docs.yml` | push to main (`docs/**`) / PR build-smoke / dispatch | Docs site — self-contained, NOT via deploy-app.yml |
| `deploy-sandbox.yml` | dispatch | Manual `sandboxes/*` deploy |
| `report-failed-deploy.yml` | `workflow_run[completed]` of the deploy workflows | On failure on `main`, opens exactly one issue per failing run (idempotency marker, #340). |

### Agent pipeline (see §5 for the chain)

`comment-dispatch.yml` (`/delegate` comment) · `resume-on-comment.yml` (reply on `status:blocked`) · `close-epic-on-comment.yml` (`/close-epic`) · `schedule-waves.yml` (baton pass) · `automerge-epic-subpr.yml` · `fix-ci-on-failure.yml` · `status.yml` · plus the pi.dev variants: `decompose-on-issue-pidev.yml` (**LIVE** — promoted past dispatch-only in #1017: fires on manual dispatch (the `work-this` router sends `epic` issues here) or a bot-applied `delegate*` label (#3208); default model tuned in #1019; has run for real under `delegate-pi`); it runs on GitHub-hosted `ubuntu-latest` on the Claude SUBSCRIPTION via the `claude-bridge` pi provider (npm `pi-claude-bridge`, pinned in `.pi/settings.json` with the other extensions) — `.github/actions/setup-pi` installs a pinned pi + `claude` CLI, preflights `CLAUDE_CODE_OAUTH_TOKEN`, and asserts the provider is registered before pi starts; every pi call passes `--approve` or the project's extension list is ignored (#2275). The older `pi-claude-cli` extension is dead against pi 1.x (registers, then every turn ends silently). The mac-mini and its `mac-mini-smoke.yml` / `pi-box-apply.yml` are retired (#2275).

### Digests & scheduled reports (real cadence in §4)

`epic-digest.yml` · `housekeeping.yml` · `skills-digest.yml` · `label-ready-epics.yml` · `weekly.yml` (Monday: `usage` → `findings` → `advisor`, plus the `cleanup` branch janitor) · `loop-station-inventory.yml` (push-triggered; **commits** to `writeups/loop-station/history.jsonl`) · `sync-changelogs.yml`.

### Housekeeping / ops (event-driven or dispatch-only)

| Workflow | Trigger | Does |
|---|---|---|
| `labels.yml` | push touching `.github/labels.yml` | Syncs labels (`skip_delete: true` — never removes) |
| `strip-status-on-close.yml` | issue closed | Strips `status:*` labels (#641) |
| `cleanup-epic-branches.yml` | PR closed | Deletes `epic/*` head branch only when merged into main (#613) |
| `weekly.yml` (`cleanup` job) | weekly cron + dispatch | Merged-branch janitor; dry-run unless `vars.CLEANUP_BRANCHES_APPLY=true` |
| `status.yml` | PR/issue events, CI completions | One run per event: `board` job moves Projects-v2 cards; `pr-comment` job keeps the sticky PR status + epic rollup (merged from project-status + the former pipeline-pr-status, #2891/#2892) |
| `db-clone.yml` | dispatch | D1 mirror between envs (`db-clone` skill) |
| `db-counts.yml` | dispatch | Read-only row counts of any app DB — the safe "what's in there" check (#384) |
| `teardown-app.yml` | dispatch | CF/branch/issue teardown (`remove-app` skill) — runs in CI because the interactive agent has no Cloudflare creds |

## 2. Deploy pipeline anatomy

### The caller pattern — deploy-apps.yml + deploy.config.json (NOT per-app callers)

**The `NuxtHub's role + deploy anatomy` section at the end of this skill (moved from root CLAUDE.md, #3350) and the `deploy` skill's Step 4 describe this pattern too (fixed under [#1093](https://github.com/FriendlyInternet/nuxt-crouton/issues/1093) — older copies described retired per-app `deploy-<app>.yml` callers).** Reality (epic #481): one generic `deploy-apps.yml` whose `detect` job matrixes over every `apps/<name>/deploy.config.json` whose `watchPaths` match the changed files. Rationale (from the workflow header): the agent pipeline's App token lacks the `workflows` scope, so bots cannot push `.github/workflows/` files — but they CAN push `apps/<name>/deploy.config.json`. Trust the workflow files.

`deploy.config.json` exists for the launched apps plus several pocs — list them fresh (`ls apps/*/deploy.config.json pocs/*/deploy.config.json`). Velo's fields (the shape): `stagingUrl`, `productionUrl`, `layerPackages` (space-separated `@fyit/*` list), `watchPaths` is **derived** by `scripts/deploy-detect.mjs` from the app's `package.json` — app dir + lockfile + every `@fyit/*` dep, transitively (#2397) — so it's normally absent; set it only for extra paths that can't be derived. Optional: `"smoke": { "required": true }` makes the post-deploy smoke gate the run (default is report-only; velo doesn't set it); `"secrets": { "required": true }` fails the deploy if `WORKER_SECRETS_JSON` resolves empty (§3 trap, #1094).

**Prod gating is structural, not conventional:** `deploy-apps.yml` hard-codes `environment=staging` for `push`/`pull_request` events; only `workflow_dispatch` with the explicit `production` choice produces a production matrix entry (#318/#347). Corrected (#2140 — the previous copy here predated #2020 and was wrong): **a PR deploy is ISOLATED, not the same staging Worker/DB as merge-to-main.** `deploy-app.yml` rewrites the built wrangler config for a `pull_request` event (`scripts/lib/pr-preview-wrangler.mjs`, #2020) into a per-PR Worker (`<app>-pr<n>`), strips every D1/KV/R2 id so wrangler auto-provisions fresh (migrated + seeded) resources, and drops the custom-domain route so it publishes to its own `*.workers.dev` URL — `<app>.pmcp.dev` is untouched by any PR. Two PRs on the same app never collide. This is not POC-only; it applies to any `apps/*` PR.

**`pull_request` deploys only the changed app's own paths — with one carve-out (#1297, #2140).** `scripts/deploy-detect.mjs` matches a PR's diff against `apps/<app>/**` only, never the app's shared-package `watchPaths` (a `packages/*` PR fanning out redeploys to every consuming app once saturated all 3 mac-mini runners). The exception: a PR carrying the literal HTML-comment marker `<!-- deploy-preview: full-watch -->` in its body (`UI_SIGNOFF_MARKER` in that file — `work-issue-pidev.yml`'s pi-lane UI-sign-off hold appends it, #1748) opts back into the full `watchPaths`, since that PR is exactly one known app and exists specifically for a human to look at it live. A `push` to `main` always uses the full `watchPaths` regardless.

### Inside deploy-app.yml (the reusable pipeline)

Inputs: `app`, `workspace` (apps|pocs), `environment`, `staging-url`/`production-url`, `layer-packages`, `review-pr`. Key steps, in order (all verified in the file):

1. `pnpm install --frozen-lockfile --ignore-scripts` → `pnpm rebuild better-sqlite3 || true`.
2. Layer-dist cache keyed on **build-set hash + `hashFiles('packages/**/*.ts')`** (the #745 cross-app cache-collision fix). `@fyit/crouton-devtools` is always appended to the layer set.
3. `nuxt prepare`, then **the one real step** — which script runs depends on the trigger: `pnpm run cf:deploy` (prod) or `cf:staging` (a `push`/`workflow_dispatch` staging deploy — the source of truth is the app's `package.json`, so CI and a dev's laptop run the identical script) — but a `pull_request` deploy runs neither: it builds directly, then rewrites the config into the isolated per-PR preview (`pr-preview-wrangler.mjs`, #2020) before its own inline `wrangler deploy`, so the shared staging Worker is never touched by a PR.
4. Optional `wrangler secret bulk` from `WORKER_SECRETS_JSON` (see §3 trap).
5. Preview-review bridge (#607): staging + PR-tied only — pushes `NUXT_CROUTON_REVIEW_*` Worker secrets so in-page overlay comments post to the PR as `nuxt-harness[bot]`.
6. `BETTER_AUTH_SECRET` auto-generated (`openssl rand -hex 32`) if the Worker has none; never rotates an existing one; skips (with `::warning::`) if `wrangler secret list` fails.
7. Demo data seeded (staging only, #1370): `crouton-seed` into the staging or PR-preview DB — the ONLY seed per deploy (#2366); `"seed": false` in `deploy.config.json` opts out.
8. Review login seeded (staging only, #608): deterministic `review+<app>-<key>@example.com` via `scripts/seed-review-login.mjs`; password derived from the required `REVIEW_SEED_SECRET`, reset on rotation (#2358). The one-click sign-in link is **emailed** to the owner (Resend), never posted.
9. Deployed smoke: `scripts/smoke-deployed.mjs` (login + CRUD + screenshot, artifact `smoke-<app>`). Report-only unless `smoke.required` in `deploy.config.json`.
10. Sticky PR comment (marker `<!-- deploy-staging:<app> -->`) with the staging URL and the review login's email — no password, no link (PR comments are public, #2358).

**Before proposing or adding a step here, grep `.github/workflows/` for the command it would run** (e.g. `crouton-seed`, `seed-review-login`, `smoke-deployed`) and extend the existing step instead of adding a second. #2366 built a duplicate seed step because the #1370 one wasn't checked first (#2378).

Concurrency: `deploy-<app>-<env>`, `cancel-in-progress: false` (a cancel mid-migration is unsafe).

### wrangler.jsonc anatomy (verified against `apps/velo/wrangler.jsonc`)

- **Workers, not Pages**: no `pages_build_output_dir`; `compatibility_flags: ["nodejs_compat"]`. `name`/`main`/`assets` injected at build by Nitro's `cloudflare_module` preset into `.output/server/wrangler.json`.
- **Two domains (#133)**: top-level `routes` → `<app>.friendlyinter.net` (prod, `custom_domain: true`); `env.staging.routes` → `<app>.pmcp.dev`.
- **Bindings do not inherit across envs**: `env.staging` redeclares D1 (`<app>-staging-db`) and blob/KV with separate ids. Velo binds R2 as `BLOB` (no KV); other apps may bind `KV`.
- **Id-less auto-provisioning**: wrangler auto-creates missing D1/KV on first deploy; each app's `scripts/sync-wrangler-ids.mjs` then writes the provisioned ids back into the source `wrangler.jsonc` (remote `d1 migrations apply` reads the SOURCE config and needs real ids). Rule: commit the synced ids.
- **The nitro#3429 env-stripping workaround**: the build drops named environments from the generated config, so each app's `scripts/inject-wrangler-env.mjs` re-merges the `env` block. Velo's `cf:staging` runs inject **twice** — before deploy and again before migrate (sync:ids rewrites files in between).

Velo's exact scripts (verified in `apps/velo/package.json`):

```bash
# cf:deploy (prod)
NITRO_PRESET=cloudflare_module nuxt build && npx wrangler --cwd .output deploy \
  && node scripts/sync-wrangler-ids.mjs && npx wrangler d1 migrations apply velo-db --remote
# cf:staging
NITRO_PRESET=cloudflare_module nuxt build && node scripts/inject-wrangler-env.mjs \
  && npx wrangler deploy --config .output/server/wrangler.json --env staging \
  && node scripts/sync-wrangler-ids.mjs && node scripts/inject-wrangler-env.mjs \
  && npx wrangler d1 migrations apply velo-staging-db --env staging --remote
```

The demo seed is **not** in the app script: `deploy-app.yml`'s *Seed collection + demo data* (#1370) step runs
`crouton-seed` for every app after the deploy (staging + PR previews; opt out with
`"seed": false` in `deploy.config.json`; production never seeds) — #2366.

### Migrations in CI + the #138 rule

Flow: build → deploy → sync ids → `wrangler d1 migrations apply <db-name> [--env staging] --remote`. `migrations_dir: server/db/migrations/sqlite` is declared per-binding in `wrangler.jsonc`. **The #138 rule**: the `wrangler deploy` step may use `--config .output/server/wrangler.json`, but the `d1 migrations apply` step must NOT pass `--config .output/...` — it doubles the migrations path ("no migrations" symptom) and must read the source `wrangler.jsonc` (which is why sync:ids has to run first). Canonical wording lives only in root CLAUDE.md ("The pattern, end to end"); the `deploy` skill doesn't restate it. Local/"No schema files found" migration gotchas belong to the `db-migrations` skill.

## 3. Secrets / tokens / vars

### Actions secrets (repo level unless noted)

| Secret | Used by | Notes |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | all agent workflows | Auth is the Claude subscription (owner decision 2026-10-29, #3121); don't switch to an API key without an owner decision |
| `HARNESS_APP_ID` + `HARNESS_APP_PRIVATE_KEY` | many workflows (grep for it) | The "Nuxt Harness" GitHub App — see the cascade rule below |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | deploy/db workflows | Token scopes: account Workers Scripts/D1/KV/R2 Edit + zone Workers Routes + DNS Edit (details: `deploy` skill, Credentials) |
| `WORKER_SECRETS_JSON` | `deploy-app.yml` | Optional bundle of Worker secrets — **see the trap below** |
| `RESEND_API_KEY` | digests, red-team email | Email rail; steps skip green when unset |
| `REVIEW_SEED_SECRET` | deploy-app.yml | **Required** salt for review-login passwords — unset → no review login, pre-prod gate refuses (#2358) |
| `PI_PROVIDER_KEY` | pi.dev variants | pi's model-provider key; required by `decompose-on-issue-pidev.yml` (live via the `work-this` router / bot-applied `delegate*`, #3208). Funding state not verifiable from the repo — if a pi run errors at the agent step, check this key's credit first |

### The WORKER_SECRETS_JSON trap (fixed under [#1094](https://github.com/FriendlyInternet/nuxt-crouton/issues/1094))

`WORKER_SECRETS_JSON` **MUST be a *repository-level* Actions secret, NOT an *Environment* secret** — the deploy job is reached via `secrets: inherit` from callers whose jobs declare no `environment:`, so Environment-scoped secrets resolve to EMPTY with no error. Symptom of getting this wrong: deploys go green but Worker secrets never update, silently — unless the app sets `"secrets": { "required": true }` in `deploy.config.json`, which makes an empty resolution fail the run (guard added in #1094; the workflow also rejects a set-but-invalid/empty-object bundle).

### Actions vars

`AGENT_RUNNER` (only the pi.dev workers: work-issue-pidev, decompose-on-issue-pidev; set to `ubuntu-latest` since #2275 — no self-hosted runner exists, so any other value queues forever) · `HOSTED_RUNNER` (everything else that was on the mac-mini — deploys and the claude-code-action reviews, which run on the subscription via `CLAUDE_CODE_OAUTH_TOKEN` on any machine; default ubuntu-latest, #2275) · `AGENT_HARNESS` (`pi` opt-in) · `CLEANUP_BRANCHES_APPLY` · `LABEL_READY_EPICS_APPLY` (write-gates for otherwise dry-run jobs) · `DIGEST_REPORT_EMAIL` / `RESEND_FROM` / `RED_TEAM_REPORT_EMAIL` (email rails) · `PROJECT_NAME`.

### Three auth rules every agent workflow obeys

1. **The token-cascade rule** (the single most repeated fact across these files): GitHub suppresses workflow triggers for events initiated by the built-in `GITHUB_TOKEN`. Any mutation that must trigger a downstream workflow (apply `delegate` → decompose fires; merge → schedule-waves; close → strip-status; push → CI re-runs) is done with a **Harness App installation token**. Read-only or chain-terminal steps deliberately use `GITHUB_TOKEN`.
2. **The ruleset-bypass rule** (#1133): the `main` ruleset requires a PR, so **any workflow that pushes directly to `main` must push with the Harness App token** — the App is on the ruleset's bypass list, and `GITHUB_TOKEN` cannot be. GitHub Actions is not an installable App in the org, so adding it as a bypass actor is rejected outright (`422 — Actor GitHub Actions integration must be part of the ruleset source or owner organization`). The direct-to-`main` writers are `loop-station-inventory` · `loop-station-usage` · `loop-station-findings` · `bundle-budget`; all four commit with `[skip ci]`, which is what stops the App-token push (unlike a `GITHUB_TOKEN` push) from re-triggering the very workflow that made it.
3. **Job-level permissions only**: job-level `permissions` fully OVERRIDES (does not merge with) a workflow-level block, so `id-token: write` must sit on the job or the claude-code-action OIDC request fails. Stated verbatim in several workflows (e.g. `resume-on-comment.yml`).

Also: `anthropics/claude-code-action` is pinned to one SHA across several workflows with "keep in sync when bumping" — a manual multi-file sync liability; grep for the pin and check all of them when bumping (re-verify block).

## 4. Scheduled things — the REAL cadence

Do not trust "daily" labels; the truth is `on.schedule` + `.github/digests.yml`. **Snapshot 2026-07-02 — regenerate with the cron grep in the re-verify block before relying on it.**

| Workflow | Cron in file | Real cadence |
|---|---|---|
| `e2e.yml` | `0 4 * * *` | Nightly full-matrix backstop — genuinely daily |
| `epic-digest.yml` | `0 5 * * *` | Daily wake-up; real send day from `digests.yml` via `schedule.mjs` (retrofit #1139) |
| `label-ready-epics.yml` | `0 5 * * *` | Daily (labels only when `vars.LABEL_READY_EPICS_APPLY` allows) |
| `skills-digest.yml` | `0 5 1 * *` | **Monthly (1st)** — cron fires on the 1st; `.github/digests.yml` `monthly:1` is a second guard |
| `housekeeping.yml` | `0 6 * * *` | Daily per digests.yml (`schedule: daily`) |
| `sync-changelogs.yml` | `0 6 * * *` | Daily |
| `weekly.yml` | `30 6 * * 1` | Weekly Mon — ordered jobs: `usage` → `findings` → `advisor`; `cleanup` (dry-run by default) alongside |

**Cadence-as-data rule**: for the digests, never edit a workflow's `cron` to change cadence — edit `.github/digests.yml` (the daily cron is a cheap wake-up; `.claude/skills/housekeeping/schedule.mjs` exits early on non-send days).

## 5. The agent-pipeline chain

How one `delegate` label becomes merged code (entry/steps verified in the named workflows; full theory in `.claude/agents/CLAUDE.md`):

1. **Entry** — `decompose-on-issue-pidev.yml` is reached by a human `work-this` label (router → dispatch, #3208); `delegate*` labels are bot-only. Mobile entry: comment `/delegate` → `comment-dispatch.yml` (OWNER/MEMBER/COLLABORATOR only) removes+re-adds the label **with the App token** so the labeled event actually triggers downstream. `claude.yml` separately answers `@claude` mentions on issues/PRs.
2. **Artifact gates** (#461/#603) — deterministic post-steps fail the run if the agent produced nothing observable (comment / PR / sub-issues / `status:blocked` hold); #661 classifies WHY from the execution log.
3. **Sign-off resume** — `resume-on-comment.yml`: any human (non-Bot) comment on an issue labelled `status:blocked` resumes the pipeline; if the comment matches `\b(approve|approved|lgtm)\b` a deterministic step finds the linked draft gate-PR, marks it ready (GraphQL), and merges it — merge commit, never squash (#572). This is why reactions and labels resume nothing.
4. **Auto-merge** — `automerge-epic-subpr.yml`: non-draft bot PRs targeting `epic/*` merge when green; any sub-PR touching `packages/` is held with `status:blocked` — shared code never lands unreviewed even onto an epic branch (#586/#339). Two distinct gates, and the difference matters: the **green gate** blocks a RED check, while the **presence gate** (#1698) additionally requires that `CI Gate` has *reported* `success` for the head SHA. Absence of failure is not evidence of success — on #1668 `CI` never started, so nothing was red and an unchecked build break merged. A **missing** `CI Gate` now leaves the PR open with a one-time explanatory comment (push an empty commit to fire `synchronize`); a **pending** one waits for the `check_suite` re-fire. The `main` ruleset can't cover this path — it only targets the default branch.
5. **Baton pass** — `schedule-waves.yml` (#283): on PR merge, closes its `Closes #NN` issues (auto-close only works on the default branch); on issue close, releases dependents whose `Blocked-by: #NN` body lines are ALL closed by applying `delegate` (fan-in aware).
6. **Fix-bot** — `fix-ci-on-failure.yml` (#338): `workflow_run` failure of CI/E2E on `work-*` branches only; attempt cap via `ci-fix-attempts:N` label (max 3); forbidden from `packages/`; pushes with the App token so CI re-runs; exhaustion → `status:blocked` + owner mention.
7. **Status & close** — `status.yml` `pr-comment` job (no-LLM sticky comments per PR + epic rollup); `label-ready-epics.yml` marks finished epics; `close-epic-on-comment.yml` (#856) closes on a human `/close-epic` comment only when the epic already carries `status:ready-to-close` (postmortem-before-close holds structurally; server-side re-checks + maintainer permission check).

### Gate-honesty hardening state

The three per-PR review gates shipped **fail-open** (missing tool grant meant the agent could never write its verdict file; outage was indistinguishable from a clean scan — #1034). Grants fixed in #1031/#1033 (per the workflow comments the fail-open comment lines remain as warnings); #1035 added a known-bad fixture smoke per gate. Follow-ups: [#1036](https://github.com/FriendlyInternet/nuxt-crouton/issues/1036) (bake the tool grant into the workflow standard) and [#1037](https://github.com/FriendlyInternet/nuxt-crouton/issues/1037) (distinguish agent-outage from clean scan) — issue state is live data, check GitHub before relying on it. Since #3070 the four review.yml gates fail closed: a reviewer that did not run is a red check with a PR comment, not a green one. (This paragraph is the owner of the #1034-hardening status; siblings citing it should defer here.)

Also volatile: `.claude/routing.json` `_known_gaps` states the top-level workflow loop (fix-ci, the weekly sweeps) runs on the claude-code-action **default model, unpinned** — pinning is an acknowledged follow-up.

## 6. Known doc drift in this area

Workflow files beat all prose for CI/deploy mechanics (the doc-vs-doc trust order is owned by `crouton-docs-trust-map` §1). The known-stale claims are tracked — read the issue for current fix state:

- ~~Per-app `deploy-<app>.yml` callers~~ / ~~`WORKER_SECRETS_JSON` as an Environment secret~~ — both fixed ([#1093](https://github.com/FriendlyInternet/nuxt-crouton/issues/1093), [#1094](https://github.com/FriendlyInternet/nuxt-crouton/issues/1094)): CLAUDE.md + the `deploy` skill now describe `deploy-apps.yml` + `deploy.config.json` and the repo-level secret (§2, §3)
- Folk knowledge: the `ui-approved` label resumes nothing — inert by design; only a reply comment resumes (#572)

When this skill and a workflow file disagree, the workflow file wins — then fix this skill.

## Provenance and maintenance

verified: 2026-07-03

```bash
ls .github/workflows | wc -l                                     # inventory size
grep -rn "cron:" .github/workflows/*.yml                         # real schedules (cross-check .github/digests.yml gating)
ls apps/*/deploy.config.json pocs/*/deploy.config.json           # opted-in apps
grep -n "repository-level" .github/workflows/deploy-app.yml      # the WORKER_SECRETS_JSON rule (#1094)
grep -rln "HARNESS_APP_ID" .github/workflows                     # App-token workflow set
grep -rn "claude-code-action@" .github/workflows/*.yml           # the SHA-pin sync set
grep -n "_known_gaps" .claude/routing.json                       # unpinned-model note
for n in 1093 1094 1097 1036 1037; do gh issue view $n --json number,state -q '"\(.number) \(.state)"'; done  # tracked-drift + gate-honesty states
```

## NuxtHub's role + deploy anatomy (moved from root CLAUDE.md, #3350)

**NuxtHub here is ONLY the storage abstraction, NOT the deploy tool.** `hub: { db: 'sqlite', kv?, blob? }` maps to Cloudflare **D1 / KV / R2** at runtime. We do **NOT** use `npx nuxthub deploy` or the NuxtHub Admin/managed cloud — do not suggest it.

**Apps deploy to Cloudflare WORKERS (static assets) with auto-provisioning** — the crouton standard (#108/#114; *not* Pages — ignore older docs/commits that say Pages). Wrangler auto-creates the app's D1 + KV on the first deploy (no manual resource/project creation, no id-juggling). Canonical examples: **`apps/velo`**, **`apps/kassa`** (their `wrangler.jsonc` is generated by the **`/deploy` skill** — copy that pattern, don't invent one).

**Two-domain topology (#133):** production → **`<app>.friendlyinter.net`**, staging → **`<app>.pmcp.dev`** (separate registrable domains = bulletproof session/cookie isolation). The deploy env is named **`staging`** (not `preview`).

**🟦 STANDING RULE — deploy to STAGING, never production (#318).** The default deploy target is **always staging**: agents, skills, and routine work deploy to staging only (`/deploy` skill / `cf:staging` / **merge to `main`**). **NEVER deploy to production** except via the dedicated **`/deploy-production`** skill, invoked on an **explicit human request** to ship to prod. Production stays a deliberate, manual `workflow_dispatch` (env=production) — never a side effect of an agent flow.

**🟦 STANDING RULE — the owner tests on MOBILE, on the go: the deliverable is a deployed STAGING URL, not a local run.** Maarten reviews from his phone and **cannot run the app locally** — so for any UI-touching or human-testable change, "how do you test this" is answered by a **live staging URL + review creds**, never "run `pnpm dev`". Local dev (+ the pre-installed chromium) is for the **agent's own** verification before shipping; it is **not** a test path you hand the owner. So the last step of such work is: **proactively deploy to staging and hand back the clickable URL** — don't offer local as an option, and don't wait to be asked to deploy. Targets: a `pocs/*` app → dispatch **`deploy-pocs.yml`** (`workflow_dispatch` checks out the branch you run it FROM, so dispatch it on the feature branch — the PR head need not match) with `app:<name>` (+ `review_pr:<n>` to comment the URL on the PR); a launched `apps/*` app → `/deploy` skill / `cf:staging` / merge to `main`. Staging seeds on deploy, so the live app has data. Getting in: every staging deploy creates a per-app review login and **emails the owner a one-click sign-in link** (#2358) — never put a username/password in docs, config or comments; this repo is public (#2356). (Sign-off gates that need a *device* walk — e.g. touch-gesture `status:new` spec entries — are gated on this staging URL, not a local screenshot.)

**Trunk = staging (#347):** a **merge to `main`** that touches an app's paths auto-deploys its **staging** env (`<app>.pmcp.dev`) — landing code previews itself. The old separate `staging` branch is retired. This can't ever reach production: a `push` event never sets `environment=production` (that input is gated on `workflow_dispatch`), so #318 holds structurally, not just by convention.

**The check ladder (#632)** — which checks gate at which rung of PR → staging → prod. The right check at the right rung: PRs stay fast, prod stays safe. Full panel (exact workflows, path filters, gaps): `writeups/architecture/deployment-topology.html`.

- **Rung 1 — the PR (blocking, cheap+fast):** `ci` (lint + typecheck), `e2e` (fixture smoke, smart-selected), `red-team` (server/app surfaces), `frontend-review` + `a11y` (`.vue`-touching PRs), staging preview deploy + deployed smoke (`scripts/smoke-deployed.mjs`, report-only unless the app sets `smoke.required`). This rung **is** the #336/#339 auto-merge green gate — "green PR" and "safe to land on trunk" mean the same thing. Two of these are **required** by the `main` ruleset for any merge, human or bot: `CI Gate` (#1133) and `E2E Gate` (#2334); both always report, skipping their heavy work on irrelevant PRs instead of not running.
- **Rung 2 — merge→`main`, on the deployed `*.pmcp.dev` (integration):** path-filtered staging deploy with remote D1 migrations, deployed smoke against the live URL — **gating by default on push-to-main** (#1106; opt out per app with `smoke.gateOnMain: false`), so a red post-merge deploy always reaches `report-failed-deploy.yml`, which opens an issue. Nightly full-matrix e2e backstop.
- **Rung 3 — before prod (confidence gate):** production is a deliberate manual `workflow_dispatch` only (#318), via the `/deploy-production` skill. CI enforces the pre-flight (#1107): the dispatch smokes the app's **live staging URL** first and refuses to deploy prod while it's red (emergency escape hatch: `skip_staging_smoke=true`, loud warning).

The pattern, end to end:
- **`wrangler.jsonc`** (Workers): **no** `pages_build_output_dir`; `compatibility_flags: ["nodejs_compat"]`; bindings `DB` (D1), `KV`/`BLOB` (R2) as needed — **id-less** so the first deploy auto-provisions them; plus an **`env.staging`** block with **separate** staging ids + a `<app>.pmcp.dev` custom-domain `route` (bindings do NOT inherit across envs). `name`/`main`/`assets` are injected by the preset at build.
- **Build preset**: `NITRO_PRESET=cloudflare_module nuxt build` → output in `.output/`.
- **Scripts**: `cf:deploy` (prod: build → `wrangler deploy` auto-provision → `sync:ids` → migrate `--remote`), `cf:staging` (build → `inject-wrangler-env` → `wrangler deploy --env staging` → `sync:ids` → migrate), `sync:ids` (writes provisioned ids back into `wrangler.jsonc`), `db:migrate*`. NB: the staging migrate step must **not** pass `--config .output/...` (doubles the path → "no migrations"; #138).
- **CI** (`.github/workflows/deploy-apps.yml` — ONE generic workflow for all apps, #481/#638; the old per-app `deploy-<app>.yml` callers are retired): an app opts in with a `deploy.config.json` (`stagingUrl` / `productionUrl` / `layerPackages`); the `detect` job derives each app's watch paths from its `package.json` (app dir + lockfile + every `@fyit/*` dep, transitively — #2397, no hand-written `watchPaths` list) and fans out one reusable **`deploy-app.yml`** call per affected app. Merge to `main` / PR (path-filtered) → staging; manual `workflow_dispatch` env=production → prod (#347). Auth via **repo-level** secrets `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (the token needs **account** Workers Scripts/D1/KV/R2 Edit **and** **zone** Workers Routes + DNS Edit for custom-domain binding).
- **First-time setup / migrating a Pages app**: run the **`/deploy` skill** — don't hand-roll it. Worker secrets do NOT transfer from Pages — re-set them (`wrangler secret bulk … --env staging`), pointing `BETTER_AUTH_URL` at the deployed URL.

**Local-only testing** needs no Cloudflare: `pnpm dev` with `hub: { db: 'sqlite' }`. For a quick public URL without a full deploy, a Cloudflare Tunnel over `pnpm dev` works; a stable URL means `cf:staging` / the `/deploy` skill.
