# Agents

Custom Claude Code sub-agent definitions for this repo. Each `*.md` file is one agent:
YAML frontmatter (`name`, `description`, `tools`, `model`) + a system prompt body.
Spawn them with the `Agent` tool (`subagent_type: "<name>"`); the harness matches by
the `name` field.

## The task-decomposition pipeline

A recursive "one task → tree of GitHub issues → agents" system. Entry point is the
`/task-decompose` skill (`.claude/skills/task-decompose/`). See epic **#249**.

```
/task-decompose '<task>'
  └─ task-orchestrator (depth 0)      reads epic → 2–6 sub-issues → spawns a decomposer per child
       └─ task-decomposer (depth 1+)  LEAF TEST one issue:
            ├─ leaf / depth==MAX  →   spawn task-worker (worktree) → PR (Closes #N)
            └─ too big           →    create sub-issues → spawn a decomposer per child (RECURSE)
```

| Agent | File | Recurses? | Writes code? | Model |
|-------|------|-----------|--------------|-------|
| `task-orchestrator` | `task-orchestrator.md` | no | no | `sonnet` |
| `task-decomposer`   | `task-decomposer.md`   | **yes** | no | `sonnet` |
| `task-worker`       | `task-worker.md`       | no | **yes** (one leaf → one PR) | `opus` |

