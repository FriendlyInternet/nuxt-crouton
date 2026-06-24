# CLAUDE.md - @fyit/crouton-layout

## Package Purpose

The **deterministic layout engine** for Nuxt Crouton, extracted from `crouton-core`
(epic #751, follow-up to #736/#709). It owns everything that arranges a team's
collections into a laid-out admin surface — the editor, the renderer, the
deterministic default-layout pass, the placeable blocks, and the `layout_configs`
storage.

It is **default-on**: `@fyit/crouton` (the meta-layer) extends this layer, exactly
the way `crouton-core` auto-includes `crouton-i18n` / `crouton-auth` / `crouton-admin`.
A fresh `crouton init` app gets the layout engine with zero extra wiring; an app can
opt out by disabling the module from a layer.

## Dependency direction (HARD RULE)

**One-way: `crouton-layout → crouton-core`.** This layer extends core and may import
from it; core must never depend on `crouton-layout`. Feature packages
(`crouton-bookings`, …) contribute their own blocks through the
`croutonLayoutBlocks` **app.config registry** (e.g. bookings registers
`bookings-calendar`). So:

- `crouton-layout` needs **no** knowledge of bookings/sales/etc.
- bookings/sales/etc. need **no** dependency on `crouton-layout`.

Never make a feature package depend on this one — wire blocks via the registry.

## Status (extraction in progress — #751)

This package is being populated workstream-by-workstream. The scaffold (#753) is the
empty layer; subsequent PRs move the code in:

| Workstream | Moves in |
|------------|----------|
| #753 scaffold ✅ | package.json · nuxt.config.ts · this CLAUDE.md · `pkg:crouton-layout` label · package-catalog entry |
| #757 default-on ✅ (pulled early) | `crouton.manifest.ts` (`bundled: true`) · `layout` feature flag in `CroutonOptions` · `@fyit/crouton-layout` added to every app/fixture/poc `extends` + deps. **Empty layer wired into the graph first** so the code-moves below stay clean one-way + green. |
| #754 + #755 utils + components + composables ✅ | `app/utils/layout-{compose,viability,edit}.ts` + `app/composables/useCroutonLayout{Blocks,Edit,Store}.ts` + the `Layout*` components + the `croutonLayoutBlocks` defaults (`app/app.config.ts`) (+ tests). CLI repointed to `@fyit/crouton-layout/app/utils/layout-compose`. **Combined** (the relative `../utils/layout-*` imports make them inseparable without a backward shim). |
| #756 server side | `layout_configs` schema + `crouton-layouts/[layoutId].{get,put}` API + `/admin/[team]/layout` page + `app/utils/layout-tree.ts` (migration continuity) |
| #758 prove it | full boot + e2e proof; doc sweep (core CLAUDE.md row surgery, skills); port the mobile slideover (#749) + loading-state UX fixes into the core page |

**Types stay in `crouton-core`.** `app/types/layout.ts` (`LayoutTree`/`LayoutNode`) and `app/types/layout-block.ts` (`CroutonLayoutBlock*`) — plus `app/utils/layout-tree.ts` (`sanitizeLayoutTree`, the sanitizer paired with the type, used by core's server until #756) — **remain in core** as the shared contract, so `crouton-bookings` / `crouton-pages` keep importing them from core and need **no** dep on this package. This layer's files import those types from `@fyit/crouton-core/app/types/...`.

**Why #757 is first:** apps `extends: ['@fyit/crouton-core', …]` directly and core can't extend this layer (circular). So this layer only becomes active once it's in each app's `extends`. Wiring it (empty) up front means the code-moves land in an already-active layer — clean cross-layer auto-imports, no backward `core → layout` shims, one-way deps preserved at every PR.

## Key Files

| File | Purpose |
|------|---------|
| `app/utils/layout-compose.ts` | **Deterministic default-layout pass** (#709) — `composeDefaultLayout({ collections, registry, … })` arranges generated collections into a viable default (calendar-primary / master-detail / form-centric). Pure; the SAME rules run in the CLI generate→POC pipeline (`@fyit/crouton-layout/app/utils/layout-compose`) and in-app via `useCroutonLayoutBlocks().composeDefault(...)`. |
| `app/utils/layout-viability.ts` | **Viability metric** (#710) — `checkLayoutViability` / `checkTreeViability` → every placed block gets ≥ its `minWidth` in its pane. `minWidthResolver` / `panelMinSizePct` (runtime min-size enforcement). |
| `app/utils/layout-edit.ts` | Pure layout-tree edit transforms (#706) — `dropBlock` / `splitLeaf` / `removeNode` / `applySizes` / `setConfig`, addressed by a `NodePath`. Immutable. |
| `app/composables/useCroutonLayoutBlocks.ts` | **Layout block registry** reader — `app.config.croutonLayoutBlocks`; `getBlock`/`resolveComponentName`/`sanitizeConfig` + `checkViability` + `composeDefault` (bound to the live registry). |
| `app/composables/useCroutonLayoutEdit.ts` | `LayoutEditApi` + `LAYOUT_EDIT_KEY` — the provide/inject edit contract for editor panes. |
| `app/composables/useCroutonLayoutStore.ts` | Load/save a `LayoutTree` to the team-scoped `layout_configs` table (re-sanitizes via core's `sanitizeLayoutTree`; debounced save). |
| `app/components/Layout.vue` | `CroutonLayout` — the **editable** panes surface (palette + canvas + per-block config + viability badge). `v-model` = `LayoutTree`. |
| `app/components/LayoutRenderer.vue` | `CroutonLayoutRenderer` — recursive **read-only** renderer into reka-ui Splitter panes; resolves each leaf `blockId` via the registry. |
| `app/components/LayoutEditorPane.vue` | `CroutonLayoutEditorPane` — recursive **editable** pane (drop zones, per-pane toolbar, selection). |
| `app/components/LayoutCollection.vue` + `LayoutCollectionData.vue` | `CroutonLayoutCollection` — real data-bound **list** block (renders a generated collection by name). |
| `app/components/LayoutForm.vue` | `CroutonLayoutForm` — real data-bound **form** block (inline create form for a collection). |
| `app/components/LayoutSpikeStats.vue` | `CroutonLayoutSpikeStats` — generic KPI demo block, registered as `stats`. |
| `app/app.config.ts` | The default `croutonLayoutBlocks` registry (collection-list / entity-form / stats), defu-merged across layers (packages add their own, e.g. bookings' `bookings-calendar`). |
| `crouton.manifest.ts` | `bundled: true` → default-on via `getCroutonLayers()`. |

## Key Files

_Populated as the extraction lands (#754+)._ Until then this layer is an empty
shell that extends `crouton-core`.

## Conventions

Defers to the **root `CLAUDE.md`** for all workflow/commit/issue conventions
(GitHub-issue tracking, `/commit`, no-squash merges, the `packages/` edit gate).
This file covers only what is specific to `crouton-layout`.
