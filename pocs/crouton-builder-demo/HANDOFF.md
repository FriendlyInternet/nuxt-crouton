# Crouton Builder — handoff (living doc)

> **This is a LIVING handoff, curated to *current truth* — not a changelog.** Every time a design
> decision is **signed off** ("ok, this works"), capture it here. When we iterate *past* a decision,
> **edit/delete the superseded version** — this file should always read as *"this is how it should be
> built,"* never *"here's everything we tried."* It IS the brief the **`graduate`** skill consumes
> when this POC becomes a real package + app, so keeping it current means graduation starts written.
>
> Scope of this doc: the **Crouton Builder spike** (`/spike-app`, epic #907). (The app also hosts a
> throwaway `@fyit/crouton-three` demo at `/three` — see `README.md`; unrelated to the builder.)

## North Star — why this exists (the real goal)

**This builder is the human-in-the-loop surface of an AI app-generation pipeline.** The end state is:
an AI is asked for a specific app ("a football calendar dashboard"), and it builds the whole thing by
chaining the crouton pieces — *the builder is where a human and that agent meet on the same artifact.*

**Positioning: "Lovable, but opinionated."** Same one-prompt-to-app feel, except the output is *always* in
the house style — heavily **Nuxt UI 4 / crouton-opinionated**, not freeform generated markup. You don't get
a random UI, you get *your* system's UI, consistently. That consistency is exactly what makes the blocks
composable and the round-trip (below) safe to automate.

**It's COMPONENT-DRIVEN: the layout obeys what each component declares about itself** — not arbitrary
styling imposed on top. A component publishes its rules as data (min-width, `fill`/`hug`, display
variants), and the builder's job is *arranging components within the bounds each one publishes*. Those
declared rules ARE the bounded vocabulary a human and an agent both edit against. And it's recursive —
a composed layout is itself a component that **derives** its own rules from its children (see "Composites
derive their rules" below), so the contract holds all the way up a layout-of-layouts. (Today only some
rules are declared; completing the component contract + making it round-trippable is the durable work.)

**The full lifecycle — close to end-to-end automation, with a human checkpoint:**

```
ask → collections → blocks → layout-engine assembles the app → you GET a working app
   → iterate by direct manipulation ("this, not that") → the edits SAVE (as a LayoutTree on the ticket)
   → GRADUATE pocs/ → apps/ (the deliberate test-first rebuild)
```

Each arrow is already a crouton piece; the remaining work is wiring them into one flow and persisting the
human's iteration back as spec (see round-trip below + Graduation requirements).

**Observability is the other half.** As this automates, you need to *keep an eye on what the skills/agents
are doing* — an observability layer over the pipeline (which skills ran, what they produced, where a human
intervened). The builder is the **visual** observability+control point for the layout step specifically;
the broader system needs the same for the generation steps.

The pipeline:

```
ask: "build a football calendar dashboard"
  → crouton CLI/MCP generates the COLLECTIONS (schemas, CRUD, API, migrations)
  → the graph/charts package generates BLOCKS for those collections (list, calendar, stat, chart, form…)
  → the LAYOUT ENGINE composes those blocks into PAGES — driven by an AGENT, or by a human in THIS builder
  → a full app
```

The two composer drivers — agent and human — operate on **one shared artifact: the `LayoutTree`** (the
tree of layouts → blocks, with their splits/sizes/breakpoints). That shared format is what makes the loop
close:

- **Agent → human.** The agent proposes a first-cut layout (already what `composeDefault` / the magic
  arrange does); it lands in the builder as a `LayoutTree`. In-app this is **two tiers**: `✨ Magic
  arrange` (deterministic compose of the placed blocks) and `✨ Magic (AI)` — a free-text *"Describe
  the app"* intent (`aiIntent`) → an LLM arranges the placed blocks (`magicAI`), shown only when the
  `crouton-ai` add-on is installed (`hasApp('ai')`, #909). The AI tier is the in-app embodiment of
  this arrow; both write the same `LayoutTree`.
- **Human → agent (the iteration loop).** The human reiterates by direct manipulation — re-dragging
  blocks, snapping, reordering, resizing, changing the page flow — and the result **serialises back to the
  same `LayoutTree`** and is **fed back to the agent as the new spec**.

**The round-trip must be persistable to the GitHub ticket (planned).** A human's edited version should be
**saved back onto the tracking issue** — the serialised `LayoutTree` (layouts · blocks · sizes/breakpoints,
in a clean, diffable format) posted to the ticket as the **command/spec for the agent** to (re)build from.
So a "version" in the builder becomes a concrete instruction on the ticket: the agent reads the tree, the
human edits it visually, the edit goes back to the ticket, the agent acts on it. The builder is the visual
front-end to an issue-tracked, agent-executed layout spec. (See Graduation requirements.)

## Expressiveness boundary — the "artboard" question (design guardrail)

There's a real tension: the builder must produce **good-looking** layouts (you should be able to make
the review-flow-with-a-pinned-pill-top-and-bottom kind of thing), but it must NOT drift into a freeform
"make anything" design tool — because the **whole point is that an agent can also produce and re-read
the layout**, in the opinionated house style. A free-floating canvas (arbitrary x/y, per-pixel sizing)
breaks both: an agent can't reliably target it, and it breaks responsiveness.

**The rule that resolves it: every expressive control must be a BOUNDED, ENUMERATED, RESPONSIVE choice
that serialises into the `LayoutTree` — i.e. something an agent could equally have picked from a small
set.** If a control can only be expressed as a free value (drag to x=347px, float anywhere), it's "too
far". If it's an enum/role an agent could choose, it's in.

Concretely — what's IN vs OUT:

- ✅ **Regions/roles, not free floats.** The "artboard" instinct is right but should be a few *named
  regions* (e.g. `header`/top-pill · `main` · `footer`/bottom-pill · `aside`), not absolute-positioned
  elements. A pinned top/bottom pill is a **pinned region**, not a free-floating box. This gives the
  review-flow + pills look while staying tree-structured and agent-targetable.
- ✅ **Per-block sizing as ENUMS.** `full-width` / `full-height` / `fixed` / `auto`, `pin: top|bottom|
  left|right`, grow/shrink — bounded settings that stay responsive (mirrors the page model's existing
  `layout: default|full-height|full-screen` enum, pushed down to blocks).
