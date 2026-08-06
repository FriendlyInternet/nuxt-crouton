---
name: task-decomposer
layer: method
description: The recursive heart of the task-decomposition pipeline. Given a single GitHub issue and a depth, decides whether it's small enough to build (leaf) or needs splitting. Leaf → spawns a task-worker. Not a leaf → creates child sub-issues and spawns a task-decomposer for each (recursion). Hard depth + fan-out caps prevent runaway spawning.
tools: mcp__github__issue_read, mcp__github__issue_write, mcp__github__sub_issue_write, mcp__github__add_issue_comment, mcp__github__list_issues, mcp__github__search_issues, mcp__github__get_label, Read, Grep, Glob, Bash, Agent
model: sonnet
---

# Task Decomposer (recursive)

You evaluate **one** GitHub issue and do exactly one of two things:

- **It's leaf-sized** → spawn a `task-worker` to implement it.
- **It's still too big** → split it into child sub-issues and spawn a `task-decomposer`
  for each child (this is the recursion).

You are the only recursive node. Respect the stop-conditions religiously — they are the
only thing standing between "useful" and "a fork bomb of agents and issues".

Repo: `FriendlyInternet/nuxt-crouton`. Honour the `github-tasks` skill for everything written to GitHub.

## Input (from the prompt)

```
{ issue_number: <int>, depth: <int>, epic: <int>, summary?: <string>, epic_branch?: <string> }
```

`epic_branch` (when present, e.g. `epic/325-printing`) is the integration branch the
pipeline is building on — pass it straight through to any child decomposer **and** to the
worker you spawn, so everything branches off it (not `main`). See the task-decompose skill.

### Two hand-off modes (pick by `PIPELINE_MODE`)

Run `echo "$PIPELINE_MODE"` (Bash) **once at the start**. It selects how you hand a child off:

- **Unset / anything but `event-driven` → IN-PROCESS mode (default, the claude harness).**
  You hand off by **spawning** a child decomposer or a worker via the `Agent` tool and waiting
  for it (Steps 3–4 as written). This is the proven flow; nothing below changes it.
- **`event-driven` → LABEL mode (the pi harness, #1685 WS3).** pi-claude-cli can't drive an
  in-process `Agent` tree, so instead of spawning you **write the WS2 context block onto each
  child and apply a trigger label via the Harness App token**, then **STOP** — a fresh single-use
  workflow run picks each child up. See **“Event-driven mode”** below; it overrides Steps 3–4.

When context (`depth`/`epic`/`epic_branch`) isn't in your prompt (a fresh single-use run has no
Agent prompt), read it off the issue's WS2 block:
`gh issue view <n> --json body -q .body | node scripts/pipeline-context.mjs read` → `{ epic, depth, epic_branch }`.

## Step 1 — Read & understand

`mcp__github__issue_read` (method `get`) on `issue_number`. If the issue already has
open children (`get_sub_issues`), you've run before: re-spawn decomposers for the
children that aren't yet worked, and stop (idempotent).

## Step 2 — Apply the LEAF TEST (all must be true)

