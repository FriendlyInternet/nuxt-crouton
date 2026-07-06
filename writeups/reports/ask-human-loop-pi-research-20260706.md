# WS1 research — the ask-the-human loop: Pi HITL + Claude Code native (async fleet)

**Date:** 2026-07-06
**Issue:** [#1183](https://github.com/FriendlyInternet/nuxt-crouton/issues/1183) (WS1 of epic [#1182](https://github.com/FriendlyInternet/nuxt-crouton/issues/1182))
**Extends:** [#639](https://github.com/FriendlyInternet/nuxt-crouton/issues/639) (self-contained handoff + push-before-block; `resume-on-comment.yml`)
**Status:** Research note — feeds the WS2–WS5 breakdown. Not code.

---

## TL;DR (read this if nothing else)

1. **Our default harness is Claude Code + GitHub Actions, not Pi.** Pi (`pi.dev` /
   `earendil-works/pi`) is **wired, proven on the mac-mini, and dormant by design** — it runs
   only behind the `delegate-pi` label / `AGENT_HARNESS=pi` and a funded `PI_PROVIDER_KEY`
   (`decompose-on-issue-pidev.yml`). The WS1 premise "*Pi is already our harness*" is **half
   true**: Pi is a proven opt-in *twin* of the Claude pipeline, not the thing running most runs
   today.
2. **Both harnesses run the same way for this epic's purposes: HEADLESS, as GitHub Actions
   jobs.** Even Pi runs as `pi --print` inside a 30-min CI job — there is **no human at a
   terminal**. So Pi's marquee HITL primitives (mid-run steering, `pi-ask-user`, permission
   gates, plan mode) are **not available to us in production** — in fact we *actively suppress*
   them: the pi job's prompt says "NEVER pause, ask a question, or invoke `pi-ask-user`"
   (#1019, after pi stalled-and-asked headless on #839).
3. **Therefore the ask-the-human loop must live GitHub-side, harness-agnostic** — exactly where
   #639 already put it. Pi's synchronous, terminal-bound HITL model does **not** translate to
   our async-comment loop. The one place a Pi (or Claude) *extension* earns its keep is
   **emitting** a better-shaped handoff artifact deterministically, so the "ask" doesn't depend
   on prompt discipline.
4. **Net verdict across WS2–WS5: build GitHub-side (convention + one skill + a small
   `resume-on-comment.yml` extension). Almost nothing is a Pi extension; almost nothing is new
   infrastructure.** This matches how #639 landed and what epic #1182 already predicts.

**Success metric (the epic's "We'll know by", quantified):** see [§6](#6-the-quantified-success-metric).

---

## 1. Harness topology — who runs where, and how the loop spans them

Three execution surfaces touch our agent work. Only the first two write code autonomously; the
third is where *this very note* is being written.

| Surface | What it is | HITL model | Runs which agents |
|---|---|---|---|
| **Claude Code + GitHub Actions** (default) | `anthropics/claude-code-action` invoked by `claude.yml`, `decompose-on-issue.yml`, `resume-on-comment.yml`, `fix-ci-on-failure.yml`, the review/a11y/red-team gates. Runs on `ubuntu-latest` **or** the self-hosted `mac-mini` box via the `vars.AGENT_RUNNER` toggle. | **Headless.** No terminal. Human-in-the-loop is *async GitHub comments* only. | orchestrator → decomposer → worker pipeline; the per-PR review gates; resume-on-comment. |
| **Pi on the mac-mini** (dormant twin) | `@earendil-works/pi-coding-agent` invoked as `pi --print --provider anthropic --model … --skill .claude/skills` by `decompose-on-issue-pidev.yml`. Same self-hosted `[self-hosted, mac-mini]` box (proven live by `mac-mini-smoke.yml`, epic #610/#653). | **Headless too, in our deployment.** `--print` is non-interactive; the run is a 30-min CI job. Pi's *interactive* HITL is unused (and explicitly forbidden — #1019). | The same orchestrator→decomposer→worker pipeline, one-model, gated behind `delegate-pi`/`AGENT_HARNESS=pi` + a funded key. |
| **Claude Code on the web / claude-code-remote** (interactive) | `code.claude.com` sessions — a human kicks off a session that has the repo, tools, MCP, and can push + open PRs. **This session is one.** | **Interactive-ish** (a human is present, can steer in-session) **but the durable loop is still GitHub** — the session ends; continuity is the issue/PR. | Ad-hoc / owner-driven work (like this WS1). Feeds the same issues + PRs. |

**How the loop spans them.** The **async ask-the-human loop is entirely GitHub-side and
harness-agnostic**: an agent (Claude *or* Pi, headless *or* interactive) hits a fork it can't
own → posts the #639 handoff comment, `@mentions @pmcp`, sets `status:blocked`, pushes its
branch, and stops. Hours later the owner replies from their phone. `resume-on-comment.yml` fires
on that reply and spawns a **fresh** `claude-code-action` run that reads the thread and
continues. The resuming run does **not** care which harness blocked — it reads the branch + the
handoff comment. That harness-agnosticism is the property to preserve.

**One nuance worth stating loudly:** the mac-mini is a **GitHub Actions self-hosted runner**, not
a persistent Pi TUI someone sits at. When we say "Pi runs on the mac-mini," we mean *a CI job on
the mac-mini shells out to `pi --print`*. There is no standing terminal for a human to steer.

**Historical note (avoid a stale premise):** the June 2026 decision brief
(`writeups/architecture/agent-orchestration-architecture.md`) explicitly chose "**rent the
orchestration, own the agents**" — Claude Code + GitHub as the runner — and **retired** the
earlier pi.dev-based `thinkgraph-worker` (Raspberry-Pi + Cloudflare Tunnel) as *live infra*,
keeping it only as a self-host escape hatch (`writeups/setup/self-hosted-pi-agent-cloudflare-setup.md`).
Pi was then re-introduced (epic #669) as the *dormant, provable twin* it is today — not a
reversal of that decision, but a hedge that keeps the platform choice reversible.

---

## 2. Pi's HITL / extension primitives — inventory

**Evidence provenance** (kept honest per `AGENTS.md`'s evidence bar):
- **[repo]** = observed on *our* mac-mini and pinned in the codebase
  (`writeups/architecture/pi-telemetry-schema.md`, real pi 0.80.2; `decompose-on-issue-pidev.yml`
  facts marked "verified on the mac-mini").
- **[docs]** = quoted from Pi's in-repo docs (`earendil-works/pi` → `packages/coding-agent/docs/*.md`)
  and `tintinweb/pi-subagents` / `edlsh/pi-ask-user` READMEs, fetched 2026-07-06.
- **Reachability gaps (honest):** `pi.dev/docs` returned **HTTP 403**; **mariozechner.at** was
  unreachable (search down), so Mario Zechner's own writeups are **unverified**; the Pragmatic
  Engineer piece ("Building Pi, and what makes self-modifying software so fascinating," 2026-04-29)
  was located but **its body was not mined** — treat as a pointer. The GitHub landing README /
  `examples/` weren't extractable; the `docs/` tree carried the substance.

**What Pi is.** A terminal (TUI) coding agent, `@earendil-works/pi-coding-agent` (earlier
`@mariozechner/pi-coding-agent`), by Mario Zechner — provider-agnostic (Anthropic / OpenAI-compatible
/ local via a `ModelRegistry`). **[repo]** Its design thesis (the key finding): **a deliberately
minimal core + everything-is-a-TypeScript-extension.**

### The headline correction — Pi core ships almost none of the HITL features by design
`usage.md` states Pi *"intentionally does not include built-in MCP, sub-agents, permission popups,
plan mode, to-dos, or background bash"* — **you build them as extensions.** **[docs]** So the WS1
brief's framing ("permission gates / plan mode / sub-agents") describes things that in Pi are
**extension-authored, not core primitives.** The real primitive is the **extension mechanism
itself**; the HITL features are patterns built on it. This is the Pragmatic-Engineer "the strength
is in what they *didn't* build" thesis — and it changes our verdict shape (see §3–§4): what we'd
"build on Pi" is *an extension*, using the same hooks anyone else would.

### Extension model **[docs]**
- **Extensions are TypeScript modules**, loaded via **jiti** (no compile step); entry is a
  default-export factory `export default function (pi: ExtensionAPI) { … }` (sync/async).
- **Auto-discovery:** global `~/.pi/agent/extensions/*.ts`, project-local `.pi/extensions/*.ts`,
  `settings.json` `extensions` paths, or ad-hoc `pi -e ./path.ts`. (Our observed ones — `pi-otel`,
  `@jademind/pi-telemetry`, `pi-subagents`, `plannotator` — are npm-installed instances of this. **[repo]**)
- **The `ExtensionAPI` surface:** register **tools** (`pi.registerTool` — `execute()` returns
  `{ content, details, isError?, terminate? }`), **commands** (`/name`), **keyboard shortcuts**,
  **CLI flags**, **custom renderers**, **providers/models**, and **inject messages**
  (`pi.sendMessage(..., { deliverAs: "steer" | "followUp" | "nextTurn" })`).
- **Skill loading:** `pi --skill <dir>` loads our `.claude/skills` verbatim — *why* skills port
  across harnesses. **[repo]** (`-pidev` workflow, "confirmed on the mac-mini #888".)
- Two facts that matter downstream: a tool's `execute` can return **`terminate: true`** (end the
  run cleanly), and `ctx.mode` ∈ `"tui" | "rpc" | "json" | "print"` with a `ctx.hasUI` boolean —
  **an extension can detect it's headless and branch.** These two are the hook for "*emit a GitHub
  handoff + end the run*" instead of asking (see §4/WS3).

### Mid-run steering / interrupts **[docs]** — confirmed verbatim
Built-in, first-class (not a tool — the core interaction model): **Enter = steering** message,
delivered after the current assistant turn's tool calls; **Alt+Enter = follow-up**, delivered after
all work finishes; **Escape = abort** (restores queued messages); configurable via
`steeringMode`/`followUpMode`. So the brief's Enter/Alt+Enter semantics are exactly right.

### `pi-ask-user` is **not** core — it's a community extension **[docs]**
Core has **no built-in ask-user tool.** An extension surfaces a blocking question from *inside a
tool's `execute`* via `ctx.ui` dialogs — `ctx.ui.input()`, `.confirm()`, `.select()`, `.editor()`
— which pause the run and return the answer without ending the turn. `pi-ask-user` (`edlsh/pi-ask-user`,
`pi install npm:pi-ask-user`) is **one of several** community extensions packaging this as an
LLM-callable `ask_user` tool (others: `ghoseb/pi-askuserquestion`, `jayshah5696/pi-agent-extensions`,
`juicesharp/rpiv-ask-user-question`). **This is the single most important HITL fact for us:** the
ask-user primitive is extension-provided *and* it collapses headless — #1019 forbids invoking it
because pi stalled-and-asked in CI on #839. Its README only promises a *"graceful fallback when
interactive UI is unavailable"* — **the exact headless semantics (block / no-op / error) are
undocumented and unverified.**

### Permission gates / plan mode / path protection — **extension-built, not core** **[docs]**
- `security.md`: Pi ships **no built-in sandbox**; built-in tools read/write/edit files and run
  shell with the pi process's permissions. The one guard is **project trust**, and it only guards
  *input loading* (a repo can't silently change pi's settings/extensions before you approve) — it
  *"does not make untrusted code, prompts, or model output safe."* Isolation is expected at the
  OS/container layer.
- The real **choke point** for a permission gate is the **`tool_call` event**, which is *mutable*
  and can return **`{ block: true, reason }`** to veto a tool call before it runs. So a gate is an
  extension author's job, hooked there. **Plan mode** is likewise an extension — the `plannotator`
  `custom` JSONL line we already harvest is its observable footprint. **[repo]**

### Events / overlays / custom editors **[docs]**
- **Events:** `pi.on("<event>", handler)` over a rich lifecycle — `session_start/shutdown`,
  `before_agent_start`, `agent_start/end`, `turn_start/end`, `message_start/update/end` (end
  mutable), `tool_execution_start/update/end`, **`tool_call`** (mutable, blockable), **`tool_result`**
  (mutable/patchable), `context` (rewrite messages pre-request), `before_provider_request` /
  `after_provider_response`, `input` (`continue|transform|handled`), plus a **custom event bus**
  (`pi.events.on/emit`) used for cross-extension RPC (this is how pi-subagents coordinates).
- **Overlays / custom UI:** `ctx.ui.custom<T>((tui, theme, keybindings, done) => Component, …)`
  renders a full component and **returns structured input `T`**; plus `notify`, `setStatus`,
  `setWidget`, `setFooter`. **Custom editors:** `ctx.ui.setEditorComponent(...)`, autocomplete
  providers, editor text get/set.
- **For us:** overlays/editors are a *local TUI* surface — invisible to a remote async reviewer, so
  they're an **instrumentation / local-driver** primitive, not an *ask* primitive. The **events**
  (especially `tool_call`, `agent_end`, `input`) are the interesting hook: they let an extension
  *detect a block condition and act* (post a comment, terminate) without a human present.

### Sub-agents — `tintinweb/pi-subagents` (community, mature, **not** official) **[docs]+[repo]**
- *"Claude Code-style autonomous sub-agents for pi."* ~572★, v0.13.0 (2026-06-30), MIT — real and
  maintained, but a third-party extension (core ships none). Provides parallel background agents
  (default concurrency 4, queued), foreground blocking agents, a `steer_subagent` tool
  (*"interrupts after the current tool execution"*), and **custom agent types** in
  `.pi/agents/<name>.md` (frontmatter: model, thinking level, tool allow/deny, memory scope,
  git-worktree isolation).
- Each run writes `subagent-artifacts/<runId>_<agent>_<idx>_meta.json` with per-worker
  `cost`/`turns`/`exitCode`/`model`/`durationMs`/`toolCount`, roles like `worker`/`planner`. **[repo]**
  Our pi pipeline uses it to reproduce the orchestrator/decomposer/worker fan-out.
- Relevant to *how work fans out*, **orthogonal to the ask-the-human loop.**

### Headless behaviour (the crux) **[repo]+[docs]**
- `pi --print` = *"print response and exit"*, non-interactive; `ctx.mode === "print"`,
  `ctx.hasUI === false`. No TUI, no key bindings, **no way to answer a `ctx.ui` dialog / `ask_user`.**
- The only safety bound is the job `timeout-minutes` (**no `--max-turns`**, #1004); the whole
  pipeline runs on **one `--model`** (no per-role tiering, #1004).
- **Consequence:** every Pi HITL primitive that needs a live human — steering, `ctx.ui` dialogs,
  `ask_user`, an overlay, a `tool_call` gate that *waits* — collapses in our deployment. What
  survives and is *useful* is the **extension mechanism** (tools, events, `ctx.mode` branching,
  `terminate:true`): we could use it to **emit** a handoff and end the run, never to **hold** for a
  human. That single distinction drives §3–§4.

---

## 3. The core reconciliation — synchronous terminal vs async comment

Pi's HITL is built for **a human at the terminal steering a live run**. Ours is **an owner
replying to a GitHub comment hours later, resumed by a fresh process with zero in-run memory.**
These are not the same loop, and most of Pi's HITL surface does not cross the gap:

| Pi primitive (synchronous) | Translates to our async loop? | Why / what we use instead |
|---|---|---|
| **Mid-run steering** (Enter interrupts; Alt+Enter queues) | ❌ No | No live terminal in CI. The equivalent is: block → **end the run** → resume as a fresh run on the owner's reply (`resume-on-comment.yml`). We *cannot* keep the run alive for hours. |
| **`pi-ask-user`** (ask + wait mid-run) | ❌ No — actively **forbidden** | Headless, it stalls the job (#839). #1019 front-loads "never invoke `pi-ask-user`". Our "ask" is a GitHub comment, not an in-run tool call. |
| **Permission gates / path protection** (extension-built via the `tool_call` `{block:true}` hook — *not* core) | ⚠️ Partial — as *policy*, not *prompt* | We already enforce it deterministically GitHub/hook-side (the `packages/` edit hook, the sign-off gates, the `.github/workflows` App-token scope block #1076). A Pi `tool_call` gate that *pauses for a human* can't pause in CI — but the same hook could instead **emit a handoff + `terminate:true`**, which is exactly our #639 flow. |
| **Plan mode** (extension-built; `plannotator` — *not* core) | ✅ Conceptually — already ours | This *is* our schema/UI/test/plan sign-off gates: hold on `status:blocked`, resume on `lgtm`. It lives GitHub-side, works for both harnesses. |
| **Events / overlays / custom `customType` lines** | ⚠️ Split — events *yes*, overlays *no* | The **events** (`tool_call`, `agent_end`, `input`) are usable headless — an extension can detect a block condition and act. **Overlays** are a *local TUI* surface no remote human sees. And the `custom` JSONL we already harvest (#944) is **telemetry**, not interaction. |
| **Sub-agents** (`tintinweb/pi-subagents`) | ➖ Orthogonal | Parallel-exec + custom agent types ≈ our orchestrator/decomposer/worker. Relevant to *how work fans out*, not to *how we ask the human*. |

**The reconciliation, in one line:** Pi gives us excellent *synchronous* HITL for the day someone
sits at the mac-mini and drives a run by hand — but our fleet is **headless + async**, so the
ask-the-human loop belongs **GitHub-side**, and Pi's role is (a) to *execute* runs and (b),
optionally, to *emit the handoff artifact deterministically* via an extension so we stop relying
on prompt discipline.

---

## 4. WS2–WS5 — build-here verdicts

For each downstream workstream: **Pi extension** vs **GitHub-side** vs **already-covered**.

### WS2 — Decide-vs-ask rule → `AGENTS.md`
**Verdict: GitHub-side / method-layer (a doc rule). Not a Pi extension.**
The 3-part test (ask only when **irreversible/expensive** ∧ **not derivable** from
code/docs/conventions ∧ **genuinely the human's** — taste/priority/product-intent) is a
*convention* both harnesses read. It belongs in `AGENTS.md` (the stack-neutral method) and is
inherited by the Claude agents (`.claude/agents/*.md`) and by Pi (which `--skill`-loads
`.claude/skills` and `cat`s `AGENTS.md`/`CLAUDE.md` at run start). Keep the existing hard rules:
no `AskUserQuestion`/`pi-ask-user` headless, `@mention` only when action is needed, batch
questions. This *replaces* the too-blunt "no assumptions" that makes agents ask constantly.
→ **Where:** `AGENTS.md` (+ a one-line pointer from `.claude/agents/CLAUDE.md`).

### WS3 — The scannable question comment (template + `ask-human` skill)
**Verdict: GitHub-side (a skill + the #639 template, tightened). Optionally *emitted* by a Pi/Claude extension later.**
The strict template — **TL;DR / the one decision first**, then status · context · why-it-came-up ·
options-with-a-recommendation · exactly-how-to-reply, always carrying the `🤖` provenance header —
is a **shared convention**, best delivered as an `ask-human` skill so every agent emits the same
shape. This *extends* the #639 `## 🔀 Blocked — need a decision (handoff)` block (which already
has question / why / state / after-you-answer / don't-lose) by adding the **10-second-scannable
lead** and the **always-a-recommendation** rule.
- *Could* a Pi extension post it deterministically (so it's not prompt-dependent)? Yes, and the
  hooks are now concrete: an extension registering a `block_and_handoff` tool (or hooking
  `tool_call`/`agent_end`) that detects `ctx.mode === "print"`, formats the template, `gh`-posts
  the comment + pushes the branch, and returns `{ terminate: true }`. **But** that only helps the
  pi-harness path; the Claude path still needs the skill. So build the **skill first** (covers
  both), and treat a deterministic pi emitter as optional hardening.
→ **Where:** new `.claude/skills/ask-human/SKILL.md` + tighten the template in
`.claude/agents/task-worker.md` and `.claude/agents/CLAUDE.md`.

### WS4 — Multi-modal handoff (attach the right medium)
**Verdict: GitHub-side (wiring existing skills into the handoff). Already-covered *tools*; the gap is the selection convention.**
Every medium already exists: `ui-proposal` (live preview + review flag) · `ticket-diagram`
(Excalidraw) · `schema-review` (schema PNG/HTML/MD) · `scripts/app-shots.mjs` (screenshot) ·
`demo-video` (WebM) · the #639 prose block (fallback). WS4 is a **decision guide** — which medium
for which kind of question — plus the plumbing to *attach* the chosen artifact to the blocking
comment. No new capability, and nothing Pi-specific: the artifacts are produced by our skills and
posted as GitHub comments/PR artifacts. This is the "wiring, not building" the epic calls out.
→ **Where:** the `ask-human` skill (WS3) carries the medium-selection table; the artifact-producing
skills are invoked as-is.

### WS5 — Rich reply loop (reply *in the medium* → resuming agent's context)
**Verdict: GitHub-side — a small extension of `resume-on-comment.yml`. The one place with real new plumbing.**
Today `resume-on-comment.yml` resumes on *any* human reply to a `status:blocked` issue and merges
on `approve`/`lgtm`. WS5 needs the resume to carry the **answer payload**, not just the trigger:
- **Letter/choice reply** ("B") → already flows as comment text the resume reads; just make the
  template's options map cleanly so "B" is unambiguous.
- **Annotated preview** (crouton-feedback → `🎯 Preview feedback` PR comment naming the source
  file) → already a comment; ensure the resume prompt ingests those `🎯` comments as the answer.
- **Edited Excalidraw** → round-trips via `scripts/ticket-excalidraw-import.mjs`; the resume must
  run that import and read the decoded scene.
- **Schema `.md` inline comment** → a PR review comment; the resume must read review comments, not
  just the top-level thread.
The common thread: **extend the resume's context-gathering** to pull the answer from whichever
medium it arrived in (top-level comment, PR review comment, `🎯` feedback comment, or a
round-tripped artifact). This is GitHub-side (a workflow + resume-prompt change), harness-agnostic,
and the only WS with genuinely new wiring.
→ **Where:** `resume-on-comment.yml` (+ the resume prompt) and a small "collect the answer payload"
step.

**Summary table**

| WS | Verdict | Where it's built |
|---|---|---|
| WS2 decide-vs-ask rule | GitHub-side / method doc | `AGENTS.md` |
| WS3 scannable comment | GitHub-side (skill) — Pi-extension emitter optional | `.claude/skills/ask-human/` + agent docs |
| WS4 multi-modal handoff | Already-covered tools; add selection convention | `ask-human` skill + existing skills |
| WS5 rich reply loop | GitHub-side (new wiring) | `resume-on-comment.yml` + resume prompt |

**Nothing here is a mandatory Pi extension.** The only Pi-specific *option* is a deterministic
handoff-emitter (WS3 hardening) — nice-to-have, pi-path-only, explicitly not required.

---

## 5. Notable constraints carried from the codebase (so WS2–WS5 don't relitigate them)

- **No `AskUserQuestion` / `pi-ask-user` in headless pipelines** — times out / stalls the job
  (#839, #1019). The ask is *always* a GitHub comment.
- **Pi has no `--max-turns`; single-model only** — the sole safety bound is job `timeout-minutes`;
  it cannot do the Claude harness's per-role model tiering (#824). Irrelevant to the ask loop, but
  don't design a WS that assumes pi can tier.
- **The ping is a top-level comment, never a PR *review* body** (#846) — reviews are a weak surface
  the owner misses.
- **`@mention` = request for action**, never a broadcast; progress FYIs get no mention.
- **Merge cascade needs an App token, not `GITHUB_TOKEN`** (#572) — already handled in the resume
  workflow; WS5 must not regress it.
- **Agents can't edit `.github/workflows/**`** (App token lacks the scope, #1076) — so a WS5 change
  to `resume-on-comment.yml` is a **human-applied workflow patch** (embed the diff in the PR body
  under `## Workflow patch (human applies)`), not something the pipeline can self-merge.
- **Provenance header** on every agent comment (interactive `@pmcp`-account disclaimer vs bot
  account) — enforced by the `require-comment-provenance` hook.

---

## 6. The quantified success metric

The epic's "We'll know by" made concrete. Measure on a rolling sample of *blocking* comments and
their resumes:

1. **Median question→answer round-trips per blocker** — count comments exchanged from the first
   `status:blocked` to the resume that clears it. **Target: 1** (ask once, answer once, resume).
   A value >1 means the comment wasn't self-contained / didn't lead with a recommendation.
2. **Resume-without-rework rate** — fraction of resumes that continue from the pushed branch +
   handoff *without* re-scaffolding or changing the in-flight design (the #639 failure mode).
   **Target: ≥90%.** Measurable from the resume's diff vs the blocked branch (did it rebuild
   things that already existed?).
3. **1–5 comment-clarity rating** — the owner scores "was this comment clear on its own, no
   scrollback?" on sampled blocking comments. **Target: median ≥4.**

These are cheap to sample by hand at first (the owner rates a handful per week); a later workflow
could compute (1) and (2) deterministically from issue timelines + branch diffs, mirroring the
loop-station usage rollup (#1064). Metric (3) stays human — it's the whole point.

---

## 7. Recommendation to the epic

- **Keep the loop GitHub-side and harness-agnostic.** It already works for both Claude and Pi
  because it never depends on the run staying alive.
- **WS2**: one `AGENTS.md` rule (decide-vs-ask 3-part test).
- **WS3**: an `ask-human` skill emitting the scannable template (extends #639).
- **WS4**: a medium-selection table in that skill; reuse every existing artifact skill as-is.
- **WS5**: the only real plumbing — teach `resume-on-comment.yml` to collect the answer *in
  whatever medium it arrived* and feed it to the resume (human-applied workflow patch).
- **Do not** build a Pi-extension-based ask loop as the primary path; Pi's synchronous HITL
  doesn't fit our async fleet. A deterministic pi-side handoff *emitter* is an optional later
  hardening, not a WS.

This confirms epic #1182's own framing: *the gap is wiring + convention, not new infrastructure.*