- ✅ **Layout primitives** like the **Spacer** (#952) — a real, snappable block that holds space.
- ❌ **No free-floating absolute positioning** (arbitrary x/y), no per-pixel manual sizing outside the
  splitter/enum model, no "anything anywhere".

So the builder stays a *structured* editor (splits, regions, enum settings, primitives) that just
happens to feel direct-manipulation — the LayoutTree is always the truth, and an agent is a first-class
co-author of it. Add expressiveness by adding **bounded vocabulary**, never a blank canvas.

## What it is

Build an app by composing a collection's blocks into a `LayoutTree`, visually, on a Vue Flow canvas.

**Two levels, one screen** ("Decision B" — a *Site* level added **on top of** the polished board, not
by porting the board into the old zoom shell):

- **Site = the page flow.** A `CroutonFlow` canvas renders pages as a wireable sitemap (cards = pages,
  lines = `parentId`). The view you land on. Cards use a POC card (`SpikePageCard`, injected via
  `defaultNodeComponent`) instead of the package's `CroutonFlowPageNode`, so each card shows the page's
  settings **condensed** — live/draft **status** (coloured dot), **visibility/permissions** icon,
  **layout** and **in-nav** — the same chips the full page header carries, just shrunk. (We override
  the card POC-side rather than edit the package; on graduation this folds back into
  `CroutonFlowPageNode`.) Status/visibility/layout meta is shared with the board header via the
  auto-imported `app/utils/spike-page-meta.ts` so the condensed card and full header never drift.
- **Page = the board.** Tap a card (or ⤡ / double-click) → `enterPage()` loads that page's `LayoutTree`
  onto the Vue Flow board, where you compose blocks — "opening the full page". `Pages ←` returns.

## Signed-off design decisions (current truth)

### Page model — one node is *the* page (#942)

The board is a sandbox of layout candidates + loose draft blocks; **exactly one node is "the page"**
(the live layout a user would see), ★-badged. **Set as page** promotes a node; **Duplicate** clones one
as a free draft so you can rearrange a copy then promote it. Both are provided by the page and injected
by `SpikeBlockNode`, keyed by node **object identity** (Vue Flow doesn't forward the node id). A merge
that involves the page **always consumes** — the page badge survives, favourited never silently
becomes unfavourited.

### Focus / layout-edit view (#907)

Double-click a layout node → a **dedicated full-screen edit VIEW**, not a Vue Flow camera zoom.

- **Why a view, not a camera.** Zooming the camera onto a node made Vue Flow re-measure and fire its
  own viewport fit, racing the camera op → off-screen framing on some nodes (reliably the 2nd at a
  mobile viewport). A plain overlay has no camera and no re-measure race → every node frames cleanly.
- **One unified surface.** Hosts `CroutonLayoutBreakpointAuthor` (`@fyit/crouton-layout`) untouched —
  min-width ruler, device buttons, width slider, per-checkpoint collapse motion, per-block variants,
  splitter drags → keypoint sizes. The floating header sits in the author's reserved top band.
- **Persistence unchanged.** The node's layout rides the page's `zoomTree` `v-model`; `Done` returns.

### Page regions (#953 — the first "bounded vocabulary" expressiveness feature)

A node can be **pinned to the page's top/bottom edge** (a sticky pill/bar) from its action toolbar; the
badge shows "Pinned top/bottom". **▶ Preview** assembles the running page: pinned-top nodes in a sticky
top bar, pinned-bottom in a sticky bottom bar, everything else (or the ★ page node) in a scrolling main
area between — the review-flow + pill-top + pill-bottom shape, with NO free-floating positioning. Region
is a bounded enum (`top`|`bottom`|undefined=main) on the FlowNode data — agent-pickable, serialisable.
Composed POC-side (`SpikePagePreview` over `CroutonLayoutRenderer`).

**Pinning is CARD-LEVEL (current truth).** You pin a whole node; a pinned bar is its own card, assembled
in Preview. Two related ideas were considered and **decided against / deferred**:
- **Per-pane pin** (pin one pane *inside* a composed layout) — **deferred**, not building it now;
  card-level pinning is enough. (To pin an element that's snapped into a layout, detach it first.)
- **Per-pane size *lock*** — **dropped.** It only existed to make a pinned bar short, which **intrinsic
  block sizing now does automatically** (see below). A per-instance size lock would reintroduce the
  per-instance flex control we deliberately avoid ("the component decides"). A block needing a specific
  size declares it intrinsically (or via a block variant), not a manual lock.

### Per-element resize + intrinsic block sizing (#954 — replaces the global slider)

Two decisions that resolve "how do blocks size / how do I preview responsiveness", deliberately the
*bounded* way (no per-instance flex panel — that would just be rebuilding CSS):

- **Responsiveness is per-element, not global.** The old board-wide responsive slider is **gone**. Each
  card has a **corner resize handle** (shown when selected) — drag it to set the node's width/height,
  and the card renders **responsively at that width** (its own preview). Opening edit lands at the
  node's resized width. (`data.width/height` on the FlowNode; `SPIKE_SET_SIZE_KEY`.) Once a width is
  set, the card switches to a **read-only responsive preview** (`CroutonLayoutResponsiveRenderer`,
  `interactive: false`) — splitter drags then resize the *card*, not its internal panes (editing pane
  sizes is the edit view's job). `previewing = typeof data.width === 'number'` (SpikeBlockNode).
- **The component decides its own size ("intrinsic sizing"), as DECLARED DATA (#971).** Each block
  carries a **sizing descriptor** on the `croutonLayoutBlocks` registry entry —
  `sizing: { width: 'fill' | 'hug', height: 'fill' | 'hug' }` (defaults to fully `fill`). `hug` = size
  to content, `fill` = stretch. A **Top bar / Bottom nav declare `height: 'hug'`**; List/Form/Chart/
  Stats `fill`. So a pinned Top bar comes out as a **short pill** *because the block declares `hug`* —
  not because of where it's pinned, and with **no per-instance align/size UI**. One source the renderer,
  the viability metric, and an agent all read; the agent picks *blocks*, not flex values. Read POC-side
  via `blockSizing()` / `nodeHeightSizing()` (`app/utils/spike-layout.ts`); honoured in the Preview
  (`SpikePagePreview` maps a `hug`-height node → an `height:auto` pane → short bar, per region).
- **Composites DERIVE their rules — component-driven, all the way up (#972 follow-up).** A composed
  layout (a split, or a `nested` layout-of-layouts) is itself a component and **publishes the same
  contract its children do**, folded bottom-up by `deriveSizing()` (`app/utils/spike-layout.ts`):
  a **hard floor** = the widest single leaf (a row can always reflow to a column, so this is the
  absolute min it survives down to) and a **soft floor** = `sum` of children along a horizontal axis /
  `max` across a vertical one (the comfortable width before it stacks). A leaf *declares* its
  `minWidth`/`fill`-`hug`; a composite *derives* them, recursively. Prototyped POC-side: the per-element
  **resize can't drag a card below its hard floor** (so a layout literally can't violate its
  components' rules), and a selected card shows a **floor readout** (`stacks <Npx · floor Mpx`).
  - **Considered & deferred — a MANUAL min/max override on a composite.** Sometimes you may want to
    pin a specific row/layout to its own min or max (not just the derived floor). Deliberately **not
    built**: composite rules are *derived* for now, and a per-instance min/max settings panel risks
    reintroducing the per-instance flex control we avoid. **Revisit after graduation** — build it test-
    first in the real setting only if the derived floors prove insufficient there. (Leaf intrinsic
    rules stay component-level/declared; per-breakpoint behaviour stays in the responsive editor.)
- **Graduation note:** the descriptor currently rides the **inferred** app.config type (the POC adds
  `sizing` to entries without touching the package type). Two pieces remain package work in
  `crouton-layout`: (1) move `sizing` onto the typed `CroutonLayoutBlockDefinition` so it's a first-class
  field; (2) have the package **renderer honour it INSIDE a split** — make a *pane* hug its content
  between siblings (the Preview only hugs at the region level today). (3) **Composite derivation**
  (`deriveSizing`) belongs in the `crouton-layout` viability engine (it already folds leaf min-widths
  for stacking) with the derived contract carried **on the `nested` node**, so a parent reads a
  sub-layout's floor without re-deriving — the formalisation of "a leaf declares, a composite derives".

### Per-block display variants (#970 — bounded "collection viewer options")

A block can expose **display variants** — bounded, enumerated layouts of the *same* data (e.g. the
Artists list: **rows · cards · table**). It's the "collection viewer options" ask, kept inside the
expressiveness boundary: a variant is an **enum an agent could equally pick**, not free config.

- **Declared on the registry** as a `variant` **select** field in the block's `configSchema`
  (`artists-list` in `app/app.config.ts`) — the bounded option list lives in one place the renderer's
  `sanitizeConfig` enforces (an unknown value is dropped) and an agent reads.
- **Serialised on the leaf** (`leaf.config.variant`), so the choice persists with the layout and
  round-trips. Set via `setLeafConfigValue()` (`app/utils/spike-layout.ts`) onto the base root **and**
  every breakpoint-root override (mirrors `setCollapseRecipe`), so whichever root resolves carries it.
- **Picked in the edit view**: select a pane → the options panel shows a **Display** chip row
  (`SpikeFocusShell`); a tap re-renders the block in that variant. The package renderer already merges
  `config.variant` into the block's props, so the block (`SpikeListBlock`) just reads a `variant` prop.
- **Graduation note:** this reuses the package's existing per-breakpoint variant channel
  (`LAYOUT_VARIANTS_KEY`) only at render-merge time; the *leaf-serialised* variant + the in-view picker
  are POC-side. On graduation, fold the picker into the package author and keep variant declaration on
  the typed block definition.

### Page-context render + the card IS the preview (graduation direction, #983)

Two decisions that surfaced *during* graduation (not proven POC-side — captured here as the settled
direction for the build; `new` entries in `spec.json`). They resolve the render-model tension that a
separate Preview overlay kept exposing: **admin fills-and-scrolls; a page flows.**

- **A collection block renders differently on a PAGE than in the ADMIN.** In the admin a list *fills
  its pane and scrolls internally* (a working dashboard surface) — correct there. On a **page** that
  makes no sense: a list is a **content-sized block** showing a *set number of items* (default **10**,
  settable per block), then **more via a bounded viewer option** — **load-more** (default), **paginate**
  (numbered), or **search/filter** — plus the existing **display variant** (rows/cards/table). Empty →
  a **small block**, not a full-height void. This is NOT new machinery: the block already slices to a
  page + has the pager/search/variants (the #970 "collection viewer options"); page-context render just
  reuses them **at content height, no internal scrollbar**. It stays inside the expressiveness boundary
  — you pick from *bounded, enumerated* viewer options, never hand-tune per-instance flex (the rejected
  control). **Not** "force everything to flow": the LIST has a page render; the page scrolls as one.

- **The board card IS the live page preview — there is no separate Preview.** Two renders of the same
  page (a board thumbnail + a Preview overlay) is two sources of truth, free to diverge — the root of
  the Preview whack-a-mole (it was removed, #983). Instead the **card on the Vue Flow canvas renders the
  real page**, live, at its own width: reflows responsively (the `@container` CSS grid), shows the
  page-context render above, and **scrolls inside itself** when content exceeds the card (a screen).
  Resize the card = resize the screen. WYSIWYG, one render, zero board/preview drift. **Feasible only
  because #1178** replaced the reka-Splitter ResizeObserver (which OOM-crashed inside a zoomed VF node —
  the reason the card was frozen to a static thumbnail) with an **observer-free CSS-grid render**. Two
  real unknowns to verify on device before trusting it: (a) **scroll-inside-a-card vs pan-the-canvas**
  under zoom (the crash is gone, but nested-scroll-in-a-transform is where it got hairy); (b) whether
  **all cards render live** or only the focused one (perf — many data-bound renders). Build order: the
  page-context list render first; "card = live preview" then falls out of pointing the card at that
  render instead of `BuilderNodePreview`.

### Board gestures (direct manipulation)

- **Snap = two-stage dwell-to-arm (#941, #948).** Near a snap point → **soft** (blue, wide, pulsing).
  Hold ~0.6 s → **armed** (green, release-to-snap). The arm timer is keyed on the **target only**
  (not the exact seam), so finger jitter that flips the nearest seam doesn't reset it; the seam keeps
  tracking your finger. (No "release to snap" text — the green ring + guide bar say it.)
- **Pane-drop: drop OVER a layout → add beside the targeted pane (#972).** Dragging a card over a
  composed layout (≥35 % overlap) targets the **rendered pane under the cursor** and adds the dragged
  node as a **sibling on the side you're nearest** (L/R/T/B by quadrant of that pane). It **flattens
  into the parent row/column** when the side runs *along* it (drop right of a block in a row → it joins
  the row), and **wraps the pane in a new perpendicular split** otherwise — so you can add to the
  **right of a pane that lives in a vertical stack** ("right of the chart"), which the old seam-only
  insert couldn't reach (a vertical stack has no right-seam). A lone block is one pane (path `[]`).
  Targeting = `collectLeaves` (tree sub-rects) → leaf under cursor + edge; apply = `applyPaneDrop`
  (`app/utils/spike-layout.ts`) → `insertAtPath` (flatten) or the package's `dropNode` (wrap). The
  armed ghost reuses the #946 ease-apart (applies the same edit with a `__dropghost__` skeleton).
  **The drop commits by tracking the dragged node's id** (`draggedId`) — position-delta detection
  misses it because Vue Flow mutates node positions in place, so the re-emitted rows show no delta;
  the target pane node is likewise re-found by **stable id** (`paneDrop`/`targetId`), not by reference.
- **Ghost mirrors the dragged item; panes ease apart to make room (#946/#947).** On an armed pane-drop the
  target applies the drop with a **ghost skeleton matching the dragged node's footprint** (every leaf → a dashed
  `__dropghost__` placeholder, splits/nested preserved) and renders that — a 2-row stack opens a *2-row*
  slot, growing the row to fit (not a flat 1×1 sliver). Real panes slide via the FLIP reflow; the card
  grows with a transition. Reverts on un-arm.
- **Detach / reorder** (board gesture): long-press a merged node → its panes **wiggle** (grabbable),
  then pull a pane — tracks your finger 1:1 (zoom-corrected). **Reorder is the default**: slide the pane
  across to another slot (green "Move here") and release to move it there. **Detach** needs a clear pull
  **OUT** of the card — the finger must pass a `DETACH_MARGIN` (~64px) beyond the card edge, so a small
  overshoot while reordering doesn't tip into a detach. Under the threshold it springs back. Cancel the
  wiggle by tapping outside / Esc / Done. Gating the gesture behind the hold stops a plain select-and-drag
  from detaching. **Both the slot detection (reorder) and the detach margin measure against the visible
  card (`.spike-block-node`), NOT `.vue-flow__node`** — see the gotcha below; getting that wrong is what
  made reorder silently impossible (#952).
- **Drag glow.** A dragged card carries a light-green halo (Vue Flow `dragging`, forwarded by
  `CroutonFlow`), fading on drop. Snap rings (emerald armed / sky soft) outrank the glow.

### Framing & camera

- **Enter a page → snap to fitted, instantly.** `fitPage()` frames the page node by its **known
  geometry** (`position` + footprint `sizeOf`), NOT Vue Flow's measured size (stale on fresh mount),
  with `duration: 0` (no zoom-out wobble). Retries (`nextTick` + 40/120/300 ms) ensure it lands once
  `flowRef` mounts.
- **Add a block → land clear, centred, green.** Placed in a **clear spot right of every node** (from
  real footprints — a fixed `count×300` stride dropped it *under* wide/moved layouts), camera **centres
  on it** at a moderate zoom, green "just added" glow fades after ~2.5 s.
- **Pinch-to-zoom over a layout (#948).** A 2-finger pinch starting on a node was swallowed by the
  node's drag. `SpikeBlockNode` catches a 2-finger gesture in the **capture phase** (before the drag);
  the page drives zoom via `setCenter`, keeping the pinched point under the fingers. One finger still
  drags/long-presses.
- **Page ⇄ Site transition.** **Simultaneous** cross-fade (both views stacked absolutely, one in as the
  other out) + subtle directional scale = a gentle zoom. NOT `mode="out-in"` (that flashed the dark bg
  and delayed the board mount so `fitPage` missed). **Stopgap** — see graduation requirement.

## Gotchas / limitations (known, accepted for the POC)

- **Vue Flow geometry gotchas (cost us v32 — found by reproducing headless).** Two traps, both "you're
  reading the wrong element":
  - **The node wrapper `.vue-flow__node` is SMALLER than our card.** Our card (`.spike-block-node`,
    sized `footprint × base`, `overflow-visible`) overflows its Vue Flow node wrapper — the wrapper's
    measured width can be a fraction of the card's. Any hit-testing of the panes (reorder slot detection,
    detach margin, the edit-open origin rect) MUST measure against `.spike-block-node`, not
    `.vue-flow__node`, or every in-card point reads as "outside". (They share the same LEFT edge, which is
    why detach still worked while reorder couldn't — reorder needs the WIDTH.)
  - **The zoom transform is on `.vue-flow__transformationpane`, not `.vue-flow__viewport`.**
    `.vue-flow__viewport` reads `transform: none` → identity → `z=1`. Pinch math read that and never
    actually zoomed. Read `.vue-flow__transformationpane` for the live `translate()…scale()`.
  - **Fit must use known geometry, not `fitView`.** `fitBoard`/`fitPage` frame via `fitBounds` over the
    union of each node's `position + sizeOf` — Vue Flow's own `fitView` (and its controls' ⛶) measure
    the small wrapper and zoom INTO the oversized card. (The Site flow's normal-sized cards are fine, so
    the VF ⛶ is left enabled there.)
- **Overlays must MEASURE the rendered panes, not compute them.** The wiggle/pull faces + reorder slot
  bounds (`panes` in SpikeBlockNode) sit over the layout's top-level panes. Footprint (cols/rows) was
  wrong first (#953); `defaultSize` % was the next attempt but *also* drifts, because the renderer's
  real geometry diverges from the tree whenever it reflows — reka enforces per-pane min-widths, a
  horizontal split **stacks vertically** when narrow (`@container`), nested splits carry their own
  proportions, and **a resized card renders through the responsive renderer** (so the panes reflow to
  the resized width while `defaultSize` is unchanged) (#954, IMG_1069). The fix: `panes` MEASURES the
  shallowest rendered panes (`[data-panel]` / stacked `[data-crouton-pane]`) inside the card as % of
  the card box (re-measured on resize/arm/re-render), with the `defaultSize` math kept only as a
  pre-measurement fallback. Same lesson as the edit-view selection — hit-test the real DOM, never the
  abstract tree. (NB: the watch that re-measures eagerly reads `renderNode`, which references the pull
  state, so it must be declared *after* `activeIndex` et al. or it throws a TDZ error.) **Each measured
  pane is CLAMPED to the card box on all four edges (#972 follow-up, IMG_1071):** when the content is
  taller than the card it overflows, so a lower pane's raw rect extends below — clamp keeps a face on
  the pane's *visible* portion, and a pane scrolled fully out collapses to zero size (hidden by `paneRect`).
- **Hit-test the RENDERED panes, never the abstract tree.** Anything that maps a screen point to a pane
  (the edit view's block selection + dim overlay) must measure the real DOM (`.croutonpane` leaf
  elements), because the renderer reflows panes via CSS `@container` (a horizontal split STACKS
  vertically when narrow) — a reflow the `LayoutTree` never reflects. Tree-derived regions select the
  wrong pane at narrow widths. SpikeFocusShell reads the innermost `.croutonpane` els in document order
  and maps them to the tree's depth-first leaf order; falls back to tree regions when counts differ
  (panes collapsed into the gutter). Clean fix on graduation: have the renderer tag each leaf with
  `data-block-id` so the mapping is by id, not order. (#952, IMG_1059)
- **Pinch uses `setCenter`, not `setViewport`.** Vue Flow exposes `setCenter`/`fitBounds`/`fitView`
  here, not `setViewport`, so pinch is reconstructed from the live transform. Clean fix: expose
  `setViewport` from `crouton-flow`.
- **FLIP for structural reflow lives in the package** (`@fyit/crouton-layout`, `useLayoutFlip`, #943):
  panes are keyed by index so a count change rebuilds them — a CSS `flex-grow` transition can't fire.
  `useLayoutFlip` measures-before / tweens-from-old-box, purely additive (no key/size/reka change),
  survivors matched by a structure-derived `contentKey`.
- **Deploy needs `@fyit/crouton-feedback` declared as a direct dep (#976 fallout).** `crouton-devtools`
  calls `installModule('@fyit/crouton-feedback')` at build time, resolving it from the *consuming app's*
  context. Under pnpm's strict `node_modules` a transitive dep isn't reachable from the POC, so
  `nuxt build` (= the staging deploy) fails with *"Could not load `@fyit/crouton-feedback`"* even though
  `pnpm dev` is fine. **Two POC-side fixes are needed:** (1) declare `@fyit/crouton-feedback:
  workspace:*` in the POC's `package.json` so it resolves; AND (2) add `@fyit/crouton-feedback` to
  `deploy.config.json` `layerPackages` so CI builds its (gitignored) `dist` — the deploy only builds
  `layerPackages + crouton-devtools`, so without this the module file never exists on the runner.
  (Systemic — every `crouton-devtools` consumer hits this; the clean fix is in the package: have
  `crouton-devtools` resolve/build feedback via its OWN resolver, or guard the `installModule`.)
- **POC block components must be registered GLOBALLY.** `CroutonLayoutRenderer` resolves a leaf's block
  via `<component :is="block.component">` (a runtime string), which only resolves globally-registered
  components. Nuxt's per-file auto-import (`<SpikeSpacer/>`) does NOT make the name resolvable that way,
  so a POC block component renders as a dead `<spikespacer>` element. `app/plugins/spike-global-blocks.ts`
  registers `SpikeSpacer` + `SpikeGhostPane` on `vueApp` so the registry's `component:'…'` resolves.
  (Package block components like `CroutonLayoutSpikeStats` are already global.) Add any new POC block
  component there.
- **Spacer block (#952):** `spacer` → `SpikeSpacer`, a registered layout primitive that renders empty
  space (faint dashed hint in the builder). Add it from the palette; it snaps/reorders/resizes like any
  block to push neighbours around or hold a gap. Small `minWidth` (40) so it can be a thin gutter.
- **Board state is EPHEMERAL (in-memory only).** Each page's board is cached in a `pageBoards` Map
  (`spike-app.vue`) and restored when you re-enter that page, but **nothing persists** — a reload
  starts from `composeDefault`. This is by design for the POC; the durable persistence is the
  graduation round-trip (serialise the `LayoutTree` onto the ticket / a store), #974. Don't mistake the
  re-enter restore for saved state.

## Tooling — per-version preview URLs (#940)

Each iteration can get its OWN immutable Cloudflare Workers preview URL so versions can be opened
side-by-side, WITHOUT overwriting the live `crouton-builder-demo.pmcp.dev`. Run the **Deploy POCs**
workflow with `mode=version` (default `deploy` unchanged) → `pnpm run cf:version`
(`wrangler versions upload`) prints the preview URL (`<version-id>-crouton-builder-demo.<account>.workers.dev`)
into the run summary. Caveats: preview URLs are on `*.workers.dev` (not the custom domain); a version
**shares the same D1/KV** as the live Worker (same data, different code); needs a one-time Cloudflare
dashboard enable of the worker's **workers.dev subdomain + Preview URLs**. (Linking these URLs into the
in-app changelog so the `vNN` chip jumps between versions is a follow-up.)

## 🔖 Stable element hooks (graduation vocabulary, WS1 #984)

The reconcile gate added `data-handoff` hooks on the states that are hard to locate from the outside,
so the doc, an exploratory agent, and the derived e2e tests all target the **same names** — and the
rebuilt app (#988) **reproduces these verbatim**, so one agent runs identically against the POC and the
graduated app. (These are the right "references to elements" — not `file:line` code refs, which rot.)

| State | Selector | Where / when |
|---|---|---|
| armed snap | `[data-handoff="snap-guide"][data-armed="true"]` | `SpikeBlockNode` edge guide; green once the dwell-arm fires (soft blue = `data-armed="false"`) |
| ghost slot | `[data-handoff="ghost-pane"]` | `SpikeGhostPane`; the `__dropghost__` ease-apart placeholder |
| ★ page badge | `[data-handoff="page-badge"]` | `SpikeBlockNode`; the one node that is "the page" |
| floor readout | `[data-handoff="floor-readout"]` (+ `data-hard-floor` / `data-soft-floor`) | `SpikeBlockNode`; selected card's derived floor |
| region pills | `[data-handoff="region-pill"]` (+ `data-region`) | `SpikeBlockNode`; pinned top/bottom |

## 🎓 Graduation requirements (must hold in the real package + app)

- **The agent ⇄ human round-trip (the North Star — see top).** The graduated builder is the visual
  front-end to an issue-tracked, agent-executed layout spec:
  - **Serialise the board to a clean, diffable `LayoutTree`** (layouts → blocks → splits/sizes/
    breakpoints) — the canonical interchange format both the agent and the builder read/write. (The model
    already exists; what's needed is a stable, human-readable serialisation + the page-flow tree around it.)
  - **Persist a version back to the GitHub ticket.** A human's edited layout saves onto the tracking
    issue as the **command/spec** for the agent to (re)build from — so "a version in the builder" becomes a
    concrete instruction on the ticket. Round it both ways: agent writes the tree → human edits visually →
    edit posts back → agent reads it. (Mirrors the existing `schema-review` / `ui-proposal` sign-off loops,
    but the artifact under review is the layout tree.)
  - This is the whole point of the builder — it's not a standalone design toy, it's the human's seat in an
    AI app-generation pipeline (crouton collections → graph/charts blocks → layout-engine pages → app).


- **Make page ⇄ flow REAL routing, not one view.** Today `/spike-app` is one route and `selectedPageId`
  `v-if`/`v-else`-swaps with a cross-fade — a *visual* transition pretending to be navigation. The real
  builder is **pages that link to each other** = a router. Graduated version:
  - **URL per view** — `/builder` = Site flow, `/builder/[pageId]` = that page's board (deep-linkable).
  - **Real history** — browser back/forward (back from a page → the flow).
  - **Inter-page linking** — page-to-page is a plain route link.
  - **Transition via the View Transitions API (shared-element morph)** — matching `view-transition-name`
    on the flow's page card and the page board so the card **grows into** the board and shrinks back.
    The current cross-fade is explicitly the stopgap.
  - Cost: lift the shared board state, move the board into `[pageId].vue`. Nothing in the spike is
    wasted (board, snapping, ghost/ease-apart, FLIP, pinch, add-block all carry over).
- **Backfill test-first coverage** for the genuine logic when it lands in `packages/*` (the #774 gate
  is off for `pocs/*`, on for `packages/*` — graduation is where the tests get written).
- **Multiplayer + collaborative undo via `crouton-collab` (Yjs).** `crouton-flow` already extends
  `crouton-collab`; the spike runs Vue Flow in *ephemeral, non-synced* mode. The graduated builder
  should be able to **"build together"** — sync the board through a `CollabRoom` (a `flowId` + the
  synced data mode + presence, all infra that already exists). When it does, **undo must switch to
  `Y.UndoManager`** (per-user transaction undo) — the POC's whole-board snapshot stack is a
  *single-user placeholder* that would clobber other people's edits in a shared session.