**Model split — tier by REASONING LEVERAGE, not by "writes code?" (#824, revised on N=4 evidence):**
*writing code* and *reasoning* are different axes, and the planning roles sit at the top of
the reasoning one — so the naive cut ("the orchestrator and decomposer only touch GitHub
issues, run them on Haiku") is **backwards**: a **blunt** planner mis-frames the tree, and that
error is paid downstream as wasted **Opus-worker** runs (build the wrong thing → the
artifact-gate catches it late). The **orchestrator** owns the package-reuse call (#292 —
build-on-a-package vs from-scratch, the #274 reinvent-a-package failure) and the top-level slice
that frames the **entire** tree; the **decomposer** recursively applies the LEAF TEST and writes
the **acceptance criteria the worker builds against**. #824 left one open question: is a
*strong-but-cheaper* model a blunt planner or a peer? **An N=4 decompose A/B answered it** —
Opus 4.8 vs **Sonnet 5** on four real epics (human breakdowns hidden, single-judge): Sonnet 5
**matched or beat Opus 4.8 on 3 of 4**, at ~5× lower token price and with **fewer NEEDS-SPLIT
recursion rounds** (it produced buildable leaves directly instead of deferring). So it's a
**peer** planner, not a blunt one — and the orchestrator + decomposer now run on **Sonnet 5**
(medium tier). The **worker stays on Opus** because it writes the actual code (the one role
#824 flagged as the Sonnet-trial candidate — still pending a gate-pass-rate measurement). The
principle is unchanged — spend the strongest model where the hardest decisions are made — the
evidence just moved the planning roles' price point down. Remaining cost levers live elsewhere
(drop fixed daily sweeps; route reports-only flows to Haiku via pi). Caveat: N=4, single judge —
a strong signal, not proof; the #865 eval scoreboard is where this gets validated continuously.

## The red-team agent (standalone — not part of the pipeline)

`red-team.md` is an **adversarial security prober** (epic #540), independent of the
decomposition pipeline above. Given `{ scope, depth }` it reads the code as an attacker
would — cross-team IDOR, auth bypass, injection, secret exposure, SSRF, upload/cache/
rate-limit gaps — and **returns structured findings** (it never edits product code).
Static-first; at `depth=deep` it may dynamically confirm high/criticals against a fixture.

| Agent | File | Recurses? | Writes code? | Model |
|-------|------|-----------|--------------|-------|
| `red-team` | `red-team.md` | no | no (reports only) | `sonnet` |

It's steered by the **`/red-team` skill** (on demand) and run by
`.github/workflows/red-team.yml` (per-PR `quick`, fails the check on high+) and
`red-team-daily.yml` (daily `deep`). Findings → a report under `writeups/reports/` + (for
confirmed high/criticals) `security`/`sec:*` GitHub issues.

## The a11y agent (standalone — the accessibility analog of red-team)

`a11y.md` is an **accessibility prober** (epic #726), the code-cleaning analog of
`red-team`. Given `{ scope, depth, fix }` it reads `.vue` templates as a screen-reader /
keyboard user would — ARIA-without-keyboard, missing `alt`/labels, positive `tabindex`,
bad roles — and **returns structured severity-rated findings**. Static-first via
`eslint-plugin-vuejs-accessibility`; at `depth=deep` it runs `@axe-core/playwright`
against a fixture. It reports; it patches the safe set (`alt`/`aria-label`/label-for/
`role`+`tabindex`) only under `fix:true`.

| Agent | File | Recurses? | Writes code? | Model |
|-------|------|-----------|--------------|-------|
| `a11y` | `a11y.md` | no | only under `fix:true` (safe set) | `sonnet` |

It's steered by the **`/a11y` skill** (on demand) and run by
`.github/workflows/a11y.yml` (per-PR `quick`, fails the check on 🔴 critical/serious) and
`a11y-daily.yml` (daily `deep`, posts a public standing issue + files `a11y` issues for new
criticals). Severity maps axe critical/serious → 🔴, moderate → 🟡, minor → 🔵.

## The frontend-review agent (standalone — the Nuxt UI 4 conventions analog of a11y)

`frontend-review.md` is a **front-end conventions prober** (epic #834), the
component-usage sibling of `a11y`. Given `{ scope, depth, fix }` it reads `.vue`
templates the way a Nuxt UI 4 reviewer would — v3 component names (`UDropdown`→
`UDropdownMenu` etc.), the v4 overlay pattern (`#content="{ close }"`, no `UCard`
inside a `UModal`), Options API in a `.vue`, raw-HTML re-implementations where a Nuxt
UI / crouton component applies, hardcoded colors over theme tokens — and **returns
structured severity-rated findings**. Static-first (deterministic greps for the v3
names / `UCard`-in-overlay / Options-API spine); `deep` cross-checks ambiguous calls
against the real `@nuxt/ui` component set. It reports; it patches only the safe
deterministic set (v3→v4 renames, redundant-overlay-`UCard` unwraps) under `fix:true`.

| Agent | File | Recurses? | Writes code? | Model |
|-------|------|-----------|--------------|-------|
| `frontend-review` | `frontend-review.md` | no | only under `fix:true` (safe set) | `sonnet` |

It's steered by the **`/frontend-review` skill** (on demand) and run by
`.github/workflows/frontend-review.yml` (per-PR `quick`, fails the check on a 🔴
critical convention break, diff-scoped so never the backlog). Its lens is conventions
only — not visual taste (`/ui-proposal`), accessibility (`/a11y`), or security
(`/red-team`).

### The agent contract

- **Input is passed in the prompt** as a small JSON-ish object — e.g.
  `{ issue_number, depth, epic }`. Each agent documents the exact shape it expects at the
  top of its body. Always pass `depth` and `epic` down the chain.
- **GitHub is the source of truth.** Every level is a real issue (epic → sub-issues),
  linked via `sub_issue_write`, labelled per the `github-tasks` skill (one `type:*` +
  one `pkg:*`/`app:*`; `epic` carries no type; never `root`).
- **Idempotency.** Agents may be re-run (sessions are ephemeral). Before creating
  children, check `get_sub_issues` and don't duplicate — re-spawn for unworked children.
- **Verify, don't narrate (artifact-gate, #461).** NEVER report a step done from *intent*.
  Re-read the issue/PR and confirm the artifact actually exists — the comment posted, the PR
  opened, the file written — before you say it's done or end your turn. Describing the plan
  ("the worker is now creating the schemas…") is **not** doing it: that exact no-op (a run
  that exits `success` having produced nothing) is what the **artifact-gate** in
  `decompose-on-issue.yml` now turns into a **red** run. Do the work, then prove it landed.
  **One first-class PASS shape worth knowing (#1076):** a PR opened this run + a
  `.github/workflows/**` patch embedded in its body for a human to apply (the token can't write
  there — see `task-worker.md` → "`.github/workflows/` boundary") already satisfies the gate via
  `linkedPR` alone; it is not a partial/no-op run, and no separate gate change was needed to
  recognize it.
- **Spawned agents are SYNCHRONOUS — there is NO "background" execution (the #455 root cause).**
  The `Agent`/Task tool runs a sub-agent **to completion and returns its result within your
  turn**. Nothing keeps running after you stop: when your turn ends, the GitHub Action **job
  ends and all work halts**. So you must **NEVER** end your turn saying *"the worker is running
  in the background — watch for the PR"* — that belief is **false** and is exactly how the #455
  build burned `$0.52` at `num_turns: 1` and produced nothing. After you spawn a worker you
  **already hold its result** — read it, confirm the PR/comment actually exists, and only then
  report. If the spawn didn't deliver, you are **not done**: spawn again (and wait), or do the
  work yourself. There is no fire-and-forget.
- **Hand off by SPAWNING, never by LABELING (the #457 root cause).** To get a child issue
  worked you **spawn** it with the `Agent` tool (a `task-decomposer` or `task-worker`) in
  THIS run and wait for its result. **NEVER apply the `delegate` label to a sub-issue to
  "dispatch" it.** `delegate` is the *human* entry trigger only: applied from inside a run
  you are `claude[bot]`, so it re-enters `decompose-on-issue.yml` as a **bot actor** → the
  bot-actor guard rejects that child run → it produces nothing; worse, a sub-issue dispatched
  that way runs `/task-decompose` on *itself as a fresh epic off `main`*, where the real
  epic's scaffold doesn't exist. (This is exactly how the #457 deploy stalled: the
  orchestrator applied `delegate` to #456/#457 instead of spawning workers — both child runs
  were bot-rejected, no PR, no deploy.) There is no label-based hand-off: spawn the agent, or
  do the leaf's work yourself in this run.
- **A directly-dispatched child resolves to its parent's epic branch — never a new epic off
  `main`.** When `/task-decompose` is invoked on an issue that is itself a **sub-issue** (its
  `parent_issue_url` is set / it carries a parent epic), do **NOT** mint a fresh
  `epic/<child>-<slug>` off `main`. Resolve the parent epic and use its existing
  `epic/<parent>-<slug>` as the integration base, then work just that child there. Only a
  true top-level epic creates a new epic branch. (This is what makes a human/`comment-dispatch`
  `delegate`/`/deploy` on a single child issue land on the right branch instead of off `main`.)
- **Stop-conditions live in `task-decomposer.md`:** `MAX_DEPTH = 3`, `MAX_CHILDREN = 6`,
  and the four-part LEAF TEST. Tune them there (+ orchestrator's MAX_CHILDREN).
- **Async human-in-the-loop (`NOTIFY_HANDLE = @pmcp`).** Agents may run headless, so they
  **never block on `AskUserQuestion`** (it times out). On a real blocker they
  `add_issue_comment` with the question, **@mention `NOTIFY_HANDLE`** (so the owner gets a
  GitHub/app notification), apply `status:blocked`, and stop — the human answers by
  replying on the issue. Small ambiguities are decided with a default + a noted
  assumption (no ping). Change the handle in this file and in the task-decompose skill.
  **When** to ask vs decide is the 3-part test in `AGENTS.md` → *Deciding vs asking* (ask only
  when the fork is irreversible/expensive **and** not derivable **and** genuinely the human's;
  else decide + log). Not "no assumptions" — assume the derivable/reversible, escalate the rest.
- **A block comment is a HANDOFF, not just a question (#639) — emit it via the `ask-human`
  skill (#1189).** The owner's reply spawns a **brand-new session** (`resume-on-comment.yml`)
  that has **zero memory** of your reasoning and checks out `main` — not your worktree, which
  is gone. So the blocking comment must be self-contained enough for a cold agent to resume
  from, **and** 10-second-scannable for an owner holding many threads: lead with the one
  decision **and a recommendation**, never a naked "what do you want?". The skill carries the
  canonical shape (it doubles as the question *and* the resume brief):
  ```
  ## 🔀 Blocked — <the one decision, in one line>
  > 🤖 provenance header (interactive @pmcp-account disclaimer)
  **TL;DR — recommend <X>:** <decision restated + why X, first>
  **Status:** <what's done · branch name + pushed? · what's NOT done>
  **Why it came up:** <what cannot proceed until answered>
  **Options:** A) … _(recommended)_ · B) …
  **Reply:** `A`/`B` (or in-medium) → a NEW session resumes from THIS ticket
  **Don't lose:** <decisions/assumptions already made the next agent must keep>
  ```
  And **push before you block**: if you've written anything, `git push -u origin <branch>`
  first and name that branch under *Status* — an unpushed worktree is lost on stop, a
  pushed branch is recoverable by the resuming session.
- **The PING is a TOP-LEVEL comment, never a PR *review* body.** Post the handoff/sign-off via
  `add_issue_comment` (a top-level issue/PR comment) — that reliably notifies. A PR **review**
  body (state `COMMENTED`) is a weak surface the owner misses: on #846 pi buried its
  `reply lgtm/approve` ping inside a review and it nearly went unseen. Put any detailed review
  or analysis in its own separate artifact; the actionable ask (the handoff block + `@mention` +
  `status:blocked`) stands alone as a top-level comment.
- **An @mention is a request for action, not a broadcast.** Only @mention `NOTIFY_HANDLE`
  when you need the human to *do* something: answer a blocking question, give a sign-off,
  or unblock you. **Pure progress/status updates** ("spawning the worker for #NN", "wave 2
  of 4 starting", "preview deploying") are posted as **plain comments with no @mention** —
  they're FYIs, not asks. If nothing is required of the human, do not ping them.
- **Workers are isolated.** The decomposer spawns workers with `isolation: "worktree"`
  so parallel leaves never collide on branches/files. One issue → one branch → one PR
  with `Closes #NN`. Workers obey the `packages/` HARD GATE and the `/commit` + no-squash
  merge policy.

### Integration-branch flow & safety (#348)

Hardening from the #325 post-mortem (parallel workers off `main` re-created the same
package). Threaded through `epic_branch` in the agent contract:

- **Epic integration branch (#349).** The orchestrator creates `epic/<NN>-<slug>` off
  `main` and passes `epic_branch` down to every decomposer/worker. Workers branch off it
  and target their PRs **at it**, not `main` — so later sub-issues see earlier ones' merged
  work. One **epic→`main`** PR at the end is the single human review; the epic isn't "done"
  until that lands. Dependency-ordered children are **wave-gated** (foundation first).
  **Idempotent re-dispatch (#611):** the branch is keyed by the epic **number** — a re-run
  resolves and **reuses** any existing `epic/<NN>-*` (merging `main` in), never minting a
  second slug, so re-dispatching can't spawn sibling epic branches (the #590 failure).
- **Lockfile in sync after a dep change (#614).** A worker that adds/bumps a dependency in
  any `package.json` MUST run `pnpm install` and commit the updated `pnpm-lock.yaml` in the
  same PR — the deploy's `pnpm install --frozen-lockfile` rejects a `package.json` whose
  lockfile wasn't regenerated (`ERR_PNPM_OUTDATED_LOCKFILE`, the #570 → #606 break).
- **Foundation-first, so a slow first leaf can't cost the tree (#612).** The
  `decompose-on-issue` job orchestrates **and** runs the first leaf under one ~30-min budget;
  a heavy leaf (e.g. `crouton init`) can time it out. The orchestrator therefore persists the
  **entire tree** (all sub-issues created+linked + the epic branch pushed) and verifies it
  **before** spawning any worker — the tree is the run's guaranteed deliverable (the
  artifact-gate passes a run that created sub-issues), so a later-timed-out leaf loses only its
  own progress and an idempotent re-dispatch (#611) continues from the intact tree.
- **Epic-scoped approval (#350).** The `packages/` gate also honours the
  `CROUTON_PACKAGE_EDIT_APPROVED` env var (inherited by spawned workers) — approve a
  package-touching epic once, not per worker. The `.package-edit-approved` file must never
  be committed (`guard-package-approval.yml` enforces it).
- **Block, don't improvise (#352).** A worker missing a prerequisite a sibling owns
  **stops** (blocker) — it never scaffolds the missing thing or silently diverges from the
  epic's stated design invariants (which the decomposer passes into the worker prompt).

### Claude-action workflow standard (any `anthropics/claude-code-action` workflow)

When you add or copy a workflow that runs `anthropics/claude-code-action` (the event→agent
glue like `claude.yml` / `decompose-on-issue.yml` / `resume-on-comment.yml`), it MUST carry
all of these by **default** — they're not optional extras; each one has burned us:

- **`id-token: write` at the JOB level.** Job-level `permissions` *fully overrides* (does
  not merge with) the workflow-level block, so a workflow-level `id-token` is silently
  shadowed and the action's OIDC request fails (`Could not fetch an OIDC token`). #284 fixed
  one workflow; the identical bug survived in two siblings until #429. Put it in the job.
- **`anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}`** — a real API key, NEVER a
  subscription `CLAUDE_CODE_OAUTH_TOKEN` (subscription OAuth is interactive-only and
  disallowed for CI — Anthropic Legal & Compliance).
- **`show_full_output: true`** — the full agent log prints inline; debugging a run must not
  require a debug re-run.
- **Pin the action to a SHA, kept in sync** across these workflows (bump them together).
- **The tool-permission grant that matches the workflow's shape (#834/#1036).** Headless CI has
  no human approver, so any tool the prompt makes the *top-level* agent call directly (the
  "act as the subagent + write the verdict / file the issue" shape) is silently **DENIED**
  without a grant: the agent computes the right answer, persists nothing, burns turns on denied
  retries, hits max_turns — and the gate fails **OPEN** as a hollow green. This shipped broken
  in `frontend-review`, `a11y`, `red-team` (fixed #1031/#1033) *and* the loop-station advisor
  (fixed #1037). Two standard forms:
  - **Per-PR verdict gates** (`frontend-review.yml` / `a11y.yml` / `red-team.yml`):
    `--allowedTools Bash,Write,Edit,Read,Grep,Glob` in `claude_args`.
  - **Sweeps/advisors that file issues** (`a11y-daily.yml` / `red-team-daily.yml` /
    `loop-station-advisor.yml`): `--permission-mode bypassPermissions`.
  The `gate-package-edits` PreToolUse hook still guards `packages/` either way. Workflows whose
  prompt only steers the action's built-in GitHub flows (`claude.yml`-style mention glue) don't
  need a grant — if you omit one, say why in a workflow comment.
- **Fail-open must be visible (#1037).** If the workflow is a verdict-gated check, pair the
  `continue-on-error` agent step with `./.github/actions/gate-outage-check` so a no-verdict run
  (billing / max-turns / auth / silent no-write) surfaces as a `::warning::` annotation instead
  of a green indistinguishable from a clean scan.

A new claude-action workflow that omits any of these is treated like a failing build.

### Adding a new agent

Create `<name>.md` with frontmatter + body, keep `tools` minimal (grant `Agent` only to
agents that must spawn others), and register it in this table. If it's part of a tracked
initiative, open the issue first (ISSUE-FIRST).
