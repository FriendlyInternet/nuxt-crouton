# Builder page editor — the outline / DOM-tree direction (proposed)

> Status: **proposed direction for builder C1** (epic #983). Captured from the
> 2026-08-05 design conversation. Not built. Awaiting a human walk + sign-off
> before it becomes the settled contract. Spec entry: `outline-tree-editor` in
> `pocs/crouton-builder-demo/spec.json`.

## The problem it fixes

The current page editor is a **free-floating card canvas**: blocks are loose cards
you drag around 2D space and *fling together* to compose a layout. Dragging one
card onto another to build structure is an imprecise, spatial gesture doing a
*structural* job — the drop is ambiguous (which edge? which pane? columns or
rows?), and it's unreadable on a phone (IMG_2221 — a vertical edge line fighting a
horizontal slot). No amount of preview polish (the #1–#5 pane-drop / ghost /
ease-apart work) fully removes that, because the ambiguity is inherent to 2D.

Key realisation: **a page is document flow, not a whiteboard.** The saved page was
never a 2D scatter — it's a `LayoutTree` (split / leaf / nested), which the renderer
turns into real DOM (CSS grid/flex). The free canvas *implied* absolute positioning
the page never had. The tree was always the truth underneath.

## The model

**The page editor becomes an outline of the layout tree — the DOM Elements panel
for the page.** Two jobs, cleanly separated:

- **Add = pick from a list.** Blocks live in a menu; *tap* one to insert it into the
  page. No spawning a floating card you then fling into place.
- **Rearrange = drag, in the outline.** Once on the page, drag a row to move it.

Because a list is 1D, the drop indicator collapses to the *easy* kind — a single
insertion line + an indent guide — instead of the ambiguous 2D edge/pane cue.

### The outline IS the LayoutTree

| Outline | LayoutTree | DOM analogy |
|---|---|---|
| a row | `leaf` | an element (list / form / chart block) |
| a group (indented rows) | `split` (`children[]`) | a flex container |
| group direction toggle ⬌ / ⬍ | `split.direction` row/column | `flex-direction` |
| a sub-app group | `nested` node | a sub-document / iframe |
| drag row vertically | reorder within parent | move node, same parent |
| drag row horizontally | reparent (nest / unnest) | move node into/out of a container |

The one thing a list can't *imply* is **direction** (columns vs stack) — so each
group row carries an explicit ⬌/⬍ toggle. Bounded, readable, and equally settable
by an agent.

## Why it's cheap to build (new UI, same engine)

The pure tree transforms already exist in
`@fyit/crouton-layout/app/utils/layout-edit.ts` and are unit-tested:

- `moveChild(root, path, from, to)` — reorder siblings
- `moveNode` — reparent / cross-tree restructure
- `makeNested` / `getNestedLayout` / `replaceNestedLayout` — nest / unnest
- `removeNode`, `insertAtPath` — delete / insert

The renderer (`CroutonLayoutRenderer`) already renders a `LayoutTree` to DOM, so a
**live preview beside the outline** is the existing read-only render. This is a new
*view* over the same engine — not a new engine.

## Rough plan (when signed off)

1. **Survey** the current builder board (`pocs/crouton-builder`) — what to keep
   (site-level page nav, the collections, the renderer) vs retire (the Vue Flow
   free-card canvas + the snap/pane-drop/ghost gesture cluster).
2. **Outline component** — a tree view of the page's `LayoutTree`: rows with a
   drag-handle, indentation for depth, a per-group ⬌/⬍ toggle. Vertical drag →
   `moveChild`; horizontal drag → `moveNode` / `makeNested`.
3. **Add-from-list** — the block palette as a tap-to-insert menu (insertion line
   shows the target slot); insert via `insertAtPath`.
4. **Live preview** — the existing `CroutonLayoutRenderer` beside the outline,
   updating on every edit.
5. **Retire the canvas** — remove the free-floating card surface and the
   drag-to-compose gestures (their spec entries stay as reframed history).
6. **Walk + sign off** against the `outline-tree-editor` spec entry → flip it to
   `settled` with the recorded token.

## What stays / goes

- **Stays:** site-level page navigation, the generated collections, the layout
  engine + renderer, the `LayoutTree` data model, the `layout-edit` transforms.
- **Goes:** the free-floating 2D card canvas and drag-to-compose (snap-dwell-arm /
  pane-drop-beside / ghost-ease-apart) — the C1 gesture work that proved the model
  but is superseded by the outline for *composition*.
