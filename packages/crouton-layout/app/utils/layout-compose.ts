/**
 * Deterministic default-layout pass (Sprint 4, #709) — the *placer*.
 *
 * Given the freshly generated collections (each yields a list + a form block)
 * and the active packages' registered blocks (their sizing contract, #710), a
 * small, legible rule set arranges them into a good default layout — the data
 * tree `CroutonLayout` hydrates, NOT bespoke `.vue`. No LLM: the gated model
 * pass is Sprint 5 (#711). This is what turns "I want a booking app" into a
 * laid-out POC instead of a blank canvas (assumption A3).
 *
 * The objective gate is **viability** (`checkLayoutViability`, #710): every
 * placed block must get at least its declared `minWidth` at the target
 * container width(s). A candidate that isn't viable is rejected and the placer
 * falls back to a more vertical arrangement (a vertical split keeps each child's
 * full width, so it's viable whenever each block's `minWidth` fits the narrowest
 * target). One gate, reused — the renderer enforces the same contract at runtime.
 *
 * Pure (no Nuxt runtime), so it's unit-testable and runs identically in the CLI
 * generate → POC pipeline and in the Nuxt app (via `useCroutonLayoutBlocks`).
 */
import type { LayoutLeaf, LayoutNode, LayoutSplit, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { checkLayoutViability, minWidthResolver, type ViabilityViolation } from './layout-viability'

/** One generated collection the placer can lay out. */
export interface ComposeCollectionInput {
  /** Registry key for the collection, e.g. `mainItems` (layer + Collection, camelCase). */
  key: string
  /** Human label (optional) — surfaced as the block heading. */
  label?: string
  /** This collection has a compound calendar surface available (e.g. bookings). */
  calendar?: boolean
}

/** Which registry block ids the placer should use (lets callers remap). */
export interface ComposeBlockIds {
  list?: string
  form?: string
  calendar?: string
}

export interface ComposeDefaultLayoutOptions {
  /** The generated collections, in priority order (first is the primary surface). */
  collections: ComposeCollectionInput[]
  /** Available layout-block registry — read for `minWidth`/`defaultSize` and to know which block ids exist. */
  registry: CroutonLayoutBlockRegistry
  /** Container widths (px) to gate against. Default `[1280, 768]` (desktop + tablet). */
  targetWidths?: number[]
  /** Override the block ids the placer reaches for. */
  blockIds?: ComposeBlockIds
}

/** The arrangement the rule set chose. */
export type LayoutPattern = 'calendar-primary' | 'master-detail' | 'form-centric' | 'stacked' | 'empty'

export interface ComposeResult {
  /** The persisted-format layout tree (`layout_configs` shape). */
  tree: LayoutTree
  /** Which pattern the rule set selected. */
  pattern: LayoutPattern
  /** True iff the final tree passes the viability gate at every target width. */
  viable: boolean
  /** Viability violations on the final tree (empty when viable). */
  violations: ViabilityViolation[]
}

/** Desktop-first gate; narrow panes are handled at runtime by container queries + the renderer's min enforcement. */
const DEFAULT_TARGET_WIDTHS = [1280, 768]
const DEFAULT_BLOCK_IDS: Required<ComposeBlockIds> = {
  list: 'collection-list',
  form: 'entity-form',
  calendar: 'bookings-calendar',
}

/** A placed leaf bound to a collection, seeding `defaultSize` from the block contract unless overridden. */
function leafFor(
  blockId: string,
  collection: ComposeCollectionInput,
  registry: CroutonLayoutBlockRegistry,
  defaultSize?: number,
): LayoutLeaf {
  const size = defaultSize ?? registry[blockId]?.defaultSize
  return {
    type: 'leaf',
    blockId,
    config: { collection: collection.key, ...(collection.label ? { heading: collection.label } : {}) },
    ...(size !== undefined ? { defaultSize: size } : {}),
  }
}

/** Is a node viable on its own at the given widths? */
function viableAt(node: LayoutNode, registry: CroutonLayoutBlockRegistry, widths: number[]): boolean {
  return checkLayoutViability(node, minWidthResolver(registry), widths).viable
}

/**
 * Pair two blocks side by side (horizontal) when that's viable; otherwise stack
 * them (vertical), which keeps each child's full width and so stays viable
 * whenever each block alone fits the narrowest target.
 */
function pairOrStack(
  first: LayoutNode,
  second: LayoutNode,
  registry: CroutonLayoutBlockRegistry,
  widths: number[],
): LayoutSplit {
  const horizontal: LayoutSplit = { type: 'split', direction: 'horizontal', children: [first, second] }
  if (viableAt(horizontal, registry, widths)) return horizontal
  // Fall back to a vertical stack — width is no longer divided, so it's viable.
  return { type: 'split', direction: 'vertical', children: [first, second] }
}

/** List + form as master/detail (side by side → stacked when too narrow). */
function buildMasterDetail(
  collection: ComposeCollectionInput,
  ids: Required<ComposeBlockIds>,
  registry: CroutonLayoutBlockRegistry,
  widths: number[],
): LayoutNode {
  const list = leafFor(ids.list, collection, registry, 40)
  const form = leafFor(ids.form, collection, registry, 60)
  return pairOrStack(list, form, registry, widths)
}

/** Calendar dominant, the collection's list as a side rail (→ calendar on top when too narrow). */
function buildCalendarPrimary(
  collection: ComposeCollectionInput,
  ids: Required<ComposeBlockIds>,
  registry: CroutonLayoutBlockRegistry,
  widths: number[],
): LayoutNode {
  const list = leafFor(ids.list, collection, registry, 30)
  const calendar = leafFor(ids.calendar, collection, registry, 70)
  const horizontal: LayoutSplit = { type: 'split', direction: 'horizontal', children: [list, calendar] }
  if (viableAt(horizontal, registry, widths)) return horizontal
  // Calendar wants a wide pane — when it won't fit beside the list, put it on top.
  return { type: 'split', direction: 'vertical', children: [calendar, list] }
}

/**
 * Arrange generated collections into a good default layout.
 *
 * Selection rules (legible, deterministic):
 * 1. a collection with a compound **calendar** available → **calendar-primary**;
 * 2. else list + form blocks both registered → **master-detail** (the primary collection);
 * 3. else only a form block → **form-centric**; only a list → a single list (**stacked**);
 * 4. additional collections are appended as list panes **stacked vertically**
 *    below the primary surface (vertical keeps full width, so the gate holds).
 *
 * The chosen tree is always run through the viability gate; the result reports
 * `viable` + any `violations` so the caller can surface (or regenerate) a layout
 * that can't satisfy every block's `minWidth` even after the vertical fallback.
 */
export function composeDefaultLayout(opts: ComposeDefaultLayoutOptions): ComposeResult {
  const widths = opts.targetWidths?.length ? opts.targetWidths : DEFAULT_TARGET_WIDTHS
  const ids: Required<ComposeBlockIds> = { ...DEFAULT_BLOCK_IDS, ...opts.blockIds }
  const registry = opts.registry
  const has = (id: string) => !!registry[id]
  const resolver = minWidthResolver(registry)

  // No collections → nothing to bind; hand back an empty list leaf (renders its
  // own empty state) rather than a malformed tree.
  if (!opts.collections.length) {
    const root: LayoutLeaf = { type: 'leaf', blockId: ids.list, config: {} }
    return { tree: { renderer: 'panes', root }, pattern: 'empty', viable: true, violations: [] }
  }

  const calendarCollection = opts.collections.find(c => c.calendar)
  let primaryNode: LayoutNode
  let pattern: LayoutPattern
  let primaryKey: string

  if (calendarCollection && has(ids.calendar) && has(ids.list)) {
    primaryNode = buildCalendarPrimary(calendarCollection, ids, registry, widths)
    pattern = 'calendar-primary'
    primaryKey = calendarCollection.key
  }
  else if (has(ids.list) && has(ids.form)) {
    primaryNode = buildMasterDetail(opts.collections[0]!, ids, registry, widths)
    pattern = 'master-detail'
    primaryKey = opts.collections[0]!.key
  }
  else if (has(ids.form)) {
    primaryNode = leafFor(ids.form, opts.collections[0]!, registry)
    pattern = 'form-centric'
    primaryKey = opts.collections[0]!.key
  }
  else if (has(ids.list)) {
    primaryNode = leafFor(ids.list, opts.collections[0]!, registry)
    pattern = 'stacked'
    primaryKey = opts.collections[0]!.key
  }
  else {
    // No usable blocks registered — degenerate, but return a coherent tree.
    const root: LayoutLeaf = { type: 'leaf', blockId: ids.list, config: { collection: opts.collections[0]!.key } }
    return { tree: { renderer: 'panes', root }, pattern: 'empty', viable: false, violations: [] }
  }

  // Remaining collections → a list pane each, stacked under the primary surface.
  const extras = has(ids.list)
    ? opts.collections.filter(c => c.key !== primaryKey).map(c => leafFor(ids.list, c, registry))
    : []

  const root: LayoutNode = extras.length
    ? { type: 'split', direction: 'vertical', children: [primaryNode, ...extras] }
    : primaryNode

  const { viable, violations } = checkLayoutViability(root, resolver, widths)
  return { tree: { renderer: 'panes', root }, pattern, viable, violations }
}
