---
name: crouton-layout-reference
layer: stack
description: System reference for the crouton layout engine (@fyit/crouton-layout) — the LayoutTree/layout_configs data model, the croutonLayoutBlocks registry and sizing contract, the viability metric, the deterministic placer (#709), and how layouts persist and seed. Use when reasoning about WHY a layout renders/composes/persists the way it does, when a question is shaped like "what is a LayoutTree / where do layouts live / why did the placer pick this arrangement / why won't this pane shrink / where does minWidth get read", or when a generated POC boots with the wrong (or no) default layout. Trigger phrases: "layout tree", "layout_configs", "viability check", "composeDefaultLayout", "block sizing contract", "why is my layout not viable". For authoring a block component, use the block-authoring skill instead.
---

# crouton-layout-reference — layout engine theory

One-line purpose: the verified system model of `@fyit/crouton-layout` — data shapes, sizing contract, viability math, placer rules, persistence — so you can reason about layout behaviour without re-deriving it from source.

## When to use / when NOT to use

| You want | Go to |
|---|---|
| Understand/debug how layouts compose, size, persist, seed | **this skill** |
| **Author or fix a block component** (the `@container` rule, list/form playbooks, picking `minWidth`) | `block-authoring` skill |
| The crouton mental model, dependency invariants, registry overview | sibling `crouton-architecture-contract` |
| What the generate pipeline emits (incl. `crouton.layout.json` in context of all artifacts) | sibling `crouton-generation-reference` |
| Full per-file component/composable map of the package | `packages/crouton-layout/CLAUDE.md` (Key Files — the FIRST table; the second "Key Files" heading is a stale leftover shell, ignore it) |
| Boot an app and see a layout live | sibling `crouton-run-and-operate` |

## The 30-second model

**Layout is data, not `.vue`.** A team's admin surface is a `LayoutTree` — a JSON tree of panes — persisted in the `layout_configs` DB table and rendered at runtime by recursive splitter components. Leaves of the tree are **blocks**: components a package registers as placeable via the `croutonLayoutBlocks` app.config registry. Every arrangement is gated by one objective metric — **viability** (every block gets ≥ its declared `minWidth`) — used identically by the deterministic **placer** at generate time and the renderer at runtime. Dependency direction is a HARD RULE: `crouton-layout → crouton-core`, never reverse; feature packages contribute blocks via the registry, never by depending on the layout package (see `crouton-architecture-contract` for why).

The package is **default-on** (`crouton.manifest.ts` has `bundled: true`) — every crouton app gets the engine unless `features.layout: false`.

## 1. The data model (`LayoutTree` / `layout_configs`)

**Types live in `crouton-core`, not `crouton-layout`** — `packages/crouton-core/app/types/layout.ts` and `layout-block.ts` — deliberately, so feature packages (bookings, pages) import the shared contract from core and need no dep on the layout package.

```ts
interface LayoutTree {
  renderer: 'panes'              // the only shipped renderer; 'canvas'/'spatial' are open epics (#855)
  root: LayoutNode
  breakpoints?: LayoutBreakpoint[]  // authored responsive checkpoints (WS5 #874)
}
type LayoutNode = LayoutLeaf | LayoutSplit | LayoutNested
```

| Node | Shape | Meaning |
|---|---|---|
| `leaf` | `{ type:'leaf', blockId, config?, collapse?, defaultSize?, minSize? }` | One placed block. `config.collection` binds it to a generated collection's registry key (e.g. `shopProducts`). `blockId` is resolved against the registry — **allowlisted**: unknown id → safe fallback, never an arbitrary component. |
| `split` | `{ type:'split', direction:'horizontal'\|'vertical', children }` | A reka-ui SplitterGroup. Horizontal divides **width**; vertical divides height (each child keeps full width). |
| `nested` | `{ type:'nested', layout: LayoutTree, label? }` | A whole sub-layout in a pane — "layouts in layouts" (WS2 #871). Carries its own `renderer` + `breakpoints`; renderer/viability/edits recurse into `layout.root`. |

`defaultSize`/`minSize` (on any node) are **percentages of the parent split**, not px. Px floors come from the block sizing contract (section 2).

**Breakpoints** (`LayoutBreakpoint`): min-width checkpoints that **lock upward**, resolved per-field last-wins by `resolveLayoutAtWidth` (`app/utils/layout-responsive.ts`). Each can override `root` (full re-arrangement), `collapsed` (blockIds), `variants` (per-block display variant), `collapseStyle`. This is the *explicit* responsiveness layer; the *intrinsic* layer is each rendered pane being a CSS `@container` (`.croutonpane` class in `LayoutRenderer.vue`) so blocks reflow to their own pane width.

**Collapse vocabulary** (all in `crouton-core/app/types/layout.ts`): `LAYOUT_COLLAPSE_STYLES = ['gutter-tabs','spring-drawer','crt-power-down','iris-portal']` (default `gutter-tabs`, the only out-of-flow one); per-leaf `collapse: { edge, affordance }` recipe (#852, default right-edge tab).

## 2. Blocks: registration + the sizing contract

A block is registered by adding a `CroutonLayoutBlockDefinition` under `croutonLayoutBlocks` in a layer's `app/app.config.ts` (defu-merged across all layers — that's the whole contribution mechanism). `component` is an auto-imported component **NAME string** for `<component :is>` — never a component object, never `resolveComponent()`.

**Snapshot 2026-07-02 — the registry numbers below drift; regenerate with the sizing-mirror grep in the re-verify block before relying on them.**

**The default registry** — `packages/crouton-layout/app/app.config.ts`:

| id | component | minWidth | defaultSize | configSchema |
|---|---|---|---|---|
| `collection-list` | `CroutonLayoutCollection` | 260 | 34 | `collection`, `heading`, `layout` (list/grid/table) |
| `entity-form` | `CroutonLayoutForm` | 320 | 50 | `collection`, `heading` |
| `stats` | `CroutonLayoutSpikeStats` | 200 | 40 | — |

**Bookings additions** — `packages/crouton-bookings/app/app.config.ts`: `bookings-calendar` (`CroutonBookingsLayoutCalendar`, 520/65), `bookings-calendar-only` (460/60), `bookings-list` (300/40), `bookings-locations` (220/25), `bookings-filters` (240/25).

**The sizing contract** (fields on the definition, `crouton-core/app/types/layout-block.ts`; all optional, undeclared ⇒ fully fluid, `minWidth` treated as 0):

| Field | Read by |
|---|---|
| `minWidth` (px) | **The viability floor.** `checkLayoutViability` (gate), `subtreeMinWidth`/`panelMinSizePct` (runtime drag floor), the placer, `deriveSizing` |
| `minHeight` (px) | `deriveSizing` (height fold) |
| `maxWidth`, `aspect`, `resize: 'free'\|'fixed'\|'aspect'`, `density` | declared contract; advisory hints |
| `defaultSize` (% of pane group) | the placer seeds it onto placed leaves; viability's width-share model |
| `sizing: { width, height: 'fill'\|'hug' }` (#986) | `sizingResolver`/`deriveSizing`; the renderer renders a split containing a `hug`-along-axis pane as plain flex (content-sized) instead of a splitter |
| `variants: string[]` (#986) | `blockVariants`/`resolveVariant` — bounded display-variant set; unknown value falls back to the FIRST declared option |

Runtime read side: `useCroutonLayoutBlocks()` (`app/composables/useCroutonLayoutBlocks.ts`) — `getBlock`/`hasBlock`/`resolveComponentName` (allowlisted), `sanitizeConfig` (keeps only declared `configSchema` fields of the right primitive type; wrong/missing → the field's `default`), `checkViability(tree, widths)`, `composeDefault(collections)`.

How to *pick* the values (and the `@container` hard rule) is the `block-authoring` skill's job — don't restate it, load it.

## 3. The viability metric (#710)

File: `packages/crouton-layout/app/utils/layout-viability.ts`. Pure (no Nuxt), unit-tested.

**Definition:** a layout is *viable* iff every placed block gets ≥ its declared `minWidth` (px) at every target container width checked. `checkLayoutViability(root, minWidthResolver(registry), targetWidths)` → `{ viable, violations: [{ blockId, paneWidth, minWidth, containerWidth }] }`.

**Width model** (the only constrained axis is width): a **horizontal** split divides its width among children by normalized `defaultSize` shares (equal when unset); a **vertical** split gives each child the **full** width; a `nested` node recurses into `layout.root` at the same width. Resize-handle pixels are deliberately ignored. Pane widths are rounded to 2 decimals to avoid float dust. There are **no thresholds beyond `minWidth` itself** — the metric is binary per (block, width) pair; the conventional target widths are the placer's `DEFAULT_TARGET_WIDTHS` (`[1280, 768]`, "desktop + tablet").

**Companion exports** (same file):
- `subtreeMinWidth(node, resolver)` — the px floor a whole subtree needs: **SUM** of children for horizontal, **MAX** for vertical. This is the enforcement side: `panelMinSizePct(parentDirection, child, containerWidthPx, resolver)` converts it to a reka-ui SplitterPanel min-size **%** (only under a horizontal parent; falls back to authored `minSize` when unmeasured; capped at 90%) — why a pane "refuses" to be dragged smaller.
- `deriveSizing(node, registry)` (#986) — bottom-up composite fold → `{ hardMinWidth, softMinWidth, minHeight, width, height }`. `hardMinWidth` = widest single leaf (the reflow-to-a-column floor); `softMinWidth` **== `subtreeMinWidth`** (deliberately reused so they can't drift); `minHeight` mirrors width with axes swapped; a composite always `fill`s.
- `sizingResolver`, `blockVariants`, `resolveVariant` — see the contract table above.

## 4. The placer — `composeDefaultLayout` (#709)

File: `packages/crouton-layout/app/utils/layout-compose.ts`. Pure and **deliberately deterministic — no LLM** (the LLM `/layout` pass is #711, gated, not built; an LLM layout "must beat the deterministic default *and* stay viable"). The same function runs in two hosts:
1. **CLI**, post-generation: `packages/crouton-cli/lib/compose-layout.ts` `writeDefaultLayout()` → writes `crouton.layout.json` at the app root.
2. **In-app**: `useCroutonLayoutBlocks().composeDefault(collections)` against the live registry.

Input: `{ collections: [{ key, label?, calendar? }], registry, targetWidths? = DEFAULT_TARGET_WIDTHS, blockIds? }` where `key` is the collection's registry key (`layerCamel(layer) + PascalCasePlural`, e.g. `bookingsBookings` — mirrored by `registryKeyFor()` in the CLI). Default block ids: `collection-list` / `entity-form` / `bookings-calendar`.

**Selection rules** (verified against source, in order):
1. A collection with `calendar: true` + calendar & list blocks registered → **`calendar-primary`**: horizontal `[list 30, calendar 70]`; if not viable, vertical with **calendar on top**.
2. Else list + form both registered → **`master-detail`** on the FIRST collection: `pairOrStack(list 40, form 60)` — horizontal if viable, else vertical stack (vertical keeps full width, so it's viable whenever each block alone fits the narrowest target).
3. Else only form → **`form-centric`** (single leaf); only list → **`stacked`** (single leaf).
4. Every remaining collection → one `collection-list` leaf each, **stacked vertically under** the primary node.
5. No collections → `empty` pattern (bare list leaf, viable); no usable blocks → `empty` with `viable: false`.

Return: `{ tree, pattern, viable, violations }` — the final tree is always re-run through the gate, so a caller can surface a layout that can't satisfy every `minWidth` even after the vertical fallback.

**CLI specifics** (`compose-layout.ts` in crouton-cli): bookings blocks are included when `features.bookings` is truthy OR any collection landed in the `bookings` layer; a collection is `calendar: true` when it's in the `bookings` layer AND its name matches `/booking/i`. The written `crouton.layout.json` payload is `{ id: 'default', renderer, pattern, viable, tree }` — `pattern`/`viable` are advisory; the seed runner reads `{ id, tree }`.

## 5. Persistence: how layouts save, load, and seed

**Table** — `packages/crouton-layout/server/database/schema/layoutConfigs.ts` (verified): `layout_configs (id text PK nanoid-default, teamId notNull + index, name, renderer default 'panes', tree json, createdAt, updatedAt)`. Deliberately separate from crouton-flow's `flow_configs`.

**API** — `server/api/teams/[id]/crouton-layouts/[layoutId].{get,put}.ts`. Both resolve team membership and query by `(id AND teamId)`. PUT runs the body's tree through **`sanitizeLayoutTree`** (`app/utils/layout-tree.ts` — pure shape gate: copies only known fields, clamps sizes to 0–100, `MAX_DEPTH = 12` recursion cap, returns `null` for implausible input) and upserts the **cleaned** tree. Defence in depth: sanitize on write, allowlist blockIds + `sanitizeConfig` at render.

**Client store** — `useCroutonLayoutStore()`: `load(layoutId)` re-sanitizes on the way OUT of storage too (a DB-tampered row can't feed the renderer); `save(layoutId, tree)` is debounced (600ms). The team layout surface `app/pages/admin/[team]/layout.vue` loads/saves the hardcoded row **`LAYOUT_ID = 'default'`**.

**Seeding** — `crouton-seed` (crouton-cli `lib/seed-app.ts`, `collectDefaultLayoutSql`): if `crouton.layout.json` exists at the app root, upsert its tree into `layout_configs` with row id `default` (idempotent `INSERT … ON CONFLICT(id) DO UPDATE`, `createdAt` immutable) for the single seeded team. That's the full generate → booted-laid-out-POC chain: generate → placer → `crouton.layout.json` → seed → `layout_configs[default]` → `/admin/[team]/layout`.

**Known weak point (verified in source comments):** `layout_configs.id` is a **global** primary key — the API reads by `(id, teamId)`, but only ONE team can own the row literally named `default`. Seeding multi-team default layouts is explicitly out of scope (`seed-app.ts` NB comment).

**Serialization out** — `layout-serialize.ts` (#987) gives the canonical diffable string form (stable key order, defaults omitted, sizes rounded); `layout-ticket.ts` (#974) is the GitHub-comment codec for the agent⇄human loop. Both re-validate through `sanitizeLayoutTree` on parse.

## 6. Drift hazards

| Hazard | State |
|---|---|
| **CLI sizing mirror.** `crouton-cli/lib/compose-layout.ts` hardcodes `CORE_BLOCKS` + `BOOKINGS_BLOCKS` (mirrors of the registry's minWidth/defaultSize values) because the CLI has no live app.config at generate time. A package changing `minWidth`/`defaultSize` silently desyncs the generate-time placer from the runtime registry. **The keep-in-sync comment itself has drifted**: it points at `crouton-core/app/app.config.ts`, but the live default registry moved to `crouton-layout/app/app.config.ts` in the #751 extraction. Values matched at the snapshot date — re-check with the sizing-mirror grep before trusting. | live hazard |
| **`crouton-layout/CLAUDE.md` self-contradicts**: marks the #756 server-side extraction pending and has a second empty "Key Files" heading, while the `layout_configs` schema + API exist on disk. Trust the code and the FIRST table. | stale doc |
| **`block-authoring` skill's reference pointer is stale**: it cites `LayoutSpikeList/Form/Stats.vue` in `packages/crouton-core/app/components/` — only `LayoutSpikeStats.vue` survives, and it lives in `packages/crouton-layout/app/components/`. The skill's *rules* are still correct. | stale pointer |
| **Pre-#709 apps have no `crouton.layout.json`**: apps generated before the layout pass never got it and boot without a seeded default layout until regenerated (list who has one: the `find` in the re-verify block). | expected gap |

Trust order when these bite: code first, then `packages/crouton-layout/CLAUDE.md` (first Key Files table); for doc-vs-doc conflicts see `crouton-docs-trust-map` §1.

## 7. Open fronts — the layout epic sprawl

Several **open** epics overlap on `pkg:crouton-layout` scope. **Snapshot 2026-07-02 — issue states are live data; re-check with the `gh issue view` loop in the re-verify block before relying on them.** Read before minting anything new here — the idea probably already has an epic:

| Epic | Scope | Status at snapshot |
|---|---|---|
| [#703](https://github.com/FriendlyInternet/nuxt-crouton/issues/703) | The lean layout engine itself (registry → contract → panes → placer; sprint ladder #713→#704→#710→#706→#709→gated #711) | open — the shipped code documented above IS its output |
| [#855](https://github.com/FriendlyInternet/nuxt-crouton/issues/855) | One block, three renderers (`panes`/`canvas`/`spatial`), magnetic snap, VR | open, unstarted checklist |
| [#868](https://github.com/FriendlyInternet/nuxt-crouton/issues/868) | "Maquette" semantic-zoom builder umbrella (zoom shell, nested layouts, breakpoints, collapse styles — several WS have landed as the #870–#875/#899 code above) | open |
| [#895](https://github.com/FriendlyInternet/nuxt-crouton/issues/895) | Extract the pure engine as a standalone OSS package | open, ecosystem-check first |
| [#905](https://github.com/FriendlyInternet/nuxt-crouton/issues/905) | App-canvas on Vue Flow — drop blocks, snap or ✨magic-arrange (deterministic v1 = `composeDefaultLayout`; AI v2 with viability as guardrail) | open |

Discovery flags this as dedup debt (recent real work reportedly happened under #983 — unverified, from the discovery briefing). The LLM layout pass (#711) remains **gated and unbuilt**; do not present it as existing.

## 8. Utility map (where the theory lives)

The full per-file map is `packages/crouton-layout/CLAUDE.md` — index only, don't re-read it all:

| Concern | File (`packages/crouton-layout/app/`) |
|---|---|
| Placer | `utils/layout-compose.ts` |
| Viability + sizing derivation | `utils/layout-viability.ts` |
| Pure edit transforms (drop/split/remove/nested/pane-drop) | `utils/layout-edit.ts` |
| Sanitizer (shape gate) | `utils/layout-tree.ts` |
| Breakpoint precedence | `utils/layout-responsive.ts` |
| Canonical serialization / ticket codec | `utils/layout-serialize.ts` / `utils/layout-ticket.ts` |
| Snap geometry / FLIP math / pieces↔tree bridge | `utils/layout-snap.ts` / `layout-flip.ts` / `layout-compose-bridge.ts` |
| Registry reader + live compose/viability | `composables/useCroutonLayoutBlocks.ts` |
| Persistence client | `composables/useCroutonLayoutStore.ts` |
| Read-only / editable / responsive renderers | `components/LayoutRenderer.vue` / `LayoutEditableRenderer.vue` / `LayoutResponsiveRenderer.vue` |
| Shared types (in **core**) | `crouton-core/app/types/layout.ts`, `layout-block.ts` |

## Provenance and maintenance

verified: 2026-07-02

```bash
grep -n "minWidth\|defaultSize" packages/crouton-cli/lib/compose-layout.ts packages/crouton-layout/app/app.config.ts packages/crouton-bookings/app/app.config.ts  # sizing-mirror drift + current registry numbers
sed -n '1,80p' packages/crouton-layout/app/utils/layout-compose.ts     # placer rules — composeDefaultLayout is the whole rule set; read the file when in doubt
cat packages/crouton-layout/server/database/schema/layoutConfigs.ts    # table shape
find apps pocs fixtures -maxdepth 2 -name crouton.layout.json -not -path "*/node_modules/*"  # who has a default-layout file
for n in 703 855 868 895 905; do gh issue view $n --json number,state,title -q '"\(.number) \(.state) \(.title)"'; done  # epic states (or mcp__github__issue_read)
pnpm --filter @fyit/crouton-layout test                                # unit truth (vitest suites next to every util)
```
