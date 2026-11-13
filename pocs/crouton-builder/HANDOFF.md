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
- **The board draws the page's rows (#3865).** Vertical splits are the page's grid
  (`pageRowTracks`, no row handle); side-by-side rows stay reka (in `BoardTree.vue`: widths + handles) but take
  content height, top-aligned (`!h-auto !items-start`); a split with one visible child draws
  that child alone; leaves render `page` context; the frame scrolls as one page. `h-full` /
  `min-height: 100%` only inside a grid cell (`inGridCell`), like the renderer there.
- **Board drag is one pointer gesture** (`board-drag.ts`): hold-then-drag with `elementFromPoint`
  hit-testing and `touchmove` cancelled only while a drag is live. No HTML5 drag — it never starts
  on iOS. Width authoring is a scaled frame (`useBoardWidth`), presets plus a free drag.
- **The block row is grouped by collection** (#3748, `utils/palette-groups.ts`): one chip per
  collection (`Artists · Form` → group `Artists`, item `Form`) plus **Layout** for `chrome`
  blocks, each opening a `UPopover` menu. Blocks with neither shape — crouton-layout's generic
  `collection-list` / `entity-form` / `stats`, `__dropghost__` — stay registered (old pages
  render) but aren't offered. A held menu item goes see-through while it drags, then closes.
- Board panes are floored at the same floor the served page uses (`boardPaneMinPct` →
  `deriveSizing(...).hardMinWidth`: a block's `minWidth`, a nested split's widest block), so
  editor and page give each pane the same width (#3746, `tests/board-vs-preview.test.ts`).
- **Groups on the board** (#3906, `utils/board-groups.ts`): the board edits a working tree where a
  group is a split marked `__boardGroup`; it is saved as today's `nested` node (`expandGroups` on
  read, `collapseGroups` in `writeRoot`). A middle drop never makes a group inside a group; a group
  left with one block stops being a group; the group's sheet has Ungroup.
- **Drop targets** (#3916, `utils/board-target.ts`, pure): a point on the board resolves to ONE
  target, first match wins — **page** (outside the tree, or within 20 px of its sides: a full-width
  line / full-height column, or joining the page's own row/column) → **group** (within 20 px of a
  group's frame, outermost first: beside the group) → **block** (its edges or middle, as before) →
  **block above** (empty space under a short block: that block's bottom). Resize handles are never a
  target. A page/group target's bar is `BoardDropBar` (fixed, over the clipped rect); a move that
  changes nothing writes nothing (`movePaneToTarget` returns the same root).

## Gotchas

- Verification rungs: Chromium locally shows most things; **Safari differs on frame-less flex /
  grid sizing**. `apt-get install gir1.2-webkit2-4.1 python3-gi xvfb` gives a WebKitGTK engine in
  the sandbox; drive `/site/<slug>?debug=1` with it — the debug block prints width, breakpoint,
  hidden list, the visible tree and every pane's rendered box, which is how the Safari zero-height
  bug was pinned (#2490).
- reka's splitter re-reports stale proportions on a variant/width switch; the board ignores no-op
  layout reports and remounts on `currentId:activeBreakpoint`; BoardTree only forwards a layout
  report during a handle drag or key press, so reka's min-width clamp on open/width change never
  edits the page (#3746).
- BoardTree decides stacking from the whole split (`deriveSizing(props.node)`) but lays out only
  visible children; a hidden sibling's minWidth can stack a one-child split into a fixed 288px
  item with an empty band below and no drag handle (#3814).
- A `pocs/*` typecheck sweeps the whole monorepo and reports thousands of unrelated errors; the
  gate is `pnpm typecheck` (apps) after a package change.

## Graduation requirements

- The splitter + drop layer (`BoardTree`/`BoardPane`/`board-drag`) is the candidate for
  extraction into `crouton-layout` once it holds up on a phone across the spec entries.
- The served page needs a public data path for team-scoped blocks before it can be truly public.
- Board and served page must stack the same way at narrow widths (open: the board squeezes panes
  side by side where the page stacks them). Hidden panes no longer count toward the board's
  stack check (#3828); both now use partitionCollapsed's visible tree.
