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

## Keep it lean

A change that removes the last caller of a symbol, i18n key, or route removes the callee too — or
states why it stays. This is a first-class principle, not a gate: nothing enforces it automatically
yet, so it depends on the person (or agent) making the change actually checking. A translation key
and a route were once left behind after their only caller was deleted, and it was caught only because
a human happened to ask (#2186). Before calling a change done, grep for what it orphaned; if
something's left dangling on purpose, say why.

## Plain language (write for the owner, not the machine)

Every message to the human — a chat reply, a GitHub comment, a handoff — is read fast, on a phone,
by someone who did **not** build the mechanism you're describing. Write for that reader. This is the
*word-choice* layer beneath the *structure* layer (the typed brief, below): pick the type and collapse
the depth, then say the visible part **plainly**.

- **No insider shorthand.** A word that only means something inside this repo — *re-dispatch,
  artifact-gate, the filter converges, the sweep, needs-input* — is noise to the reader. Replace it
  with plain words, or explain it in ≤3 words the first time. If you can't say it without the jargon,
  you don't yet understand it well enough to say it at all.
- **Lead with what they do or get, never the machinery.** "Your list will only show things that
  need you" — not "the filter converges to the genuinely-yours set." Cut any sentence that only
  describes how the plumbing works; the human doesn't operate the plumbing.
- **One decision, ending in a plain choice.** Close an ask with `yes/no` or `A/B` on its own line —
  never a compound, self-referential run-on question. If they have to re-read a sentence, it failed.
- **Numbers are references, not the subject.** Say what changed; *link* the issue/PR number. "#2095
  keeps it that way" tells the reader nothing.

The test: read it aloud as if to someone who has never seen this repo. Any phrase that would make
them ask "what does that mean?" gets rewritten. (This is judgment, like the quality pass — not a
grep for banned words; the same term can be fine in a commit body and wrong to the owner.)

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

**Flow through the stages in order — a capability matures `incubator → launched → shared`, and code
lives at the stage it has *earned*.** The spike proves the idea and produces the spec/handoff; the
**app** is the clean reference built to satisfy it; the **package** is *extracted from the proven
app* as a deliberate third move — not written first and not produced simultaneously with the app.
The trap is inverting it: growing a shared package with a spike's exploratory code, so unproven work
lands in the tier every app inherits. So the rule is **consume vs grow**: a spike (or app) may freely
*consume* an existing shared package, but must not *grow* one — no new shared surface until an app
has proven it and you extract it on purpose. When a spike genuinely needs new capability, build it
**in the app** (`launched`), prove it, then extract to `shared`. (Extraction is real package work —
issue-first, the edit gate, cross-app typecheck — precisely because it's the promotion to the tier
everyone inherits.)

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

## Authoring a gate

The gates above judge other people's work, so a wrong gate is worse than no gate — it refuses correct
code, or waves the broken case through. Two checks, before a gate (or any rule, check or flow step)
merges. Both are **advisory**: apply them where they mean something, not as ceremony.

**Run the rule over the corpus, not just its tests.** Tests prove the rule matches its author's
*imagination*; only the corpus proves it matches the repo. A validator for cross-collection references
passed eight green unit tests and would have refused four shipping schemas, because it compared the
reference against the *configured* name while the reference legitimately names the *generated* one
(#1957). That same scan showed the fall-through branch it was "fixing" was load-bearing for the normal
case — deleting it would have broken every cross-collection reference in the repo. Tests could not have
shown that. The inverse shape is the same lesson: sign-off images were silently gitignored, so every
hold posted a dead link, found by checking the artifact paths against the *real* ignore file (#1933).
So: before merging, run the proposed rule over every file it would judge and report the hit count. Each
refusal of existing code is then a claim to defend file by file. Skip it when there is no meaningful
corpus (a rule over one generated file) — an empty corpus run proves nothing either way.

**Ask of every step: can this path exit 0 having done nothing?** The most common defect here is not a
crash but a **silent no-op** — an operation that succeeds, does nothing, and reports nothing. Three in
one session: adding a file on an ignored path (exits 0, adds nothing — every sign-off dropped its
image, #1933); adding a label an issue already carries (fires no event, so the listener never woke,
#1750); filtering a list by the very field being reported on (records missing it vanished, and the
report cheerfully said "none", #1953). Each exits 0, each produces a plausible-looking result, and
**none is visible in the run's own output** — you find it later by noticing an absence, which is the
expensive way. So pair the question with a second one: *what in the output would prove it acted?* And
where an operation can no-op, **assert the effect** rather than assume it — check the artifact is
committable rather than trusting the write; remove-then-add rather than hoping the event fires.
(No detector is proposed: a shell exit code, an API semantic and an array filter share no syntax. The
value is in the question being asked.)

## Deciding vs asking

The sign-off gates above are *pre-declared* decision points. Most forks aren't those — they surface
mid-work, and both extremes are wrong: "assume nothing, ask about everything" stalls an owner holding
many async threads; "never ask" ships a confident wrong guess. So the rule is neither. **Ask only when
all three hold:**

1. **Irreversible or expensive** to undo — a destructive / data-migrating / publishing act, not
   something a later commit quietly corrects.
2. **Not derivable** — the answer isn't in the code, the docs, the conventions, or the issue itself,
   and you've actually looked.
3. **Genuinely the human's** — taste, priority, or product intent; not a mechanical choice that has a
   defensible default.

Fail any one → **decide and log**: make the call, append one dated line to the epic's Decisions log
(append-only, so a later reversal shows as a new line), and keep moving. This replaces a blunt "no
assumptions": the goal isn't to avoid assuming — it's to assume the *derivable and reversible* things
and escalate *only* the rest.

**When you do ask, the ask is async — never a blocking prompt.** An agent may be headless (a CI job,
no terminal), so an in-run "ask the user" call times out or stalls the run — never use one in a
pipeline. Instead post the ask as a comment, `@mention` the owner *only because an action is needed*,
set `blocked`, and stop; the reply resumes a fresh run. Batch open questions into one comment rather
than dripping pings. (The comment's *shape* — a scannable, recommendation-first handoff — is its own
concern.)

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
(`option → ❌ why not`) stops future-us re-litigating it. That note is authoring-time; the calls made
*mid-work* go in the epic's running **Decisions log** — one dated line (`decision → why → rejected`)
appended *when the call is made*, **append-only so reversals stay visible** (a reversed decision gets a
new line, never an edit — the reversal is the lesson, per *Observe the harness*). It's a habit, not a gate.

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

**An agent comment is a NOTIFICATION — lead with a typed brief, collapse the depth.** The
reader is holding many threads on a phone, so the depth arriving *as* the ping makes every one
cost a full read. One line saying which of **🔴 issue · 💡 proposal · ✅ done · 🔀 choice ·
🛠 action · 👀 review** this is, one line saying what they must do, one link — then everything
else inside `<details>`. **The depth is never cut, only moved**: if collapsing weren't a real
escape hatch, agents would delete content instead, which is worse than the wall. A comment with
no next action isn't ready to post — work out what you're asking for first.

**And the inverse: a type that needs nothing back must not @mention.** A mention is a request
for action; spending one on an FYI teaches the reader to ignore mentions, which costs more than
the notification. Beware the silent leak here — a mention notifies from inside a blockquote and
from inside `<details>` too; only code spans and fenced blocks are exempt. So a mandatory
provenance disclaimer naming the account pings on *every* comment unless the handle is
backticked, which is invisible in the rendered text and easily the largest source of false
notifications.

## Commits

`<type>(<scope>): <subject>` — `feat|fix|refactor|docs|test|chore|perf|style`; scopes are the stack
adapter's components. Subject <~72 chars, explain *why*. Body keeps the 👤/🤖 split. Never batch
unrelated changes; never stage indiscriminately — stage per intent. Run doc-sync + type/lint checks first.

**Merge policy — preserve curated commits.** Optimise history for an agent doing archaeology later
(`blame`→why; `bisect`→small diff). Merge/rebase preserving commits; **don't squash** by default —
only when a PR's own history is noisy (`wip`/`oops`). Every commit on trunk: atomic, green,
single-concern, real "why". One PR = one coherent change set.

**Merging a stack: retarget before `--delete-branch`.** GitHub **auto-closes** (doesn't retarget) a
PR whose base branch gets deleted. Before merging a stacked PR's base with `--delete-branch`,
retarget each dependent PR onto the surviving integration branch first — or merge deepest-first so
each merge carries the stack forward. (Incident: epic #1303, 2026-07-10 — merging #1330 with
`--delete-branch` auto-closed #1344 and #1353, which were based on its branch; both survived only
because stacked branches carry their ancestors' commits.)

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

**Reproduce against the running system — don't push a runtime fix blind.** For a *runtime* bug (a
reload loop, a 500, a broken interaction), boot the thing locally and reproduce it — then verify the
fix locally — *before* shipping. But verification has a **fidelity ladder** — `typecheck/unit →
local dev → the deployed environment (real build, real data) → the end-user's actual device` — and
each rung catches a class the ones below cannot: a local run can't see deploy-only state (a remote DB,
a seed that never ran) or a production-build regression, and no headless engine substitutes for the
user's real browser (a WebKit/iOS crash a local Chromium won't reproduce). So **"works" must name its
rung** — a claim is only as strong as the highest rung you actually exercised, and "green locally" is
necessary, not sufficient, for "works deployed." "I can't test this here" is a **hypothesis to probe**,
not a fact: a claimed limitation (no browser, no local run, no CLI, no network to the deploy) is almost
always narrower than it sounds — and when that limitation is exactly what blocks you from the rung that
matters, the move is to **fix the limitation** (it is often a single setting) rather than design around
it with a lossy workaround. The anti-pattern is pushing an unverified guess and waiting on a slow deploy
to learn it was wrong — every blind push burns a deploy cycle and erodes trust; one reproduction at the
right rung usually finds it in minutes. Instrument, then observe — the mechanism, not a theory.
(Stack-specific how-to lives in the stack adapter's run-and-operate runbook.)

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