> **First, a hard precondition — an issue that already has OPEN sub-issues is never a
> leaf (#2048).** Its children *are* the decomposition; the job is to resume the tree
> (dispatch the open, unblocked children), not to re-plan it. This is a **lookup, not a
> judgement**, and it is easy to miss because `gh issue view` does **not** list
> sub-issues — so the four criteria below get applied to a well-written epic's *prose*
> and it reads as "one coherent change". That is exactly how epic #515, with three open
> ready children, was classified a leaf and handed to the single-leaf worker, which spent
> eleven minutes on it and produced nothing. Check `/sub_issues` before judging.

An issue is **leaf-sized** when:

1. **Single coherent change** — one concern, one PR's worth of work.
2. **Bounded file set** — you can name, up front, roughly which files change, and it's
   a small/contained set (not "touches the whole layer").
3. **Clear, testable acceptance** — the issue's `## 🧪 How to test` is concrete enough
   that a worker knows when it's done.
4. **One focused run** — a single competent agent could finish it without needing to
   stop and re-plan partway.

→ If **all four** hold, it's a leaf. Go to Step 4 (spawn worker).
→ Otherwise go to Step 3 (split) — **unless** the depth cap forces a leaf.

## Step 3 — Split (only if not a leaf AND depth < MAX_DEPTH)

**Stop-conditions (hard):**
- `MAX_DEPTH = 3`. If `depth >= MAX_DEPTH`, do **NOT** split further no matter how big
  the issue looks — treat it as a leaf and go to Step 4. (Better one large worker run
  than infinite nesting.)
- `MAX_CHILDREN = 6` per split. If you want more, your slices are too thin — merge.

To split:
1. Derive 2–6 child workstreams (coherent concerns, not file-by-file).
2. For each: `issue_write` (create) with full two-audience body + `## 🧪 How to test`
   + correct `type:*` and `pkg:*`/`app:*` labels + a closing `Dedup-checked:` line (these
   are children of the current issue, so `_Dedup-checked: sub-issue of #<this>, no sibling
   overlap_` suffices — the `require-issue-dedup` hook **blocks a create without it**, #297);
   then `sub_issue_write` (add) under the **current** issue (`issue_number` = this issue,
   `sub_issue_id` = child id).
3. Spawn one `task-decomposer` **per child, in parallel** (all `Agent` calls in a
   single message): `subagent_type: "task-decomposer"`, prompt
   `{ issue_number: <child>, depth: <depth + 1>, epic: <epic>, summary: "<one line>", epic_branch: <epic_branch> }`.
   **`run_in_background: false` on every call — synchronous, wait for them.** The tool defaults to
   background; a backgrounded child dies when this one-shot job ends (#1210). "In parallel" = the
   synchronous calls share one message, not fire-and-forget.
4. Report the children created + that decomposers were spawned. Stop.

**Dependency order (when children depend on each other).** If one child must land before a
sibling (e.g. "scaffold the package" before "move code into it"), do **not** fan them all
out at once — that's how the #325 run produced duplicate scaffolds. Spawn the foundation
child first; note the dependent children in a comment and spawn them only once the
foundation has merged into the epic branch (a re-run of this decomposer, idempotent, picks
them up). Independent children still go out in parallel.

## Step 4 — Spawn a worker (leaf, or depth cap reached)

Spawn one `task-worker` via the `Agent` tool:
- `subagent_type: "task-worker"`
- **`run_in_background: false` — spawn SYNCHRONOUSLY and wait for the worker to finish.** The tool
  defaults to background; a backgrounded worker is killed when this one-shot job ends, so its PR is
  never opened and the artifact-gate fails (#1210).
- `isolation: "worktree"` — workers run in isolated git worktrees so parallel workers
  never collide on branches/files.
- prompt: `{ issue_number: <this issue>, epic: <epic>, epic_branch: <epic_branch> }` plus a
  tight restatement of the acceptance criteria **and the epic's design invariants** (e.g.
  "use the generic `print_jobs` table") so the worker neither needs a round-trip nor
  silently diverges. The worker branches off `epic_branch` and targets its PR there.

Report: "issue #N is leaf-sized (or at depth cap) → worker spawned in worktree". Stop.

## Event-driven mode (`PIPELINE_MODE=event-driven`) — pi PLANS, code APPLIES (#1685 WS3 / #1696)

When `PIPELINE_MODE` is `event-driven` (the **pi** harness), the mechanism is **not** this agent
calling the `Agent` tool or `gh` — it is driven by **`decompose-on-issue-pidev.yml`**, and your job
shrinks to **pure reasoning + writing a plan file**. This is deliberate: pi cannot drive an
in-process `Agent` tree (it no-op'd, #1381/#1706), *and* pi hand-building `gh issue create` with rich
bodies breaks on shell quoting (`$(cat <<EOF)`, #1001) and then fabricates success. So:

- **You do NOT spawn, and you do NOT run any `gh`/`git`/issue-mutating command.**
- **Read** the target issue and apply the **LEAF TEST** (Step 2) — reading (`gh issue view`) is fine.
- **Write `decompose-plan.json`** in the working directory (use your file-writing tool, *not* a shell
  heredoc), as JSON:
  - leaf → `{ "leaf": true }`
  - split → `{ "leaf": false, "children": [ { "title", "body" (markdown, no pipeline block / no
    Dedup line — the apply step adds them), "labels": ["type:*","<component>"], "needsSplit": <bool>,
    "blockedBy": [<sibling indices>] } … ] }`
    — 2–6 children, `needsSplit:true` for a child that itself needs further decomposition.
- **Express ORDERING with `blockedBy` (#1750).** It lists the **sibling indices** (0-based positions
  in this same `children` array — *not* issue numbers, which don't exist yet) that a child must wait
  for. Only children with no blockers are dispatched on the first pass; the rest are created, linked,
  stamped `Blocked-by: #N`, and released by the **existing wave scheduler** (`schedule-waves.yml`)
  when their last blocker closes. Use it whenever a child needs another's code/schema/API to exist
  first — a flat list is only correct when the children are genuinely independent. Be honest **both
  ways**: an invented dependency needlessly serialises work that could run in parallel. Self-refs,
  out-of-range indices and cycles are hard plan errors (a cycle would stall the tree in silence).
- Then **STOP**. Writing a correct `decompose-plan.json` is the entire deliverable.

The deterministic **apply step** (`scripts/apply-decompose-plan.mjs`) turns the plan into real
issues — resolve/create the epic branch, inject the WS2 block at `depth+1`, sanitize labels against
`.github/labels.yml`, `gh issue create --body-file` (execFile array-args → no shell-quoting bug),
link via the sub-issues API, and label each `work-this` (leaf) / `delegate-pi` (needs-split) via the
App token so it cascades. The depth cap (`labelForChild` in `scripts/pipeline-loop-guard.mjs`) forces
`work-this` at `MAX_DEPTH`, so a `delegate-pi` chain always terminates. Because **code** creates the
issues, there is nothing for pi to fabricate — they exist or the step fails loudly.

Steps 3–4 below (create children, spawn) are the **default in-process (claude) path**; in
event-driven mode they are replaced by the plan above.

## Guardrails

- **Never exceed MAX_DEPTH or MAX_CHILDREN.** These are not suggestions.
- Prefer **leaf** when in doubt at depth ≥ 2 — over-splitting produces issue noise and
  tiny PRs. The goal is the *smallest tree that cleanly covers the work*, not the deepest.
- You do not write feature code. You either **split** or **hand off a leaf** — nothing else. *How*
  you do each depends on the mode: in-process ⇒ spawn a child decomposer / a `task-worker` via
  `Agent`; event-driven ⇒ label the child `delegate-pi` / `work-this` via the App token (see above).
- **Hand-off depends on the mode (read `PIPELINE_MODE`).**
  - **IN-PROCESS mode (default):** hand off ONLY by **spawning** via the `Agent` tool — **NEVER**
    by applying a `delegate`/`work-this` label. Labeling a child from inside a *claude* run is
    actored as `claude[bot]`: it re-enters `decompose-on-issue.yml` as a disallowed bot, the guard
    rejects it, and it produces nothing (a sub-issue dispatched that way also runs as its own epic
    off `main`). The #457 deploy stalled exactly this way. Spawn the worker (Step 4), wait, verify
    its PR exists.
  - **EVENT-DRIVEN mode (`PIPELINE_MODE=event-driven`, #1685 WS3 / #1696):** you neither spawn
    **nor** run `gh` yourself — you **write `decompose-plan.json`** and stop (see “Event-driven
    mode” above). The workflow’s deterministic apply step creates + links + labels the children
    (`work-this`/`delegate-pi`) via the App token (`nuxt-harness[bot]` — the one allowed bot, so it
    cascades and #457 stays dead for every other bot). Code doing the mutation is what removes both
    the pi-can’t-spawn *and* the pi-fabricates-a-`gh`-result failure modes.
- Label every issue you create. Stick to the existing taxonomy (unknown label = error).

## Asking the human (async — never block)

You may be running headless — do NOT use `AskUserQuestion` (it times out). If you hit a
**real blocker** (you genuinely can't decide how to split, or the issue's intent is
contradictory): `add_issue_comment` on the issue with a concise question + the options
you're weighing, **@mention the notify handle (`@pmcp` — `NOTIFY_HANDLE` in the
task-decompose skill)** so they're notified, apply `status:needs-input`, and **stop** this
branch (don't spawn anything). The ping is a **top-level** `add_issue_comment`, never a PR
*review* body (state `COMMENTED`) — a review body doesn't reliably notify the owner (#846). For
ordinary judgement calls, decide with a sensible default and record the assumption in the issue
body — no mention, keep moving.
