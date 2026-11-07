> 🗄️ **Archived 2026-11-04 (#3352) — done:** epic https://github.com/FriendlyInternet/nuxt-crouton/issues/983 closed completed. Historical record, not current guidance.

# Crouton Builder — graduation brief

> The cold-readable spec for graduating `pocs/crouton-builder-demo` → a test-first `@fyit/crouton-layout`
> package contribution + a consuming builder app. Epic **#983** (sub-issues #984–#988 + #974). Backbone
> is `pocs/crouton-builder-demo/HANDOFF.md` (kept to current truth all through the spike, v11→v52);
> this brief adds the per-unit **shape call** + the **test checklist**. Single source of truth for the
> rebuild — don't re-read the `spike-*` history.

## What it does

A visual builder for composing **collection-driven apps**: you arrange a collection's blocks into a
`LayoutTree` on a Vue Flow canvas (Site flow of pages → per-page board of blocks), tune how they
behave across sizes, and get a working, opinionated (Nuxt UI 4 / crouton) app. It is **the human seat
in an AI app-generation loop** ("Lovable, but opinionated") — a human and an agent meet on **one
shared artifact, the `LayoutTree`**. It is **component-driven**: the layout obeys what each component
*declares about itself* (min-width, `fill`/`hug`, display variants); composites *derive* their rules
from their children. Every expressive control is a **bounded, enumerated, agent-pickable** choice —
never a freeform canvas.

## Features (proven in the POC → each becomes ≥1 test)

**Composition model**
- [ ] `LayoutTree` of `split` (h/v) · `leaf` (block) · `nested` (a layout that is itself a block).
- [ ] Block registry (`croutonLayoutBlocks`) is the allowlisted source of truth; unknown id → safe fallback.

**Component contract (the durable value)**
- [ ] **Sizing descriptor** per block: `sizing: { width, height: 'fill' | 'hug' }` (default fill). `hug` sizes to content (a Top bar is a short bar wherever it lands); `fill` stretches.
- [ ] **Display variants**: a block declares a bounded `variant` enum (List: rows/cards/table); chosen per-pane, **serialised on the leaf** (`config.variant`), agent-pickable.
- [ ] **Composite derivation** (`deriveSizing`): a split/nested derives its own floor bottom-up — **hard** = widest leaf (can always reflow to a column), **soft** = sum-along-axis / max-across (where a row stacks). Height mirrors with axes swapped.
- [ ] **min-width / viability**: a block declares `minWidth`; the renderer stacks a row → column when the children can't fit at their floors.

**Board gestures (direct manipulation)**
- [ ] Snap: two-stage dwell-to-arm (soft blue → held ~0.6 s → armed green).
- [ ] **Drop-beside-pane**: drag a block over a layout → it targets the **pane under the cursor** and adds beside it on the nearest side; **flattens into the row** when aligned, **wraps perpendicular** otherwise (so "right of a pane in a vertical stack" works). Ghost/ease-apart preview.
- [ ] Detach / reorder: long-press → panes wiggle; pull a pane across to reorder or out (past a margin) to detach. FLIP reflow.
- [ ] Per-element resize: a corner handle sets a node's width (responsive preview); **clamped to the composite hard floor**, with a floor readout.
- [ ] Pinch-to-zoom over a node; add-block lands clear/centred/green; fit by known geometry.

**Page model & assembly**
- [ ] One node is "the page" (★); set-as-page / duplicate.
- [ ] **Regions**: pin a node top/bottom (sticky pill); ▶ Preview assembles pinned bars + scrolling main.
- [ ] Edit view (focus): per-breakpoint authoring (device/width slider, breakpoints, collapse "tuck-as" recipe, display variant) over the package `CroutonLayoutBreakpointAuthor`.
- [ ] Site ⇄ Page flow (currently one route + cross-fade — graduates to real routing).

## Watch out for (gotchas — the "looks done but isn't" traps)

- **Overlays drift; measure the real DOM.** Pane faces / hit-tests must measure the rendered
  `.croutonpane` / `[data-panel]` elements, **not** the abstract tree or `defaultSize` — the renderer
  reflows (`@container` stacking), enforces min-widths, and a resized card renders responsively. Clamp
  measured rects to the card box (overflowing/scrolling layouts spill otherwise). *In the rebuild this
  whole class disappears — the renderer should **own its pane handles** (WS2 #985) instead of an overlay.*
- **Vue Flow geometry:** the `.vue-flow__node` wrapper is smaller than our card (`.spike-block-node`);
  the zoom transform is on `.vue-flow__transformationpane`, not `.vue-flow__viewport`; fit by known
  geometry (`fitBounds`), not `fitView` (it measures the small wrapper).
- **Drag commit:** Vue Flow mutates node positions in place and re-emits rows by value — track the
  **dragged node id** (not a position delta) and re-find the target by **stable id** (not object ref).
- **Renderer resolves blocks by global component name** (`<component :is>`); POC block components must
  be registered globally — in the package they're real components.
- **Deploy:** `crouton-devtools` installs `@fyit/crouton-feedback` at build time → a consumer must
  declare it AND add it to the deploy build set (pre-existing #976; systemic — fix at the package level).
- **Cross-fade page⇄site is a stopgap** — graduates to real routing + View Transitions.

## The shape call (reusable → package vs app-specific)

| Unit | Home | Opinionated / ecosystem-grade | Sub-issue |
|---|---|---|---|
| Editable renderer that **owns its pane handles** (wiggle/reorder/detach on the real panes; proxy only for detach) | `@fyit/crouton-layout` | ecosystem-grade (any layout-engine consumer) | #985 |
| **Typed component contract** — sizing descriptor + variants + composite derivation onto `CroutonLayoutBlockDefinition` / viability engine; renderer hugs a pane *inside* a split | `@fyit/crouton-layout` | ecosystem-grade | #986 |
| **`LayoutTree` serialisation** — stable, diffable interchange format | `@fyit/crouton-layout` | ecosystem-grade | #987 |
| Drop-beside-pane gesture (`applyPaneDrop` flatten/wrap) | `@fyit/crouton-layout` (compose utils) | ecosystem-grade | folds into #985/#986 |
| **Builder app** — Site/Page real routing, the demo blocks, AI hooks | new app (`apps/` on launch) | app-specific | #988 |
| **Round-trip a version onto the GitHub ticket** (agent⇄human seat) | app + a thin serialise/poster (pairs with #987) | opinionated (crouton/GitHub) | #974 |

## Test-first plan (feature checklist → signed-off tests, #774 gate on `packages/`)

Each `packages/*` unit: write the failing test(s) first → `/test-review` to sign off the behaviour →
build to green, **re-derived** from this brief (not ported from `spike-*`). Priority order:
1. **#987 serialisation** — round-trip stability tests (the contract everything else rides). Nail the shape first.
2. **#986 typed contract** — `deriveSizing` fold (hard/soft, nested), sizing-honoured-in-split, variant resolution. (POC already has 8/8 derive + 9/9 pane-drop logic tests to seed these.)
3. **#985 editable renderer** — pane-handle hit-tests, detach/reorder/drop-beside transforms, no overlay-drift.
4. **#988 app** + **#974 round-trip** on top.

## Reconcile gate (step 1.5 — do before freezing the brief)

Drive the running **v52** POC (`crouton-builder-demo.pmcp.dev` / `pnpm dev`) against this brief +
`HANDOFF.md`, sort behaviour into **confirmed / contradicted / undocumented**, and add stable
`data-testid` / `data-handoff` hooks wherever a state is hard to locate (armed snap, ghost slot, active
page badge, floor readout, region pills). Those hook names become the shared vocabulary the rebuild
(WS) reproduces, so the same agent runs identically against the POC and the graduated app.

### Reconcile result — v52, WS1 (#984) — done

Drove the running v52 POC (`pnpm dev`, headless chromium) against this brief + `HANDOFF.md`:

- **Confirmed** — the whole composition/board model is implemented and renders live: Site flow (page
  cards with condensed status/visibility/layout/nav meta) → page board; the composed split layout
  (Artists list *rows* variant · stacked Bookings/Revenue stats · New-artist form); block palette,
  `✨ Magic arrange`, page promotion (★), regions toolbar, per-element resize + floor readout. The
  contract logic (`deriveSizing`, `blockSizing`, `applyPaneDrop`/`insertAtPath`, leaf-config
  read/write) is verified in `utils/spike-layout.ts`. Gesture *states* (armed snap, armed-drop ghost,
  detach pull) are code-confirmed but not driven headlessly — that's the rebuild's e2e job, against
  the hooks below.
- **Contradicted** — none. Both docs read as current truth.
- **Undocumented** (now folded into `HANDOFF.md`): (1) **per-node responsive preview** — a node with
  `data.width` set renders read-only via `CroutonLayoutResponsiveRenderer(interactive:false)`, so the
  card *is* its own width preview; (2) **ephemeral per-page board cache** (`pageBoards` Map) — board
  state is in-memory, restored on re-enter, **nothing persists** (real persistence is the round-trip,
  #974); (3) **`✨ Magic (AI)`** — a free-text *"Describe the app"* intent → LLM arranges the placed
  blocks (`aiIntent` + `magicAI`, gated on `hasApp('ai')` #909); the in-app agent-first-cut surface,
  distinct from the deterministic `✨ Magic arrange`.

**Stable element hooks (the shared vocabulary — reproduce these names verbatim in the rebuilt app, #988):**

| State | Selector | Where / when |
|---|---|---|
| armed snap | `[data-handoff="snap-guide"][data-armed="true"]` | `SpikeBlockNode` edge guide; green once the dwell-arm fires (soft blue = `data-armed="false"`) |
| ghost slot | `[data-handoff="ghost-pane"]` | `SpikeGhostPane`; the `__dropghost__` ease-apart placeholder |
| ★ page badge | `[data-handoff="page-badge"]` | `SpikeBlockNode`; the one node that is "the page" |
| floor readout | `[data-handoff="floor-readout"]` (+ `data-hard-floor` / `data-soft-floor`) | `SpikeBlockNode`; selected card's derived floor |
| region pills | `[data-handoff="region-pill"]` (+ `data-region`) | `SpikeBlockNode`; pinned top/bottom |

## Promotion path

`pocs/crouton-builder-demo` → package contributions land in `@fyit/crouton-layout` (test-first, gated)
→ a fresh **builder app** consumes them (real routing) → `/deploy` → retire the POC (`/remove-app`)
once the app supersedes it. Does not auto-merge/deploy; each step under the existing gates.
