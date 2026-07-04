# The factory model + the feedback loop

> **Status: current thinking, exploratory (July 2026).** Captured from a long design
> conversation so it doesn't evaporate — which is the exact failure mode the model below
> is about. This is a *mental model*, not a spec and not agent instructions. Descriptive:
> "this is how we think about what we're building," not "do X." Expect it to move.

---

## What we're building: a factory, not a fleet, not a mold

The goal isn't a *fleet* (a pile of apps we operate) and it isn't a *mold* (one shape
stamped into identical copies). It's a **factory** — a machine that reliably produces many
different *little* apps, each following the same structure, forming a coherent **ecosystem**.

The apps are **output**. The *factory* is the product — the stack, the shared packages, the
AI issue→build→feedback loop, the gates. The consistency across apps *is* the value.

Rejected metaphors:
- **Mold** — implies identical stamped copies; we want *different* apps. And it casts passive
  output, when the whole point is that a human *composes* the parts with taste.
- **Fleet** — implies the apps are the product; they're the output.

The metaphor that fits: **a kit of parts.** Well-made building blocks you *assemble*
differently each time, with your eye, into different-but-coherent apps. Same parts, different
builds. A kit, not a stamp.

---

## The one gate that matters: the package boundary

It's tempting to think of three equal stages (spike → app → package). In practice there's
**one dangerous line**: changing a *shared package*. Everything below it is cheap to get
wrong; everything at/above it is expensive.

- **Below the line** — a spike, or an app that only *consumes* packages. Getting it wrong
  hurts nobody but you. Iterate freely.
- **At the line** — changing a shared part. A flaw here gets **stamped into every app that
  uses it** (velo, fanfare, every future app). Full scrutiny, heavy CI, deliberate.

The heavy app/package CI is **load-bearing**, not ceremony: it's what stands between "I
changed crouton-layout" and "I silently broke velo." So the answer to "app CI is too heavy to
design in" is *not* to lighten it — it's to design **below the line** (in a spike/app) and
only cross deliberately.

**Behaviour vs look.** The gate isn't on *sharing* — it's on the *kind* of change:
- **Look / presentation** (colours, spacing, the "super cool") — safe to iterate *shared*.
  This is the design-system dream: tweak centrally, propagate to every app. *Do this freely.*
- **Behaviour / model** (does a list paginate on a page, does a card scroll, the render
  model) — structural, breaks consuming apps. **Must be settled before it's shared, and never
  *discovered* in a shared package.**
- Watch out: **"how it should look" often smuggles in behaviour.** The whole preview saga was
  a *behaviour* change (scroll/pagination/flow) wearing a "look" costume.

---

## Two lanes, never run at once

A factory has two different activities with different risk profiles:

1. **Producing an app** — consume *stable* parts. Fast, low-risk. This is the AI loop:
   issue → build → feedback → done.
2. **Cutting/improving a part** — R&D on a shared package. Slow, careful, gated, because it
   reshapes the whole ecosystem.

The churn comes from **doing part-R&D while stamping an app** — which is exactly what happened
when we kept doing surgery on the layout renderer *inline*, mid-app-build. When producing an
app reveals a part is wrong, that becomes a **separate, deliberate R&D task (a spike)** — not
inline surgery. Keep the lanes separate: app production consumes *frozen* parts.

---

## Spikes, not POCs

A **spike** is a disposable, single-question probe. "Does this gesture feel right? Does this
render approach work?" You keep the *learning*, throw the *code*.

- The word matters: **"spike" primes you to throw it away; "POC" primes you to preserve and
  pile on** — which is how the demo POC became a dirty monolith you couldn't build on.
- **Build on what's SETTLED, isolate what's IN FLUX.** Spikes are *siblings sharing a growing
  spec*, not a stack of code on code. They build on each other's **learning** (the spec),
  never their raw experimental **code** — that's the single line that keeps it clean.
- **The app is the integration surface** — the one place settled spikes come together, safely
  *below the package line*. Integration is continuous, not a big-bang merge.
- **Integration isn't additive.** Two individually-settled pieces can still fail to compose
  (the render-model problem was exactly that). So assembling surfaces *new* problems → the
  next spike. It's a loop, not a funnel.

**The spec is the durable carrier across restarts.** It must capture **negative knowledge**
(`consideredRejected` — what we tried and why not), not just the happy path — otherwise a
clean restart either re-walks dead-ends or launders a wrong assumption into "the contract."

---

## Premature extraction: the recurring sin (and why it's seductive)

The layout engine getting extracted into a shared package *early* — while its design was still
moving — was the original sin. And we **did it again, in real time**, packaging the spec walk
mid-conversation *while discussing this exact anti-pattern*. Awareness isn't enough; the pull
is structural.

Why it's seductive: **packaging feels like progress.** "It's a package now, I can use it, it's
*there*" — and that reward masks that the thing isn't settled. Extraction is frictionless
(five minutes), so nobody stops to ask "is this actually done?" And it's a **ratchet** — easy
to do, hard to undo, and once it's consumable you start *depending* on something unfinished.

