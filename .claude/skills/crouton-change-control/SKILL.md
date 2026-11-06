---
name: crouton-change-control
layer: stack
description: The router for how a change legally happens in this repo — which sign-off gate fires for which kind of change, what counts as approval, how the packages-edit guard works, and how work is allowed to reach main. Use when starting ANY change and unsure which rules apply, when an Edit to packages/* gets BLOCKED, when a pipeline issue sits on status:blocked and you need to know what unblocks it, or when asked "do I need sign-off for this", "how do I get this merged", "can I deploy this", "who approves X", "why won't my approval label/reaction do anything".
---

# Crouton Change Control — the router

One-line purpose: given "I want to change X", tell you which gates fire, which skill runs them, what approval looks like, and the legal path to `main` — **an index with rationale, never the mechanics** (those live in `AGENTS.md`, root `CLAUDE.md`, and the gate skills cited below).

## When to use / when NOT to use

| Situation | Go to |
|---|---|
| "Which rules apply to this change?" · blocked edit · stuck `status:blocked` · "how does this reach main?" | **this skill** |
| Actually running a gate | `schema-review`, `ui-proposal`, `test-review`, `review` skills |
| Issue/epic/label mechanics, epic walk-up | `github-tasks` skill |
| Commit mechanics | `commit` skill (`/commit`) |
| Workflow-file anatomy, secrets, deploy pipeline internals | sibling `crouton-ci-and-deploy-map` |
| The incident *stories* behind the rules | sibling `crouton-failure-archaeology` |
| "Is this error a known failure?" | sibling `crouton-diagnostics-index` |

Trust order where sources disagree: see sibling `crouton-docs-trust-map` §1. Two known self-contradictions are flagged in §3 and §4.

## 1. Decision table — "I want to change X"

**Step 0, always:** a tracking GitHub issue exists *before* code (ISSUE-FIRST, a HARD GATE — `AGENTS.md` "The loop"). Then resolve the stage — never guess from folder names:

```bash
node scripts/harness-stages.mjs <path>   # → stage, deploy target, gates(required/opt-in)
```

Verified 2026-07-02: `packages/*` → `stage: package, gates(required): test-first`; `apps/*` → `stage: app, gates(opt-in): test-first`; `pocs/*` → `stage: poc, no gates, deploy: preview`; anything else (e.g. `scripts/`) → `unstaged`.

| I want to change… | Stage / gate that fires | Skill that runs it | Approver |
|---|---|---|---|
| Hand-written **logic in `packages/*`** | edit guard (§3) + **test-first** required (#774) | `test-review` — agree the failing test before code | the human owner, by comment (§2) |
| A **collection schema** (`schemas/*.json`, `crouton config`, `generate_collection`) | **schema sign-off** (#314) | `schema-review` — field table before generating | same |
| A **visual surface** (`.vue`, `app/components\|layouts\|pages/**`, theme, app CSS) | **UI sign-off** (#307) | `ui-proposal` — live staging preview, or `--static` mockup | same |
| Code in **`apps/*`** (non-visual, non-schema) | test-first is **opt-in** only — note the opt-in *mechanism* is undefined (open #783) | — | normal PR flow |
| Anything in **`pocs/*`** | no required gates; preview deploys via `deploy-pocs.yml` | `poc-deploy` for the preview URL | none pre-merge |
| A **bug fix** anywhere | **archaeology-first** (#424) before the fix | `bug-archaeology` | finding recorded on the issue |
| A **new app** | goes in `pocs/`, not `apps/` (root `CLAUDE.md`) | `crouton` / `poc-deploy` | promotion to `apps/` = launch decision |
| A **deploy** | staging only, ever, by default (#318, §5) | `deploy` / merge to `main` | production: explicit human ask → `deploy-production` |
| **`.claude/skills/**`** | CI freshness check `skills-doc.yml` | run `node scripts/gen-skills-doc.mjs` (register in its `META`) | CI |
| **`.claude/routing.json` / agent models** | CI drift check `routing-registry.yml` | run `node scripts/gen-routing.mjs` | CI |
| A **`spec.json`** entry to `status: "settled"` | hook `gate-spec-signoff.mjs` blocks unless `signedOff` is recorded (#988/#992) | `spec` | recorded sign-off, not assertion |

`harness.config.mjs` also names `code-review` and `sec` in its gate vocabulary, but **no stage declares them required** — in practice per-PR CI review gates (`review.yml`) fire by changed-path instead (see `crouton-ci-and-deploy-map`).

## 2. Approval semantics (#572) — one loop for every gate

- **Hold state** = the `status:blocked` label on the issue. The gate PR (if any) is a **draft**.
- **The ONLY resume signal is a reply comment** whose body matches `/\b(approve|approved|lgtm)\b/i`, posted by a human (non-Bot). Verified in `.github/workflows/resume-on-comment.yml`: it triggers **only** on `issue_comment: created`, on the blocked **ISSUE itself** — not a PR (`!github.event.issue.pull_request` in the job `if`) — + `status:blocked` + `comment.user.type != 'Bot'`. So an approval comment posted on the draft gate PR does **nothing** — reply on the issue. A 👍 reaction raises no event; the `ui-approved` label exists but nothing listens for it. **Reactions, labels, and PR comments do nothing.**
- On approval, a deterministic step in that same workflow finds the draft gate PR (linked to the issue, base is `epic/*`), marks it ready, **merges with a merge commit — never squash**, and removes `status:blocked`. The link is matched from GitHub's own linked-issue relation first, then from a line-start `Closes` / `Fixes` / `Resolves` / `Sub-issue` / `Refs #<issue>` in the body (#1663 — it used to demand the literal `Closes #NN`, and a PR saying `Sub-issue: #NN` made the approval a silent no-op). **Write `Closes #<issue>` anyway** — it stays the canonical form, even on an `epic/*` PR where GitHub won't auto-close.
- Any other reply = a change request: iterate and re-hold. A no-op resume goes red (artifact-gate, #603).
- Who approves: this is a solo-dev repo — the owner (@pmcp). "Done" is *derived from a recorded sign-off*, never self-asserted (`AGENTS.md` "Done is signed off, not asserted"; the #988 incident — see `crouton-failure-archaeology`).
- Epic close has its own comment signal: `/close-epic`, valid only when the epic already carries `status:ready-to-close` (postmortem ran first) — verified in `close-epic-on-comment.yml`.

## 3. The packages-edit guard

`packages/*` is edit-guarded (`harness.config.mjs` declares it; the **live enforcer** is the PreToolUse hook `.claude/hooks/gate-package-edits.sh`, wired in `.claude/settings.json` on `Edit|Write` — it deliberately hardcodes `packages/*` for speed, #955). Two approval channels, verified in the hook:

1. **Interactive:** after explicit user approval, `echo '<package-name>' >> .claude/.package-edit-approved` (one name per line, gitignored). Remove it when done.
2. **Epic-scoped (#350):** `export CROUTON_PACKAGE_EDIT_APPROVED="<pkg> [<pkg>…]"` — survives spawned agents/worktrees, can't be committed.

**The approved set is the ticket's `pkg:*` labels (#2778).** The worker and the fix-bot take their package scope from the ticket's `pkg:*` labels; the packages guard accepts any of its three declarations (the `Packages-approved:` line, a `packages:approved` label, or a linked `pkg:*` issue). Ticket writers set them once: give `epic-scaffold.mjs` / `apply-decompose-plan.mjs` a plan field `packagesApproved: { why, packages: ["crouton-assets", …] }` and every child gets the `Packages-approved: <why>` line plus one `pkg:<name>` label per package (an unknown label fails loudly). An interactive orchestrator creating tickets by hand must add the same labels.

Safety net: `guard-package-approval.yml` fails any PR to `main` that commits the approval file. The agent pipeline adds a second net: `automerge-epic-subpr.yml` **holds a bot sub-PR touching `packages/`** for a human unless it targets an `epic/*` branch, touches no `.github/workflows/**`, and carries `build:approved` (#2777; decision in `scripts/shared-code-hold.mjs`). Workflow changes (#2442) always stay held, and PRs into `main` are never auto-merged by this path.

⚠️ **Contradiction, stated:** root `CLAUDE.md` and the hook's own comment call the file "session-scoped", but open issue [#701](https://github.com/FriendlyInternet/nuxt-crouton/issues/701) documents that `/commit` cleanup deletes the file, so multi-commit package work re-blocks (one epic needed 3 unlocks). Until #701 lands: expect to re-approve after each `/commit`, or use the env-var channel for a whole epic. Never route around the gate itself.

## 4. How work reaches `main`

The interactive flow (feature branch → `/commit` → PR `Closes #NN` → merge preserving commits) is owned by `AGENTS.md` (The loop, Commits) and the `github-tasks`/`commit` skills — read it there. What's specific here, verified in the workflows:

Agent pipeline: workers PR into an `epic/<NN>-<slug>` branch; non-gate bot PRs auto-merge there when green (`automerge-epic-subpr.yml`, merge commit); gate PRs wait for §2. **The pipeline stops at the epic branch — nothing reaches `main` on its own**: the epic→`main` PR is a human act (the #686 lesson, from that epic's postmortem — cited, not reproduced). It also never deploys production (§5).

## 5. The non-negotiables (rule → incident behind it)

| Rule | Enforced by | Incident / evidence |
|---|---|---|
| **Issue-first** — issue before code | *documented only* (SessionStart reminder text; no code gate) | `AGENTS.md` HARD GATE; treat a missing issue like a failing build |
| **Staging-only deploys** — prod needs `/deploy-production` on explicit human ask (#318) | **structural**: verified in `deploy-apps.yml` — the `detect` job hard-codes `env=staging` for `push`/`pull_request`; only `workflow_dispatch` with the literal `production` choice yields a prod entry (defensive whitelist) | #318, #347 |
| **Archaeology-first** for bugs (#424) | documented HARD GATE; `bug-archaeology` skill | a "code bug" that was really a stale pnpm symlink — a symptom-fix would have edited unbroken code (#424) |
| **Done is signed off, not asserted** | `gate-spec-signoff.mjs` hook for spec ledgers; §2 for everything else | #988: green build + typecheck + live deploy URL all true while the app 500'd on every request — see `crouton-failure-archaeology` |
| **No package-shipped D1 migrations** for infra tables | convention + the rejected-PR precedent | #680/#685/#700: package migrations apply before the app's and collide — sanctioned pattern in the `db-migrations` skill; full story in `crouton-failure-archaeology` |
| **Provenance headers** on agent-posted GitHub comments (lead with `🤖`) | PreToolUse hook `require-comment-provenance.mjs` (blocks the interactive `add_issue_comment` path) | agent comments post under the human @pmcp account and would otherwise impersonate the owner |

## 6. When NOT to gate

Owned by `AGENTS.md` (Sign-off gates: "when unsure a diff is in scope, don't gate") and this skill's §7 below (per-gate scope definitions, moved from root `CLAUDE.md`, #3350) — read them there. The one-line summary: gates guard the *expensive* step; a false hold costs a human round-trip.

## Provenance and maintenance

verified: 2026-07-02

Facts verified against the working tree: `scripts/harness-stages.mjs` run live on 4 paths; `resume-on-comment.yml` (trigger, approval regex, merge-commit step), `deploy-apps.yml` (staging hard-coding + dispatch whitelist), `automerge-epic-subpr.yml` (packages/ hold, no-squash), `close-epic-on-comment.yml` (label precondition), `guard-package-approval.yml`, `.claude/hooks/gate-package-edits.sh` + `gate-spec-signoff.mjs` + `require-comment-provenance.mjs` wiring in `.claude/settings.json`, issue #701 body (via GitHub API). Incident narratives (#686, #988, #680/#685) are cited from issues/postmortems, not reproduced. Re-verify with:

```bash
node scripts/harness-stages.mjs packages/crouton-core/x.ts   # stage/gate model still current?
grep -n "issue_comment" .github/workflows/resume-on-comment.yml   # approval still comment-only?
grep -n "production" .github/workflows/deploy-apps.yml | head     # #318 still structural?
gh issue view 701 --json state                                    # approval-scope contradiction fixed yet?
```

## 7. Per-gate scope, steps and approval (moved from root CLAUDE.md, #3350)

### UI Sign-Off (deploy a live preview before you build) — epic #307

**When a task changes a visual surface, get sign-off before you build it.** Treat work as
UI-touching if it adds/changes a `.vue` component, `app/components|layouts|pages/**`, a theme
(`crouton-themes`, a `ui:` block in `app.config.ts`), or app CSS/theme tokens. Pure
`<script>`/composables/types, `server/**`, config, tests, and docs are **not** UI — skip this.

**Look before you report.** An interactive agent never merges a UI-touching PR. It *looks at* the preview screenshot of the named `review-surface` page and tells the owner (preview link + one yes/no). If the screenshot is missing, blank or a loader, it says so instead of approving.

**Default gate — live preview:** run the **`ui-proposal`** skill to deploy a rough build to
staging with `NUXT_PUBLIC_CROUTON_REVIEW=true` (via `/poc-deploy` or `pnpm cf:staging`), post the
preview URL on a draft PR, and hold on `status:blocked`. The reviewer opens the running page,
pins comments on elements they want changed; each pin arrives as a `🎯 Preview feedback` PR
comment naming the source file. The agent fixes the named file, redeploys, and iterates. Capture
machinery lives in `@fyit/crouton-devtools` (wired by epic #590 WS1+WS2).

**Shared components — the gallery (#2462):** a PR that changes a `.vue` under
`packages/*/app/components` needs no hand-written preview page. The gallery (`pocs/gallery`)
deploys for that PR and its preview comment links each changed piece (`/__review?file=…`). If a
piece needs input to show, add one line in `pocs/gallery/app/review-samples.ts`. A new package
with components must be added to the gallery — `scripts/gallery-coverage.test.mjs` fails CI otherwise.

**Fallback — static mockup (`--static`):** when a live deploy isn't available (a packages
change that isn't a component — e.g. a theme — or the deploy pipeline is down), pass `--static` to the `ui-proposal`
skill. It produces an offline HTML/CSS mockup + PNG. Commit the `<slug>.html` + `<slug>.md`
"what changes" list; post the PNG as a sticky comment on the draft PR. Steer feedback to **inline
comments on the committed `.md`** in the diff (the PNG is a glance, not the feedback surface).

In the agent pipeline both paths are automated as a gate in `.claude/agents/task-worker.md`
(deploy or mockup → draft PR → hold → revise on feedback (#310) → build → screenshot (#311)).
In an interactive session, do the same by hand. Be conservative — when unsure whether a diff is
"visual", don't gate.

**What counts as approval** (the sign-off signal): a **reply comment that is only `ok`** (`not ok: …` is a change request; `lgtm`/`approve` still accepted). On a PR held for a human (shared code, workflows, epic → main) the owner's `ok` is also the merge go: the pipeline merges once green (#2832).
That comment is the *only* thing that resumes the pipeline — a 👍 reaction and the `ui-approved`
label do **not** trigger anything (`on-comment.yml` (the `resume` job) fires only on `issue_comment`; reactions
raise no event and no workflow listens for the label) (#572). Anything else is a change request —
iterate (redeploy for live-preview, re-render for `--static`) until approved (#310). On a
**pi-built PR** (head `work-<N>`), a change-request comment **on the PR** (or on its issue)
re-runs the pi worker on that branch with the comment as its instruction and stacks a commit
on the PR — `on-comment.yml` (`revise` job) → `work-issue-pidev.yml` `feedback` input (#2446).

### Schema Sign-Off (review the data model before you generate) — epic #314

**When a task creates or changes a collection schema, review it before generating.** Before
running `crouton config` / `generate_collection` (or editing a `schemas/*.json` fieldsFile), run
the **`schema-review`** skill to render the field table, get a human to sign off on the **data
model** first, and only then generate. The schema is the foundation — every Form/List/API/
migration derives from it, so a wrong type or missing relationship is cheap to fix here and
expensive after. This sits **after** the machine `validate_schema` step (the human gate on top of
it). In the agent pipeline it's a gate in `.claude/agents/task-worker.md`; interactively, do the
same by hand. It **reuses the same revision/approval loop and signal as the UI gate** (#310) —
feedback goes inline on the committed `<collection>.md` in the diff; approval (a **comment**
that is only `ok` (legacy `lgtm`/`approve`) — not a reaction or label, #572) unblocks generation.

### Test Sign-Off (agree on the test before you write the code) — epic #774

**When a task adds or changes hand-written LOGIC in `packages/*`, write the test first and agree on
it before writing the code.** Run the **`test-review`** skill to render the proposed *failing*
test(s) — the cases being asserted, in plain language plus the test code — get a human to sign off
on the **behaviour**, and only then write the code that makes it green. The agreed test is the
contract: "done" = that test passes. This is the third sign-off gate alongside Schema (#314, the
data model) and UI (#307, the look) — pick the gate by *what the change is*.

**Scope is by where the code currently lives (#779), not its origin or destiny.** The
canonical, queryable source is the **stage model** (`harness.config.mjs`, epic #952): run
`node scripts/harness-stages.mjs <path>` to see a path's stage and whether `test-first` is
`on` / `opt-in` / `off` — don't re-derive it from the folder name by hand. The table below is
the **default profile** rendered for humans (rename `poc`→`spike` etc. in that one file):

| Current home | Stage | Test-first |
|---|---|---|
| `packages/*` | `package` | **On** (default) — what we maintain; every consuming app inherits its correctness |
| `apps/*` | `app` | **Opt-in** — may be another user's app; their call, not ours to impose |
| `pocs/*` | `poc` | **Off** — the incubator must stay fast and safe-to-fail |

The gate moves *with the code*: a POC has no fixed identity, so it's exempt while it's a POC, and
**graduating to `packages/*` is the checkpoint to backfill its tests** (see the `pocs/` note above).
Within `packages/*` the gate fires only on hand-written **logic** — a data model routes to the
Schema gate, how something looks routes to the UI gate, and deterministic generated CRUD is covered
by the e2e fixture smoke, not here.

In the agent pipeline it's a gate in `.claude/agents/task-worker.md`; interactively, do the same by
hand. It **reuses the same revision/approval loop and signal as the UI/Schema gates** (#310) — hold
on `status:blocked`; approval is a **comment** that is only `ok` (legacy `lgtm`/`approve`; not a reaction or label,
#572) and unblocks the code. (The CI `test` job already hard-gates `pnpm test` — this gate is about
*order*, writing the test first, not enforcement.)

**Two lanes, one shape (#2785, supersedes #2441's interactive hold).** The interactive agent does not
write the code. It agrees the test cases with the owner in plain language and writes them into the
ticket; the hold happens on the ticket, before `delegate`, not on a PR. The pipeline worker
(`work-issue-pidev.yml`) then writes the tests **and** the code to those cases in one PR, and the
finish step's tests gate (#1885) opens the PR as a **draft** when a `packages/*` logic file lands
with no test — visible, not blocking. A worker that meets a ticket asking for a test-first hold
follows this rule and says so in its done comment.

**Plan → review → build (pipeline lane, #2757, epic #2754).** A `work-this` issue that is a bug
(`type:fix`), names a `packages/` path, or touches auth / sync / scoped-access / team-filtered
data starts in **plan mode**: the `route` job in `label-router.yml` (rules in
`.claude/plan-routing.json`, logic in `scripts/lib/plan-route.mjs`) dispatches a plan run
(#2755) → `plan-review.yml` has an independent top-model reviewer grade it (#2756) → on
`plan:approved`, `label-router.yml` dispatches the build with the approved plan comment as its
instruction (`plan` input). The build implements exactly that plan, stops and says why if reality
differs, links the plan in its PR body; the run's record step writes the ledger row to the
`pipeline-data` branch under `plan-ledger/` (`scripts/plan-ledger.mjs --write`, #3457).
`writeups/reports/plan-review-ledger.jsonl` stays on main as frozen history up to 6 Nov 2026. Chores and app-only
tweaks build directly. Labels `plan-first` / `no-plan` force or skip the step (`no-plan` wins).
