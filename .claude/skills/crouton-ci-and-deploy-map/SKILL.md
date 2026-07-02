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
| `ci.yml` | push/PR, paths `packages/**, apps/**, scripts/**`, lockfile | Jobs: `lint-and-typecheck` (**MCP server only — a misnomer**, tracked [#1097](https://github.com/FriendlyInternet/nuxt-crouton/issues/1097); see §6), `build-fanfare` (matrix of 2 Nitro presets; "the build is the smoke test", fanfare typecheck deliberately ungated), `docs-check`, `sync-validation`, `mcp-server-tests`, `test` (`pnpm test` after building core dists), `changeset-check` (warn-only), `package-check` (publint + attw) |
| `e2e.yml` | push/PR (paths `packages/**, fixtures/**, e2e/**`, lockfile) + nightly cron full matrix + dispatch | Playwright fixture smoke. Smart selection (#622): PRs run only fixtures affected per each fixture's `e2e.manifest.json`; push-to-main/nightly run all. Regenerates fixtures with the current CLI, so a generator regression = red PR (#197) |
| `guard-package-approval.yml` | PR to main | Fails the PR if `.claude/.package-edit-approved` is committed (would disable the packages/ HARD GATE, #350). Epic-scoped approval uses the `CROUTON_PACKAGE_EDIT_APPROVED` env var instead |
| `skills-doc.yml` | push/PR touching `.claude/skills/**` | `writeups/architecture/skills-and-triggers.html` must be regenerated (`node scripts/gen-skills-doc.mjs`) |
| `routing-registry.yml` | push/PR touching `.claude/routing.json`, `.claude/agents/**` | Model-routing registry drift check (#864) |

### LLM review gates (per-PR, agent-run)

All three share one pattern: a claude-code-action run writes a `<name>-verdict.json` at repo root + a sticky PR comment; a deterministic step then fails the check on the worst severities. Missing verdict file = **inconclusive pass** (fail-open by design; see §5 honesty hardening).

| Workflow | Fires on PRs touching | Fails check on |
|---|---|---|
| `red-team.yml` | `**/server/**`, `**/app/**`, `**/nuxt.config.ts`, plus all of `packages/**`, `apps/**`, `pocs/**` — i.e. effectively every code PR (skips docs/config-only PRs; drafts and bot-authored PRs are skipped by the job `if`) | high/critical security finding |
| `a11y.yml` | `**/*.vue` | axe critical/serious |
| `frontend-review.yml` | `**/*.vue` | 🔴 critical (e.g. Nuxt UI v3 component names) |

### Deploys

| Workflow | Trigger | Role |
|---|---|---|
| `deploy-app.yml` | `workflow_call` only | THE reusable pipeline (#114) — see §2 |
| `deploy-apps.yml` | push to main + PR (paths `apps/**, packages/**`, lockfile) + `workflow_dispatch(app, environment, review_pr)` | **The one generic caller for every `apps/*` app** (epic #481 WS2). An app opts in by committing `apps/<name>/deploy.config.json`. Replaced the per-app `deploy-<app>.yml` callers |
| `deploy-pocs.yml` | PR touching `pocs/**` + dispatch(app, mode) | POC staging previews; `mode: version` = immutable Workers-version preview URL. Steps: `poc-deploy` skill |
| `deploy-docs.yml` | push to main (`docs/**`) / PR build-smoke / dispatch | Docs site — self-contained, NOT via deploy-app.yml |
| `deploy-sandbox.yml` | dispatch | Manual `sandboxes/*` deploy |
| `report-failed-deploy.yml` | `workflow_run[completed]` of the deploy workflows | On failure on `main`, opens exactly one issue per failing run (idempotency marker, #340). Note: its watch list still names "Deploy Blog (POC preview)", a workflow that no longer exists — harmless dangling reference |

### Agent pipeline (see §5 for the chain)

`claude.yml` (@claude mention) · `decompose-on-issue.yml` (`delegate` label) · `comment-dispatch.yml` (`/delegate` comment) · `resume-on-comment.yml` (reply on `status:blocked`) · `close-epic-on-comment.yml` (`/close-epic`) · `schedule-waves.yml` (baton pass) · `automerge-epic-subpr.yml` · `fix-ci-on-failure.yml` · `pipeline-pr-status.yml` · plus the pi.dev variants: `decompose-on-issue-pidev.yml` (**LIVE** — promoted past dispatch-only in #1017: fires when a human applies the `delegate-pi` label, plus manual dispatch; default model tuned in #1019; has run for real under `delegate-pi`) and `a11y-daily-pidev.yml` (still dispatch-only + `AGENT_HARNESS` gated); both need a funded `PI_PROVIDER_KEY` to complete. Also `mac-mini-smoke.yml` (self-hosted-runner proof, #610).

### Digests & scheduled reports (real cadence in §4)

`epic-digest.yml` · `housekeeping.yml` · `skills-digest.yml` · `eval-scoreboard.yml` · `label-ready-epics.yml` · `loop-station-advisor.yml` · `loop-station-inventory.yml` (push-triggered; **commits** to `writeups/loop-station/history.jsonl`) · `sync-changelogs.yml` · `unlighthouse.yml` (weekly staging crawl, never gates) · `red-team-daily.yml` / `a11y-daily.yml` (**dispatch-only**, see §4).

### Housekeeping / ops (event-driven or dispatch-only)

| Workflow | Trigger | Does |
|---|---|---|
| `labels.yml` | push touching `.github/labels.yml` | Syncs labels (`skip_delete: true` — never removes) |
| `strip-status-on-close.yml` | issue closed | Strips `status:*` labels (#641) |
| `cleanup-epic-branches.yml` | PR closed | Deletes `epic/*` head branch only when merged into main (#613) |
| `cleanup-merged-branches.yml` | weekly cron + dispatch | Dry-run unless `vars.CLEANUP_BRANCHES_APPLY=true` |
| `project-status.yml` / `backfill-project.yml` | PR/issue events / dispatch | Projects-v2 board automation |
| `db-clone.yml` | dispatch | D1 mirror between envs (`db-clone` skill) |
| `db-counts.yml` | dispatch | Read-only row counts of any app DB — the safe "what's in there" check (#384) |
| `teardown-app.yml` | dispatch | CF/branch/issue teardown (`remove-app` skill) — runs in CI because the interactive agent has no Cloudflare creds |

## 2. Deploy pipeline anatomy

### The caller pattern — deploy-apps.yml + deploy.config.json (NOT per-app callers)

**Older docs still describe per-app `deploy-<app>.yml` callers (root CLAUDE.md deploy section; `deploy` skill Step 4) — that's stale, tracked as [#1093](https://github.com/FriendlyInternet/nuxt-crouton/issues/1093).** Reality (epic #481): one generic `deploy-apps.yml` whose `detect` job matrixes over every `apps/<name>/deploy.config.json` whose `watchPaths` match the changed files. Rationale (from the workflow header): the agent pipeline's App token lacks the `workflows` scope, so bots cannot push `.github/workflows/` files — but they CAN push `apps/<name>/deploy.config.json`. Trust the workflow files.

`deploy.config.json` exists for the launched apps plus several pocs — list them fresh (`ls apps/*/deploy.config.json pocs/*/deploy.config.json`). Velo's fields (the shape): `stagingUrl`, `productionUrl`, `layerPackages` (space-separated `@fyit/*` list), `watchPaths` (app dir + each extended package + lockfile). Optional: `"smoke": { "required": true }` makes the post-deploy smoke gate the run (default is report-only; velo doesn't set it).

**Prod gating is structural, not conventional:** `deploy-apps.yml` hard-codes `environment=staging` for `push`/`pull_request` events; only `workflow_dispatch` with the explicit `production` choice produces a production matrix entry (#318/#347). Also note: **a PR deploys to the SAME staging Worker/DB as merge-to-main** — a PR preview overwrites `<app>.pmcp.dev`. Isolated previews exist only for POCs via `deploy-pocs.yml` `mode: version`.

### Inside deploy-app.yml (the reusable pipeline)

Inputs: `app`, `workspace` (apps|pocs), `environment`, `staging-url`/`production-url`, `layer-packages`, `review-pr`. Key steps, in order (all verified in the file):

1. `pnpm install --frozen-lockfile --ignore-scripts` → `pnpm rebuild better-sqlite3 || true`.
2. Layer-dist cache keyed on **build-set hash + `hashFiles('packages/**/*.ts')`** (the #745 cross-app cache-collision fix). `@fyit/crouton-devtools` is always appended to the layer set.
3. `nuxt prepare`, then **the one real step**: it runs the app's own `pnpm run cf:deploy` (prod) or `cf:staging` — the source of truth is the app's `package.json`, so CI and a dev's laptop run the identical script.
4. Optional `wrangler secret bulk` from `WORKER_SECRETS_JSON` (see §3 trap).
5. Preview-review bridge (#607): staging + PR-tied only — pushes `NUXT_CROUTON_REVIEW_*` Worker secrets so in-page overlay comments post to the PR as `nuxt-harness[bot]`.
6. `BETTER_AUTH_SECRET` auto-generated (`openssl rand -hex 32`) if the Worker has none; never rotates an existing one; skips (with `::warning::`) if `wrangler secret list` fails.
7. Review login seeded (staging only, #608): deterministic `review+<app>-pr<N>@example.com` via `scripts/seed-review-login.mjs`.
8. Deployed smoke: `scripts/smoke-deployed.mjs` (login + CRUD + screenshot, artifact `smoke-<app>`). Report-only unless `smoke.required` in `deploy.config.json`.
9. Sticky PR comment (marker `<!-- deploy-staging:<app> -->`) with staging URL + test login.

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
  && npx wrangler d1 migrations apply velo-staging-db --env staging --remote \
  && (pnpm db:seed:staging || true)
```

### Migrations in CI + the #138 rule

Flow: build → deploy → sync ids → `wrangler d1 migrations apply <db-name> [--env staging] --remote`. `migrations_dir: server/db/migrations/sqlite` is declared per-binding in `wrangler.jsonc`. **The #138 rule**: the `wrangler deploy` step may use `--config .output/server/wrangler.json`, but the `d1 migrations apply` step must NOT pass `--config .output/...` — it doubles the migrations path ("no migrations" symptom) and must read the source `wrangler.jsonc` (which is why sync:ids has to run first). Canonical wording lives only in root CLAUDE.md ("The pattern, end to end"); the `deploy` skill doesn't restate it. Local/"No schema files found" migration gotchas belong to the `db-migrations` skill.

## 3. Secrets / tokens / vars

### Actions secrets (repo level unless noted)

| Secret | Used by | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | all agent workflows | Headless CI MUST use an API key, never a subscription `CLAUDE_CODE_OAUTH_TOKEN` (workflow comments cite Anthropic terms) |
| `HARNESS_APP_ID` + `HARNESS_APP_PRIVATE_KEY` | many workflows (grep for it) | The "Nuxt Harness" GitHub App — see the cascade rule below |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | deploy/db workflows | Token scopes: account Workers Scripts/D1/KV/R2 Edit + zone Workers Routes + DNS Edit (details: `deploy` skill, Credentials) |
| `WORKER_SECRETS_JSON` | `deploy-app.yml` | Optional bundle of Worker secrets — **see the trap below** |
| `RESEND_API_KEY` | digests, red-team email | Email rail; steps skip green when unset |
| `REVIEW_SEED_SECRET` | deploy-app.yml | Optional salt for review-login passwords |
| `PI_PROVIDER_KEY` | pi.dev variants | pi's model-provider key; required by `decompose-on-issue-pidev.yml` (live on the `delegate-pi` label, #1017) and `a11y-daily-pidev.yml` (dispatch-only). Funding state not verifiable from the repo — if a pi run errors at the agent step, check this key's credit first |

### The WORKER_SECRETS_JSON trap (deploy-app.yml contradicts itself — tracked: [#1094](https://github.com/FriendlyInternet/nuxt-crouton/issues/1094))

The file carries two contradictory comments: its header advice says store it as a GitHub *Environment* secret; the comment at the secrets step says it "**MUST be a *repository-level* Actions secret, NOT an *Environment* secret** — this job is reached via `secrets: inherit` from a caller whose job declares no `environment:`, so Environment-scoped secrets resolve to EMPTY and silently skip." **The secrets-step comment is the operative truth** (it describes the actual `deploy-apps.yml` call path). The `deploy` skill's Step 4.5 repeats the stale Environment-secret advice — don't follow it. Symptom of getting this wrong: deploys go green but Worker secrets never update, silently. Fix state: [#1094](https://github.com/FriendlyInternet/nuxt-crouton/issues/1094).

### Actions vars

`AGENT_RUNNER` (swap agent jobs to the self-hosted mac-mini; default ubuntu-latest) · `AGENT_HARNESS` (`pi` opt-in) · `CLEANUP_BRANCHES_APPLY` · `LABEL_READY_EPICS_APPLY` (write-gates for otherwise dry-run jobs) · `DIGEST_REPORT_EMAIL` / `DIGEST_EMAIL_FROM` / `RESEND_FROM` / `RED_TEAM_REPORT_EMAIL` (email rails) · `PROJECT_NAME` · `UNLIGHTHOUSE_SITE`.

### Two auth rules every agent workflow obeys

1. **The token-cascade rule** (the single most repeated fact across these files): GitHub suppresses workflow triggers for events initiated by the built-in `GITHUB_TOKEN`. Any mutation that must trigger a downstream workflow (apply `delegate` → decompose fires; merge → schedule-waves; close → strip-status; push → CI re-runs) is done with a **Harness App installation token**. Read-only or chain-terminal steps deliberately use `GITHUB_TOKEN`.
2. **Job-level permissions only**: job-level `permissions` fully OVERRIDES (does not merge with) a workflow-level block, so `id-token: write` must sit on the job or the claude-code-action OIDC request fails. Stated verbatim in several workflows (e.g. `resume-on-comment.yml`).

Also: `anthropics/claude-code-action` is pinned to one SHA across several workflows with "keep in sync when bumping" — a manual multi-file sync liability; grep for the pin and check all of them when bumping (re-verify block).

## 4. Scheduled things — the REAL cadence

Do not trust "daily" labels; the truth is `on.schedule` + `.github/digests.yml`. **Snapshot 2026-07-02 — regenerate with the cron grep in the re-verify block before relying on it.**

| Workflow | Cron in file | Real cadence |
|---|---|---|
| `e2e.yml` | `0 4 * * *` | Nightly full-matrix backstop — genuinely daily |
| `epic-digest.yml` | `0 5 * * *` | Daily (hard-codes its own cron; retrofit onto digests.yml is open follow-up #637) |
| `label-ready-epics.yml` | `0 5 * * *` | Daily (labels only when `vars.LABEL_READY_EPICS_APPLY` allows) |
| `skills-digest.yml` | `0 5 * * *` | **Monthly (1st)** — cron is only a wake-up; `.github/digests.yml` `monthly:1` gates the send |
| `housekeeping.yml` | `0 6 * * *` | Daily per digests.yml (`schedule: daily`) |
| `sync-changelogs.yml` | `0 6 * * *` | Daily |
| `cleanup-merged-branches.yml` | `30 6 * * 1` | Weekly Mon (dry-run by default) |
| `eval-scoreboard.yml` | `0 7 * * *` | **Weekly Mon** per digests.yml (`weekly:mon`) |
| `loop-station-advisor.yml` | `23 7 * * 1` | Weekly Mon |
| `unlighthouse.yml` | `23 7 * * 1` | Weekly Mon |
| `red-team-daily.yml`, `a11y-daily.yml` | **none — `workflow_dispatch` only** | Daily schedules dropped to cut cost (#823). Root CLAUDE.md still calls the red-team sweep a live "daily deep sweep" — stale, tracked [#1097](https://github.com/FriendlyInternet/nuxt-crouton/issues/1097). Coverage now relies on the per-PR gates |

**Cadence-as-data rule**: for the digests, never edit a workflow's `cron` to change cadence — edit `.github/digests.yml` (the daily cron is a cheap wake-up; `.claude/skills/housekeeping/schedule.mjs` exits early on non-send days).

## 5. The agent-pipeline chain

How one `delegate` label becomes merged code (entry/steps verified in the named workflows; full theory in `.claude/agents/CLAUDE.md`):

1. **Entry** — `decompose-on-issue.yml` fires only on `issues: [opened, labeled]` with `label.name == 'delegate'` (gating on the specific label avoids re-fires when workers add other labels, #535). Runs claude-code-action with `/task-decompose #NN`. The pi.dev twin `decompose-on-issue-pidev.yml` fires the same way on the `delegate-pi` label (#1017). Mobile entry: comment `/delegate` → `comment-dispatch.yml` (OWNER/MEMBER/COLLABORATOR only) removes+re-adds the label **with the App token** so the labeled event actually triggers downstream. `claude.yml` separately answers `@claude` mentions on issues/PRs.
2. **Artifact gates** (#461/#603) — deterministic post-steps fail the run if the agent produced nothing observable (comment / PR / sub-issues / `status:blocked` hold); #661 classifies WHY from the execution log.
3. **Sign-off resume** — `resume-on-comment.yml`: any human (non-Bot) comment on an issue labelled `status:blocked` resumes the pipeline; if the comment matches `\b(approve|approved|lgtm)\b` a deterministic step finds the linked draft gate-PR, marks it ready (GraphQL), and merges it — merge commit, never squash (#572). This is why reactions and labels resume nothing.
4. **Auto-merge** — `automerge-epic-subpr.yml`: non-draft bot PRs targeting `epic/*` merge when green; any sub-PR touching `packages/` is held with `status:blocked` — shared code never lands unreviewed even onto an epic branch (#586/#339).
5. **Baton pass** — `schedule-waves.yml` (#283): on PR merge, closes its `Closes #NN` issues (auto-close only works on the default branch); on issue close, releases dependents whose `Blocked-by: #NN` body lines are ALL closed by applying `delegate` (fan-in aware).
6. **Fix-bot** — `fix-ci-on-failure.yml` (#338): `workflow_run` failure of CI/E2E on `claude/issue-*` branches only; attempt cap via `ci-fix-attempts:N` label (max 3); forbidden from `packages/`; pushes with the App token so CI re-runs; exhaustion → `status:blocked` + owner mention.
7. **Status & close** — `pipeline-pr-status.yml` (no-LLM sticky comments per PR + epic rollup); `label-ready-epics.yml` marks finished epics; `close-epic-on-comment.yml` (#856) closes on a human `/close-epic` comment only when the epic already carries `status:ready-to-close` (postmortem-before-close holds structurally; server-side re-checks + maintainer permission check).

### Gate-honesty hardening state

The three per-PR review gates shipped **fail-open** (missing tool grant meant the agent could never write its verdict file; outage was indistinguishable from a clean scan — #1034). Grants fixed in #1031/#1033 (per the workflow comments the fail-open comment lines remain as warnings); #1035 added a known-bad fixture smoke per gate. Follow-ups: [#1036](https://github.com/FriendlyInternet/nuxt-crouton/issues/1036) (bake the tool grant into the workflow standard) and [#1037](https://github.com/FriendlyInternet/nuxt-crouton/issues/1037) (distinguish agent-outage from clean scan) — issue state is live data, check GitHub before relying on it. Practical consequence until #1037 lands: **a green review-gate check can still mean "the agent never ran"** — on a security-sensitive PR, open the check and confirm the verdict comment exists. (This paragraph is the owner of the #1034-hardening status; siblings citing it should defer here.)

Also volatile: `.claude/routing.json` `_known_gaps` states the top-level workflow loop (claude.yml, decompose, fix-ci, the sweeps) runs on the claude-code-action **default model, unpinned** — pinning is an acknowledged follow-up.

## 6. Known doc drift in this area

Workflow files beat all prose for CI/deploy mechanics (the doc-vs-doc trust order is owned by `crouton-docs-trust-map` §1). The known-stale claims are tracked — read the issue for current fix state:

- **Per-app `deploy-<app>.yml` callers** (root CLAUDE.md deploy section; `deploy` skill Step 4) — reality is the generic `deploy-apps.yml` + `deploy.config.json` (§2) → [#1093](https://github.com/FriendlyInternet/nuxt-crouton/issues/1093)
- **`WORKER_SECRETS_JSON` as an Environment secret** (deploy-app.yml header; `deploy` skill Step 4.5) — must be repo-level (§3) → [#1094](https://github.com/FriendlyInternet/nuxt-crouton/issues/1094)
- **"Daily deep sweep" red-team/a11y still live** (root CLAUDE.md) — dispatch-only since #823 (§4); and **"EVERY change requires pnpm typecheck" implies CI enforces it** — `ci.yml`'s misnamed `lint-and-typecheck` job typechecks only the MCP server; app typecheck in CI happens only via the e2e fixture-regeneration gate. Local `pnpm typecheck` remains the standing rule — CI just doesn't back it → both tracked under [#1097](https://github.com/FriendlyInternet/nuxt-crouton/issues/1097)
- `report-failed-deploy.yml` watches "Deploy Blog (POC preview)", a workflow that no longer exists — harmless dangling reference (untracked)
- Folk knowledge: the `ui-approved` label resumes nothing — inert by design; only a reply comment resumes (#572)

When this skill and a workflow file disagree, the workflow file wins — then fix this skill.

## Provenance and maintenance

verified: 2026-07-02

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
