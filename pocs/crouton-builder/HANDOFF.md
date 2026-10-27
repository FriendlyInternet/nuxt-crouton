# crouton-builder — handoff (current truth)

> Original spike's handoff (North Star, signed-off decisions): [`docs/origin-HANDOFF.md`](docs/origin-HANDOFF.md).

What this POC is: a phone-first board for putting blocks together and seeing the result in
every shape — drag to add, drag to resize, design per width, hide blocks into a nav or an edge
trigger, then open the page as itself. The behaviour contract is `spec.json` (one entry per
signed-off behaviour); this file is the architecture and the decisions behind it.

## Data model

- A page's `board` holds `{ live, variants[] }` — each variant is a serialised `LayoutTree`
  (`@fyit/crouton-layout` `serializeLayoutTree`); `live` names the one `/site/<slug>` serves.
  `layout` mirrors the live tree for older readers.
- Responsiveness is the package's breakpoint model: `breakpoints[].minWidth` locks upward,
  per field last-wins (`resolveLayoutAtWidth`). Hiding at a width writes that breakpoint's
  `collapsed` list; higher breakpoints are pinned to their resolved state so a change at a
  narrow width never leaks upward.
- Every pane minted in the builder carries its own short `id` (`LayoutLeaf.id`), so a hidden
  list names a pane, not a block (`isLeafCollapsed`: id first, block id for older trees).

## Decisions (signed off)

- **Served page = saved page.** `/site/<slug>` reads `GET /api/site/:slug` (title + board only,
  found by slug). ↗ in the builder saves pending edits before opening it. The visitor still signs
  in: collection blocks are team-scoped, so an anonymous render would be an empty frame — a public
  data path is a separate piece of work.
- **A hidden block becomes navigation.** Its collapse recipe says where the trigger lives
  (`placement: edge | nav`) and how it opens (`reveal: slideover | drawer | modal | page`). Nav
  blocks (`BuilderNavBlock`, `BuilderToolbarBlock`) inject `BOARD_HIDDEN_KEY` and render the nav
  items; `HiddenBlocks` draws edge triggers and the overlays. Same layer on the board and on the
  served page, so there is one behaviour, not a preview of it.
- **The page render never fills a frame.** In `CroutonLayoutRenderer` a read-only split
  (`interactive=false`) always takes the view-mode grid (content-flow rows, `fr` columns, a
  container-query stack), never the admin STACKED / HUG flex paths — those assume a fixed-height
  frame, and WebKit sizes a `flex:1 1 0` column item to zero without one. Blocks follow the same
  rule (`LayoutCollection`, `LayoutForm`: `admin` fills + scrolls, `page` sizes to content).
- **Board drag is one pointer gesture** (`board-drag.ts`): hold-then-drag with `elementFromPoint`
  hit-testing and `touchmove` cancelled only while a drag is live. No HTML5 drag — it never starts
  on iOS. Width authoring is a scaled frame (`useBoardWidth`), presets plus a free drag.

## Gotchas

- Verification rungs: Chromium locally shows most things; **Safari differs on frame-less flex /
  grid sizing**. `apt-get install gir1.2-webkit2-4.1 python3-gi xvfb` gives a WebKitGTK engine in
  the sandbox; drive `/site/<slug>?debug=1` with it — the debug block prints width, breakpoint,
  hidden list, the visible tree and every pane's rendered box, which is how the Safari zero-height
  bug was pinned (#2490).
- reka's splitter re-reports stale proportions on a variant/width switch; the board ignores no-op
  layout reports and remounts on `currentId:activeBreakpoint`.
- A `pocs/*` typecheck sweeps the whole monorepo and reports thousands of unrelated errors; the
  gate is `pnpm typecheck` (apps) after a package change.

## Graduation requirements

- The splitter + drop layer (`BoardTree`/`BoardPane`/`board-drag`) is the candidate for
  extraction into `crouton-layout` once it holds up on a phone across the spec entries.
- The served page needs a public data path for team-scoped blocks before it can be truly public.
- Board and served page must stack the same way at narrow widths (open: the board squeezes panes
  side by side where the page stacks them).
