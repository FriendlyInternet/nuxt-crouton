# AGENTS.md — the portable method

The **stack-neutral constitution**: how we work, independent of what we build with. This is the
**Method** layer (epic #952). The **stack adapter** — framework/DB/host/UI specifics and the tools
that implement these gates — is `CLAUDE.md`. A team on another stack keeps this file, swaps that one.

> Layers: **Method** (this file) · **Stage-profile** (`harness.config.mjs`) · **Stack-adapter**
> (`CLAUDE.md`). Skills/agents carry a `layer:` tag — `node scripts/harness-layers.mjs`.

## Working style

Clarity over ceremony. Start simple; add complexity only when proven necessary (KISS). Reuse before
building — check the ecosystem first. Wrap async work in error handling, return `{ data, error }`.
Write general-purpose solutions, not ones fitted to the example. Match the surrounding code's idiom.

## The loop

`issue-first → decompose → stage-gated work → sign-off gates → commit → observe → retro`

1. **Issue-first (HARD GATE)** — open the tracking issue (epic + sub-issues if multi-step) *before*
   writing code. A missing issue is a failing build. The issue is the unit of work.
2. **Decompose** — an initiative → an epic + a tree of single-coherent-change sub-issues.
3. **Stage-gated work** — which gates fire depends on the work's **stage** (below).
4. **Sign-off gates** — get a human to sign off on the *right thing* before anything expensive.
5. **Commit** — small, atomic, conventional.
6. **Land via a PR** (`Closes #NN`), never a direct push to trunk.
7. **Observe + retro** — measure the harness; postmortem at epic close.

## Stages

A **declared** concept, not a hardcoded folder name. `harness.config.mjs` maps each stage to its
paths, the gates that fire, its deploy target, and whether edits are guarded. Resolve with
`node scripts/harness-stages.mjs <path>` (or `stageForPath`/`gateMode`) — don't match folders by hand.

Default profile (rename/repoint in that one file — e.g. `poc`→`spike` for scrum; gates travel with
the stage, not the name):

- **incubator** (`poc`/`spike`) — safe-to-fail; no required gates; preview deploys.
- **launched** (`app`) — real apps; test-first opt-in; staging deploys.
- **shared** (`package`) — many consumers inherit it; test-first required; edits guarded.

Edit-guarded stages need explicit, scoped approval before a change (granted once per initiative,
never committed).

## Sign-off gates

A probabilistic runtime needs gates where a human should decide. A gate proposes the right thing and
**holds** before the expensive step. Pick by *what the change is*:

- **Schema** — agree the data model before generating from it.
- **UI** — agree the look (preview or mockup) before building.
- **Test** — agree a committed *failing* test as the contract before writing the logic. Done = it passes.
- **Code review** — the diff, for correctness + simplification.

One shared loop: hold on a `blocked` status; the **only** resume signal is a reply comment containing
`lgtm`/`approve` — not a reaction, not a label. Anything else is a change request. When unsure a diff
is in scope, don't gate.

**Done is signed off, not asserted.** A unit of work is "done" only when the thing it promised is
*checked and concretely signed off* — never on a proxy. A green build, a passing typecheck, a deploy
URL, the agent's own confidence: every one of those can be true while the work is wrong (each lied
during a real graduation, #988). So status is **derived from a recorded sign-off**, not self-asserted:
no `lgtm`, not done. Where the work has an enumerable contract (a behaviour spec, an acceptance list),
"done" is *per entry* — each one checked and signed, not the set waved through at once. And the verdict
comes from **comparison against the expected result**, not from re-reading the list: a list can't
reveal its own gaps; running the real thing next to the contract can.

## Issues — the unit of work

- **Search before creating** — sessions are ephemeral; continue an existing epic, don't duplicate.
- **Map every issue to a real component**, never "root". One `type:*`; an epic carries `epic`. Add a
  new component's label when you add the component.
- **Status the moment you start** (`in-progress`), `blocked` when waiting, drop on close.
- **Recurring chores are standalone**, never sub-issues of a deliverable epic (a never-closing child
  pins the epic open forever).

**Write as a hypothesis** (default; trivial chores opt out) — open the body with `## Hypothesis`:
*We think that* if X then Y · *We'll do that by* … · *We'll be right if* … · *We'll know by* …

**Record what you didn't do** — when alternatives were real, a `Considered & rejected` note
(`option → ❌ why not`) stops future-us re-litigating it.

**Two audiences**, in this order: **👤 humans** lead — plain language, what changed + why it matters
(a diagram only if it clarifies); **🤖 agents** — scope, exact paths/symbols, behaviour, acceptance,
links. (Same split in PRs and commit bodies.)

**`## 🧪 How to test`** on every closeable issue/PR — for someone who knows the concept, not the
code: what changed, the concrete surface, numbered steps with before/after, test data. It's the
acceptance check.

**The epic is the verification unit.** When the last child merges, post one `## 🧪 Verify the whole
thing` rollup, **walk up the tree** (a parent never auto-closes), run the postmortem, close on
confirmation. Human-action tasks are discrete **assigned** issues closed by a confirming comment.

**Agent comments carry provenance** — posted under a *human* account, disclaim it
(`> 🤖 **<tool>** · … · posted from <account> (not <human>) · _<context>_`); under a *bot* account,
just name the source. **Link issues/PRs** as full URLs in chat (bare `#NN` isn't clickable).

## Commits

`<type>(<scope>): <subject>` — `feat|fix|refactor|docs|test|chore|perf|style`; scopes are the stack
adapter's components. Subject <~72 chars, explain *why*. Body keeps the 👤/🤖 split. Never batch
unrelated changes; never stage indiscriminately — stage per intent. Run doc-sync + type/lint checks first.

**Merge policy — preserve curated commits.** Optimise history for an agent doing archaeology later
(`blame`→why; `bisect`→small diff). Merge/rebase preserving commits; **don't squash** by default —
only when a PR's own history is noisy (`wip`/`oops`). Every commit on trunk: atomic, green,
single-concern, real "why". One PR = one coherent change set.

## Decomposition pipeline (agents)

One task → a tree of agent-worked issues: an **orchestrator** fans the epic into sub-issues; a
**decomposer** recursively applies a *leaf test* (single change · bounded files · testable acceptance
· one focused run) — leaf ⇒ spawn a **worker**, too big ⇒ split + recurse; a **worker** does one leaf
on an isolated branch → PR. Hard depth/fan-out caps. Invariants: GitHub is the source of truth;
spawned agents are **synchronous** (no fire-and-forget); hand off by **spawning**, not labeling; a
block comment is a self-contained handoff; verify an artifact exists before reporting it done.

## Bug work — archaeology first (HARD GATE)

The moment a bug/regression/broken build is reported, step 0 is to find **how & when it was
introduced** (`git log -S`/`-G`, `blame`, `bisect`) — or rule it a non-code cause (stale install,
env, data) — and **record that** on the issue *before* fixing. A symptom-first fix can "repair" code
that was never broken.

## Observe the harness

Treat the harness as a system worth measuring: its always-on context budget (size, redundancy, split
by layer) and how the loops actually ran. At epic close, **postmortem** (went well / was hard, with
evidence / 1–3 proposals) and mint accepted proposals as tracked tasks. This is how the loop tightens.

**The evidence bar for claiming a result** (internally or publicly): one mechanism must explain *all*
observations — including the negatives — and survive an adversarial attempt to refute it; the
hypothesis states its numbers *before* the run (the issue's "We'll know by", made quantitative); and
negative results are first-class data — record the reversal and extract the rule, don't delete it.
A claim that ignores its own counter-evidence is the proxy-for-done failure wearing a lab coat.

## Maintaining this method

Changing a skill/agent/gate → keep this file + the stack adapter in sync and the `layer:` tags honest.
Keep this file **stack-neutral**: a framework/DB/host/UI noun here belongs in the stack adapter instead.