The rule that would've caught both mistakes:

- **Usability is never a reason to package.** You can make something fully real and usable
  *app-local*. The *only* valid reason to extract is **settled AND genuinely shared across
  multiple apps** — both, and true.
- **The tell you extracted too early: you're still doing *design* in the package.** A settled
  package gets bug fixes and additions, not behaviour/model pivots.
- **The seam question** to keep asking: *"Am I consuming the shared thing, or growing it?"*
  Growing it → keep it app-local.

Consequence for the spec walk: it wants to come **back to app-local** (registered through
crouton-feedback's public API, but *living* in the app) until it's settled — consume the
infrastructure, don't grow the package with an unfinished tool.

---

## Why the gates suit AI specifically

The AI **treats existing code as ground truth and extends it faithfully** — including your
earlier wrong assumptions, which get laundered into looking intentional by all the
correct-looking code piled on top. It's *excellent* at greenfield-from-a-clear-spec and *bad*
at noticing and unwinding its own accumulated mistakes.

So **hard gates that restart from a distilled spec** play to the first strength and route
around the weakness. And there's an inversion: **clean restarts are cheap for AI** (expensive
for humans — which is why we build on mud). A rebuild-from-intent flow is a luxury for humans
but a natural default for AI — designing *to the grain* of the tool.

The catch: the gate lives or dies on **real human scrutiny at the distillation.** If a wrong
assumption gets written *into* the spec, the clean rebuild reproduces it — now *blessed*. The
gate's job is "reset the assumption-baggage while keeping the truth," and truth includes
what-not-to-do.

---

## The layout engine is a feedback instrument

The layout engine isn't a "page renderer" that happens to sit next to the feedback system —
**it's part of the feedback system.** There are two ways a human feeds the AI:

| Modality | Tool | Best for |
|---|---|---|
| **Words + pointing** | crouton-feedback (annotate + console + comment) | corrections, bugs — *"broken / wrong here"* |
| **Direct manipulation** | the layout engine | taste, arrangement — *"no, like this"* |

They map onto two kinds of intent: **verbal feedback carries what you can say; spatial
feedback carries what you can't.** "Make it feel more balanced" is useless as prose — but
dragging the panes to the balance you want is exact. So the layout engine is the *correct*
instrument for the class of feedback words fail at and the AI is weakest at.

And the property that makes it strong: what flows *back* from the layout engine isn't prose the
AI must interpret — it's a **LayoutTree. Structured data.** The exact arrangement, unambiguous.
Spatial feedback is *higher-fidelity* than verbal feedback: the AI gets *what you built*, not a
guess at what you meant.

**The loop that is the product:** the AI drafts a mini-app → the human refines it by *moving
pieces* (spatial) and *pointing at problems* (verbal) → both flow back as feedback → it
rebuilds. You don't just point — **you shape it back.**

---

## Composition recurses

The same "compose parts into a bigger reusable part" move happens at every level:

```
blocks            (AI makes these — components)
  → mini-apps     (compose blocks via the layout builder — e.g. a calendar-with-registration)
    → pages       (compose mini-apps + blocks via the page builder)
      → site      (pages wired together)
```

A mini-app (the calendar app) is literally the layout engine's **`nested` node** — a layout
that is *itself* a block you can place inside another layout. The kit **recurses**:
everything's a part, every part is made of parts, all the way up.

**Smell:** the layout builder and the page builder are "comparable but a bit different." Two
builders doing sort-of-the-same compositional job is *two sources of truth for composition* —
the same trap as board-thumbnail-vs-preview. They almost certainly want to be **one recursive
composer** used at different altitudes (compose blocks → a mini-app; compose mini-apps → a
page — same tool, zoomed), not two separate things.

---

## The soul (and what the marketing misses)

The exploratory marketing (Harness · Atelier — both still-moving positioning spikes, not
correct-yet) sells **autonomy**: *"point it at a task; it ships a Nuxt app"* / *"describe what
you need; get an app."* The soul is the **opposite**:

> The AI produces excellent parts. **You** compose them, with taste, into different coherent
> apps — recursively — feeding back by *moving pieces* and *pointing at problems*.

Harness omits the builders entirely; Atelier replaces the *human* composer with an AI
"Designer." Both market *away* the human-taste half — the layout engine, the recursive
composer, the thing that makes the calendar-in-a-page real. It's the missing centre of the
story, and it's the stronger pitch: **you don't just point — you shape it back.**

---

## Open questions (honest unknowns)

- **The stopping rule** — when is a design settled enough to extract? Working signal: *a realer
  spike surfaces nothing new* **and** more than one app genuinely needs to share it.
- **Telling app-production from part-R&D *in the moment*** — before you've spent an hour doing
  inline surgery on a shared part mid-app-build.
- **The co-dependent case** — when two things are both in flux and each needs the other, there's
  nothing settled to build on. "Isolate-in-flux, build-on-settled" doesn't cover it.
- **One recursive composer?** — should the layout builder + page builder literally be a single
  recursive tool at different zoom levels.
