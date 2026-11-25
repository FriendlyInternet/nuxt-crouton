# How a ticket becomes a merged change

Every change in this repo is built by an agent pipeline running in GitHub Actions. A human writes
the ticket and makes a few decisions; the agents plan, build, review and merge the rest. This page
walks one ticket from start to staging. Each step names the workflow (in `.github/workflows/`) and
the script (in `scripts/`) that does it. **Bold** marks the moments the owner decides, with the
exact word they reply.

## The story

1. **Start.** The owner adds the `work-this` label — the only label a human applies.
   `label-router.yml` (its `work-this` branch) sends the issue down one of five roads, checked in
   this order:
   - 0. A ticket a chat wrote (not made by the pipeline's split) under an epic, with no ticket-review
     go for itself → `scripts/ticket-review-gate.mjs` takes `work-this` off and starts
     `ticket-review.yml -f subject=<n>` for that ticket alone (#4456); on go it puts `work-this`
     back, or, if a `Blocked-by:` ticket is still open, notes "waits for #N" and the blocker's close
     starts it.
   - a. The issue already has `plan:approved` → straight to the build (step 4).
   - b. The issue is an epic (`scripts/epic-route.mjs` says `splitter`) **or** its text asks for a
     mockup first ("Hold for design sign-off", "Mockup first", "Hold for the mockup", … —
     `SIGNOFF_PATTERN` in `scripts/lib/signoff-route.mjs`, #3238/#4524) → the
     splitter, `decompose-on-issue-pidev.yml`. For an epic it writes sub-issues to
     `decompose-plan.json`, applies them with `scripts/apply-decompose-plan.mjs`, and
     `ticket-review.yml` reviews each ticket (`scripts/lib/ticket-verdict.mjs`). A no-go sends the
     failed tickets to `ticket-revise.yml`, which rewrites them from the review's findings
     (`scripts/ticket-revise.mjs`) and runs the review again, up to 3 rounds per ticket (per epic
     for epics without `tickets:rolling`), and 3 for the step list; a needs-owner verdict or round 3
     holds for the owner. For a new epic (label `tickets:rolling`, #3846) the splitter writes the
     step list plus only the first ticket; `ticket-review.yml -f subject=plan` reviews the step list
     once, and the orchestrator writes each later ticket by hand (with `step=<k>` in its pipeline
     block) and runs `gh workflow run ticket-review.yml -f epic=<E> -f subject=<n>`, which reviews
     that ticket alone against the epic branch (`scripts/epic-checkout.mjs`); a no-go holds only that
     ticket and the steps after it (`scripts/ticket-review-actions.mjs`, `scripts/lib/epic-steps.mjs`).
     If a step list turns out wrong, the epic is held: fix the step-list comment by hand and run
     `gh workflow run ticket-review.yml -f epic=<E> -f subject=plan`. If that edit leaves the list
     unreadable (bad JSON, or a field such as `"ticket": "#11"` instead of `11`), no ticket starts,
     the epic never counts as finished, and the next review holds the epic (`status:blocked`) naming
     the field that is wrong. To move an existing epic to
     per-ticket verdicts, add the `tickets:rolling` label; write any missing ticket by hand. A rolling
     epic counts as finished (epic→main PR, postmortem) only when every step has a closed ticket.
     A step whose tickets were all closed as not planned counts as dropped: it does not hold the
     epic, but it is never counted as built, and the epic's status comment, its PR into main and its
     postmortem name it (built N, dropped M).
     For a design
     sign-off it first posts one mockup hold: **owner decides here — `ok` on the design, or what to
     change**. Nothing is planned or built before that.
   - c. `scripts/lib/plan-route.mjs` says `plan` → `work-issue-pidev.yml` in plan mode (step 2).
     That happens when the issue has `plan-first`, a `type:fix` or `workflow` label, names a
     `packages/` or pipeline path, or touches auth / sync / team data. `no-plan` skips it. The rule
     lists live in `.claude/plan-routing.json`.
   - d. Anything else → `work-issue-pidev.yml` builds directly, with no plan step (step 4).
2. **Plan.** The planner posts one `<!-- pipeline-plan:v1 -->` comment on the issue, shape-checked
   by `scripts/lib/plan-shape.mjs`. A plan too big for one run may add an optional `### Split`
   that moves part of the ticket to a follow-up.
3. **Plan review.** The `plan-review` job in `on-comment.yml` (`scripts/lib/plan-verdict.mjs`)
   judges the plan. `go` → the bot adds `plan:approved` and the build starts. `needs-owner` →
   `status:blocked` plus one yes/no question: **owner answers here — any owner reply re-plans (a chat's comment re-plans only with a `**Worker:**` line); the owner's bare `ok` (typed, or relayed by a chat whose header says `owner answer`) is recorded in the ticket's `## Decisions` as "yes" and re-plans from it; a chat's status note re-plans nothing (#4531)**. `no-go` →
   a re-plan, or a hold.
4. **Build.** `label-router.yml` sees `plan:approved` → `scripts/handoff-exec.mjs` →
   `work-issue-pidev.yml` builds and opens a PR (`Closes #N`) on the epic branch
   (`scripts/epic-base.mjs`). If the worker has to ask something, it writes the question to a
   file; the step after the build posts it with `status:blocked` and, when the PR is open, a reply
   record, so the owner's first answer (typed or relayed) re-runs the worker on that PR
   (`scripts/lib/worker-question.mjs`, #4192). If the approved plan has a `### Split`, `handoff-exec.mjs` first
   files the moved part as a new ticket (`Blocked-by:` this one, same epic) and notes it on the
   issue; it starts once this one closes.
5. **Checks and build review.** `ci.yml` (the `CI Gate` check) plus `build-review.yml`
   (`scripts/build-review-pick.mjs`). The build review has three answers: `go` → the reviewer adds
   `build:approved`; `no-go` → a `**Worker:**` revision, and after two sent-back rounds it holds with
   `status:blocked` for the owner; `needs-owner` → one yes/no question on the PR and `status:blocked`
   on the issue: **owner decides here (`ok` / `not ok: …`)**. A red build → `fix-ci-on-failure.yml`.
   The reviewer is given the PR's `plan-checks` table (`scripts/lib/build-review-prompt.mjs`) as the
   record of which plan tests ran and passed on that commit, and judges only whether each test aims
   at the ticket's rule.
   It is also given the outside reviewer's High findings (`scripts/lib/outside-review.mjs`, an outside
   review is no longer asked for (owner decision 2026-11-20, #4360); if one is ever posted it is still
   read, trusted only from the `qodo-code-review[bot]` app); it must
   answer each one in its verdict ("fixed in <commit>" or "not a problem because …"), and a go with an
   unanswered High finding is turned into no-go by `build-verdict.mjs`. With no outside review (paused
   or never asked) the comment says so in one line.
   The owner can also ask for changes at any time with a top-level `**Worker:** <what to change>`
   comment.
6. **Merge into the epic branch.** `automerge-epic-subpr.yml` decides it with
   `scripts/lib/pr-merge-gate.mjs` (`decideLeafMerge`, or `decideV1` on a v1 epic branch
   `epic/<n>--v1-*`) and `scripts/shared-code-hold.mjs`. The PR merges by itself once `CI Gate` is
   green and `build:approved` is on the current commit — including a PR that touches `packages/`:
   the build review stands in for the owner there. Three cases wait for **the owner's `ok` on the
   PR**: a PR that changes `.github/workflows/` (it needs both `build:approved` and the `ok`, and
   never merges by itself), a PR the build review held after two rejected rounds, and a PR where the
   build review asked a `needs-owner` question (step 5). On a v1 epic branch the workflow only
   writes the `Merge decision` check, and GitHub merges once `CI Gate` + `Merge decision` are green —
   see [the pipeline v1 guide](./README.md). A `work-*` PR straight into `main` merges on the
   owner's `ok`, or by itself when every changed file is in the incubator stage and the build review
   said go on its current commit (#3757); the merge check logs the reason.
7. **Epic → `main`.** The epic PR merges only on **the owner's `ok`**, and only when both `CI Gate`
   and `E2E Gate` have passed (the `approve-epic` job in `on-comment.yml`, decided by
   `scripts/epic-merge-decision.mjs`).
8. **Staging deploy.** `deploy-apps.yml` (`scripts/deploy-detect.mjs`, `scripts/await-staging.mjs`)
   deploys the changed apps to staging. Once every child of an epic is closed and its merge is on
   staging, `post-test-card.yml` (`scripts/post-test-card.mjs`) posts one test card on the epic and
   sets `status:to-test`. Above the checks left for the owner, the card lists what the pipeline
   already checked: each finished child's merged PR and the first line of its last ✅ closing note.

A blocked run is resumed by any reply on the issue (the `resume` job in `on-comment.yml`). Each reply to an open question also gets one plain line at the end of that question saying how it was read (for example "read as **yes** → re-planning with your yes"); a newer reply replaces it (the `receipt` job, `scripts/lib/reply-receipt.mjs`, #4207).

**Stale epic branch.** The owner comments `/fresh-branch` on the epic; the `fresh-branch` job in `on-comment.yml` (`scripts/fresh-epic-branch.mjs`) renames the branch to `archive/<name>` and lists what was left on it, and the next worker run recreates it from main (`scripts/sync-epic-branch.sh`). It refuses a branch whose name does not start with `epic/<N>-` (a child epic is pointed to its parent) and refuses when it cannot list what the branch holds.

## Every workflow, by line

The table below is generated from the workflow files and the grouping in
`scripts/metrics/lines.json`. Adding or renaming a workflow without running
`node scripts/gen-pipeline-map.mjs` fails CI.

<!-- pipeline-map:start -->
<!-- GENERATED by scripts/gen-pipeline-map.mjs from .github/workflows + scripts/metrics/lines.json — do not edit by hand -->

#### tickets

| File | Name | Starts on |
| --- | --- | --- |
| [label-ready-epics.yml](../../.github/workflows/label-ready-epics.yml) | label-ready-epics | `workflow_dispatch` |
| [label-router.yml](../../.github/workflows/label-router.yml) | Label router (work-this · delegate · plan:approved) | `issues` |
| [labels.yml](../../.github/workflows/labels.yml) | Sync issue labels | `push`, `workflow_dispatch` |
| [on-issue-close.yml](../../.github/workflows/on-issue-close.yml) | On issue close | `issues`, `workflow_dispatch` |
| [routing-registry.yml](../../.github/workflows/routing-registry.yml) | routing-registry | `pull_request`, `push` |
| [ticket-review.yml](../../.github/workflows/ticket-review.yml) | Ticket review (independent reviewer — pi.dev) | `workflow_dispatch` |
| [ticket-revise.yml](../../.github/workflows/ticket-revise.yml) | Ticket revise (rewrite sent-back tickets — pi.dev) | `workflow_dispatch` |
| [warn-closes-blocked.yml](../../.github/workflows/warn-closes-blocked.yml) | Warn on a risky Closes | `pull_request` |

#### planning

| File | Name | Starts on |
| --- | --- | --- |
| [decompose-on-issue-pidev.yml](../../.github/workflows/decompose-on-issue-pidev.yml) | Decompose on issue (pi.dev variant) | `workflow_dispatch` |
| [on-comment.yml](../../.github/workflows/on-comment.yml) | On comment | `issue_comment` |
| [schedule-waves.yml](../../.github/workflows/schedule-waves.yml) | Wave scheduler | `workflow_run` |

#### building

| File | Name | Starts on |
| --- | --- | --- |
| [build-review.yml](../../.github/workflows/build-review.yml) | Build review (independent reviewer — pi.dev) | `workflow_run`, `workflow_dispatch` |
| [ci.yml](../../.github/workflows/ci.yml) | CI | `push`, `pull_request` |
| [e2e.yml](../../.github/workflows/e2e.yml) | E2E | `push`, `pull_request`, `workflow_dispatch` |
| [guard-package-approval.yml](../../.github/workflows/guard-package-approval.yml) | Guard package-edit approval | `pull_request` |
| [migration-guard.yml](../../.github/workflows/migration-guard.yml) | Migration guard | `pull_request`, `workflow_dispatch` |
| [packages-guard.yml](../../.github/workflows/packages-guard.yml) | Packages guard | `pull_request` |
| [post-test-card.yml](../../.github/workflows/post-test-card.yml) | post-test-card | `workflow_run`, `workflow_dispatch` |
| [preview-screenshot.yml](../../.github/workflows/preview-screenshot.yml) | Preview screenshot | `workflow_run`, `workflow_dispatch` |
| [review.yml](../../.github/workflows/review.yml) | Review | `pull_request` |
| [secret-scan.yml](../../.github/workflows/secret-scan.yml) | Secret scan | `pull_request`, `push` |
| [skill-freshness-pr.yml](../../.github/workflows/skill-freshness-pr.yml) | Skill freshness (PR advisory) | `pull_request` |
| [skills-doc.yml](../../.github/workflows/skills-doc.yml) | skills-doc | `pull_request`, `push` |
| [work-issue-pidev.yml](../../.github/workflows/work-issue-pidev.yml) | Work issue (pi.dev · single-use worker) | `workflow_dispatch` |

#### fixing

| File | Name | Starts on |
| --- | --- | --- |
| [fix-ci-on-failure.yml](../../.github/workflows/fix-ci-on-failure.yml) | Fix CI on failure | `workflow_run`, `workflow_dispatch` |
| [report-failed-deploy.yml](../../.github/workflows/report-failed-deploy.yml) | Report failed post-merge deploy | `workflow_run` |
| [verify-fix-evidence.yml](../../.github/workflows/verify-fix-evidence.yml) | Verify pipeline-fix evidence | `workflow_run`, `workflow_dispatch` |

#### merging

| File | Name | Starts on |
| --- | --- | --- |
| [automerge-epic-subpr.yml](../../.github/workflows/automerge-epic-subpr.yml) | Auto-merge epic sub-PRs | `pull_request`, `check_suite`, `workflow_run`, `workflow_call`, `workflow_dispatch` |
| [handoff-sweep.yml](../../.github/workflows/handoff-sweep.yml) | Hand-off sweep (replay saved pipeline hand-offs) | `workflow_run`, `workflow_dispatch` |
| [on-pr-close.yml](../../.github/workflows/on-pr-close.yml) | On PR close | `pull_request` |
| [owner-quiz.yml](../../.github/workflows/owner-quiz.yml) | Owner quiz | `workflow_call`, `workflow_dispatch` |
| [postmortem.yml](../../.github/workflows/postmortem.yml) | Epic postmortem | `workflow_call`, `workflow_dispatch` |
| [release-waiting.yml](../../.github/workflows/release-waiting.yml) | Release waiting tickets | `workflow_call` |
| [status.yml](../../.github/workflows/status.yml) | Status | `workflow_run`, `check_suite`, `status`, `pull_request`, `issues` |

#### deploys

| File | Name | Starts on |
| --- | --- | --- |
| [db-clone.yml](../../.github/workflows/db-clone.yml) | db-clone | `workflow_dispatch` |
| [db-counts.yml](../../.github/workflows/db-counts.yml) | db-counts | `workflow_dispatch` |
| [deploy-app.yml](../../.github/workflows/deploy-app.yml) | Deploy App (reusable, Cloudflare Workers) | `workflow_call` |
| [deploy-apps.yml](../../.github/workflows/deploy-apps.yml) | Deploy Apps (Cloudflare Workers) | `push`, `pull_request`, `workflow_dispatch` |
| [deploy-docs.yml](../../.github/workflows/deploy-docs.yml) | Deploy Docs | `push`, `pull_request`, `workflow_dispatch` |
| [deploy-pocs.yml](../../.github/workflows/deploy-pocs.yml) | Deploy POCs (preview) | `push`, `pull_request`, `workflow_dispatch` |
| [deploy-sandbox.yml](../../.github/workflows/deploy-sandbox.yml) | Deploy Sandbox (manual, Cloudflare Workers) | `workflow_dispatch` |
| [deploy-themes-playground.yml](../../.github/workflows/deploy-themes-playground.yml) | Deploy Themes Playground | `push`, `pull_request`, `workflow_dispatch` |
| [deploy-ticket-editor.yml](../../.github/workflows/deploy-ticket-editor.yml) | Deploy ticket-editor Worker | `push`, `workflow_dispatch` |
| [release-venue-bundle.yml](../../.github/workflows/release-venue-bundle.yml) | Release venue bundle | `workflow_dispatch`, `push` |
| [teardown-app.yml](../../.github/workflows/teardown-app.yml) | teardown-app | `workflow_dispatch` |
| [teardown-on-removal.yml](../../.github/workflows/teardown-on-removal.yml) | teardown-on-removal | `push` |

#### scheduled

| File | Name | Starts on |
| --- | --- | --- |
| [canary.yml](../../.github/workflows/canary.yml) | Canary rig (worker pipeline) | `workflow_dispatch` |
| [epic-digest.yml](../../.github/workflows/epic-digest.yml) | epic-digest | `workflow_dispatch` |
| [housekeeping.yml](../../.github/workflows/housekeeping.yml) | housekeeping | `workflow_dispatch` |
| [loop-station-inventory.yml](../../.github/workflows/loop-station-inventory.yml) | loop-station-inventory | `push`, `workflow_dispatch` |
| [loop-station-refresh.yml](../../.github/workflows/loop-station-refresh.yml) | Loop-station refresh | `push`, `workflow_dispatch` |
| [pi-key-canary.yml](../../.github/workflows/pi-key-canary.yml) | Provider key canary | `workflow_dispatch` |
| [pipeline-metrics.yml](../../.github/workflows/pipeline-metrics.yml) | Pipeline metrics (collect + roll up run history) | `workflow_dispatch` |
| [pipeline-review.yml](../../.github/workflows/pipeline-review.yml) | Pipeline review (every 10 closed epics) | `workflow_dispatch` |
| [quality-digest.yml](../../.github/workflows/quality-digest.yml) | quality-digest | `workflow_dispatch` |
| [skills-digest.yml](../../.github/workflows/skills-digest.yml) | skills-digest | `workflow_dispatch` |
| [sync-changelogs.yml](../../.github/workflows/sync-changelogs.yml) | Sync Changelogs | `workflow_dispatch` |
| [weekly.yml](../../.github/workflows/weekly.yml) | weekly | `workflow_dispatch` |

<!-- pipeline-map:end -->
