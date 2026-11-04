> 🗄️ **Archived 2026-11-04 (#3352) — done (superseded):** folded into writeups/strategy/crouton-vision.md; epic https://github.com/FriendlyInternet/nuxt-crouton/issues/703 closed completed. Historical record, not current guidance.

# Crouton — Vision Brief

> Internal positioning notes. Originally captured from a thinking-out-loud session (2026-06-23),
> revised after a skeptical design review of the layout engine.
> This is early-idea / strategy framing, **not** agent instructions — nothing here is a
> directive. The concrete, trackable work lives in epic
> [#703](https://github.com/FriendlyInternet/nuxt-crouton/issues/703) and its sub-issues.

## One line

**Crouton is an app builder for the AI age that hands you the code.** Not vibe-to-lock-in —
**vibe-to-code.** The AI gives you velocity; an opinionated, secured foundation gives you a floor
you can't fall through; and ownership means there's no ceiling and no eject cost — because there's
nothing to eject *from*. It's a great Nuxt monorepo that happens to have been mostly written by asking.

## The core thesis

Most AI app builders (Bolt, v0, Lovable, Replit Agent) are **vibe-to-running-app**: type a prompt,
watch something appear. They optimize for the demo. But the output is generic — every app is a fresh
pile of code with no spine. Security, multi-tenancy, i18n, auth, deploy: absent or reinvented badly
each time. And the code is usually *theirs*, behind a runtime or a subscription.

Crouton's bet is different:

- **The base is always going to be very good.** The AI doesn't generate an app from zero — it
  generates the *delta* (schema, forms, specific screens) on top of an opinionated, secured,
  ecosystem-native foundation that is already load-bearing.
- **You pour gold on top.** The foundation is the structural concrete; the bespoke
  designs/forms/flows are the gold. AI is great at gold-pouring *when the form is already there to
  pour into*. Without the form, gold just puddles — which is why the generic builders plateau.
- **The code is yours, completely.** That's not a feature, it's the category. There's no platform to
  be locked into; you get a normal, excellent codebase.

> Their base degrades as the app grows. Ours *appreciates* — because every generated collection
> follows the same patterns, the 30th feature is as clean as the 1st.

### The central claim is measurable — and not yet proven

"Ours appreciates, theirs degrades" is the whole bet, and right now it's **faith, not data**. It is
measurable, and we should treat proving it as a first-class goal, not a tagline:

- **time-to-POC** (idea → deployed staging preview),
- **time-to-promote** (POC → launched `apps/` product),
- **regressions over a lifetime** (security/defect/i18n drift as an app grows from feature 1 to 30).

The scariest *untested* assumption sits one level up: **does any of this work for a builder who isn't
us?** The whole thing is dogfooded by one person. One external builder taking an idea through to a
promoted production app — via the harness — would validate more of the company-level bet than another
package would.

## Who it's for (the ICP)

The customer is the **solo dev or small studio that ships *many* small multi-tenant apps** and is
tired of re-doing auth, teams, i18n, and deploy from scratch every time. (That's us — Crouton is
dogfooded.) Naming the ICP decides everything downstream:

- The **harness is perfect** for this person and **irrelevant to a true non-coder.** We serve the
  *builder*. The "magic moment" is the hook that gets them in the door, not the whole product.
- "Two audiences" (the vibe-coder who wants magic, the serious builder who wants ownership + an exit)
  are not two products — they're two **ends of one funnel** (below).

## The two pillars (the machinery)

The machinery is **two** things, not three. The moat is that **both layers are open and yours** — the
generic builders own them *for* you.

| Layer | Crouton gives you | Pillar |
|---|---|---|
| Foundation | the building blocks (yours) | **1. The Floor — Crouton OS** |
| Process | the harness — issue-driven, skill-driven, headless-capable | **2. The Harness** |

### 1. The Floor — Crouton OS (what you build with)
The ecosystem itself: the packages, the generator, the components, the layers, auth, storage, i18n,
themes, deploy. The opinionated foundation that makes generated code load-bearing instead of generic.

### 2. The Harness — the way you drive it (how you build)
The genuinely novel pillar — **and the one that already exists and runs in this repo today** (the
`.claude/` arsenal, `/task-decompose`, the digests, issues-as-interface). Work lives as GitHub issues
(epics → sub-issues), and the whole thing is drivable two ways:
- **interactively** (Claude Code, a conversation), or
- **headless, straight off a GitHub issue** — no chat required. An issue *is* the prompt. The agent
  picks it up, picks up all the skills (`/commit`, `crouton`, `task-decompose`, deploy, the whole
  `.claude/` arsenal), does the work, opens a PR, closes the issue.

This is the moat. Anyone can bolt an LLM onto a code generator; almost nobody has a *way of working*
where an issue is the prompt and an agent carries the whole skill set to a PR.

### Bring Your Own AI — the trust bullet, not a third pillar
Model-agnostic; plug in your own AI. This **completes the ownership story** (no lock-in at the code
layer *and* none at the model layer) — but it's a checkbox under "it's yours," not a reason anyone
chooses Crouton. It earns a bullet, not a pillar.

## The funnel: magic in, harness deep

The two audiences are one funnel with two ends:

- **Acquisition = the magic moment.** Ask → a generated, laid-out, *deployed* POC. It has to be strong
  enough to pay the on-ramp tax (a repo, GitHub, the conventions). This is what pulls the ICP in.
- **Retention = the harness + the owned floor.** Issues-as-interface is invisible and a little
  intimidating to a newcomer, so it is **not** the hook — it's what makes you *stay* once a generic
  builder's output has betrayed you. It's a depth/retention play, not an acquisition play.

**Working instinct: lead with the floor, demo with the magic, keep them with the harness.**

## The lifecycle: POC → refine → promote

The two pillars are the machinery; this is the lifecycle that runs on top — and it's what makes the
whole thing **safe to be fast**.

1. **Spawn a POC** in `pocs/` (the incubator). Ask for an app → it scaffolds into `pocs/<name>`, *not*
   `apps/`. Churny, safe-to-fail, staging-only previews. The cost of being wrong is near zero. This is
   where the vibe-coding magic moment lives.
2. **Refine it in place.** Pour the gold — iterate the schema (schema sign-off), the UI (UI sign-off →
   live staging preview, pin comments on the running page), the flows. The POC is a real, deployed,
   working thing the whole time — you refine against reality, not a mockup.
3. **Promote to an app** once it's earned it. `pocs/<name>` → `apps/<name>` takes on the full rigor:
   production counterpart, two-domain deploy, the `app:` label, prod CI, issue discipline. It graduates
   from experiment to launched product.

> The generic builders have one mode: everything is production from keystroke one — so you're either
> reckless or slow. Crouton separates the two: **a place where being wrong is free, and a deliberate
> gate to cross when you're right.**

## The full narrative, end to end

> **Crouton OS** (the Floor) gives you the building blocks. **The Harness** is how you drive the work
> (issues + skills, chat or headless) — and it keeps you. **Bring Your Own AI** keeps the intelligence
> yours. The **POC → app flow** is the lifecycle that lets you go from "I want this" to a launched,
> production product — fast where it's safe, rigorous where it counts.

## Where the layout engine fits (epic #703) — the visible proof of the Floor

The layout engine is **not** a separate "OS" initiative — it's the **demoable embodiment of pillar 1**:
the base is so good that the AI just *places* great blocks into a form that already exists. It is the
magic moment made concrete, and therefore the top of the funnel for the harness.

After a design review we deliberately scoped it **lean** — prove the core bet cheaply before paying for
the hard parts:

- Packages declare **placeable blocks** (a registry) — Nuxt UI–based components that are responsive to
  **their pane** (CSS container queries + a declared min-width), so any block looks good at any size
  with no per-app tuning.
- **One renderer to start: structured, nestable panes on Nuxt UI's own splitter** (reka-ui). No Vue
  Flow, no real-time collab, no fractal component deconstruction in v1 — all parked until earned.
- **Layout is data** (a saved tree), so the AI can write it and a user can edit it — it round-trips.
- The first "AI that lays things out" is a **deterministic rule set**, not a model call. An LLM only if
  the rules visibly fall short, proven by a blind test.

```
"I want a booking app"
  → crouton generates the collections (list + form)
  → a deterministic /layout arranges registered blocks into a good default
  → UI sign-off: review it on a staging preview
  → deployed POC → refine → promote to app
```

### The lean sprint ladder

Each sprint ends in a **staging URL + a written learning**, and tests **one** assumption (cheapest to
kill goes first):

0. **Spike / kill-test** — a layout *data tree* renders real blocks in Nuxt UI panes, round-trips
   (save/reload), and SSRs cleanly. Go/no-go on the whole mechanism.
1. **Block registry** — packages declare placeable blocks (extends `croutonApps` / `CroutonPageType`).
2. **Block contract + container responsiveness** — sizing contract + container-query blocks; the
   objective quality metric is *viability* (every placed block meets its min-width in its pane).
3. **Editable panes surface** — drag a block in, resize, nest, save, reload (its own persistence; new
   `layout_configs`, no `flow_configs` migration).
4. **Deterministic default layout** — a rule set arranges generated collections, wired into the
   generate → POC flow. The North-Star demo, with zero model calls.
5. **(gated) optional LLM `/layout`** — only if the deterministic default underperforms in a blind test.

**Deferred backlog (revisit only when the above has users):** Vue Flow as a second renderer, collab /
CRDT on the layout tree, fractal component deconstruction, and re-basing `CroutonWorkspaceLayout` onto
the new renderer.

## Open idea — unified domain (not yet tracked)

Today's deploy topology is **per-app, two registrable domains**: `<app>.friendlyinter.net` (prod) and
`<app>.pmcp.dev` (staging) — two *separate registrable* domains on purpose, for bulletproof
cookie/session isolation (#133).

The idea flips the axis to **per-tenant**: a user defines *their* domain once, and apps/POCs nest
underneath (`<app>.<their-domain>`, with maybe a `.box` subdomain for the sandbox tier). Nicer mental
model for the user — define once, everything derives.

The tension to resolve before building: putting prod and sandbox apps under *one* registrable domain
re-opens the cookie-sharing surface the two-domain split exists to close. Likely resolution: the
**launched tier** derives from the tenant's own domain (define once for the part that matters), while
the **POC/sandbox tier stays on a system-owned domain** — convenience for the user, isolation preserved
by the system. Not yet an epic; capture here until it's worth tracking.

## Competitive wedge (summary)

| | Generic AI builders | Crouton |
|---|---|---|
| Foundation (the Floor) | generic, ungoverned codebase | opinionated, secured OS (yours) |
| Process (the Harness) | a chat box + "regenerate" | issue-driven harness, chat *or* headless |
| Intelligence | their model, their runtime, their bill | bring your own AI (the trust bullet) |
| Output | their code, behind a runtime | **your code, completely** |
| Speed vs safety | production from keystroke one | free-to-fail POC tier + a deliberate promote gate |
