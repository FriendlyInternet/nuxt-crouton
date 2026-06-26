/**
 * Spike Magic v1 (#908, epic #905) — the ✨ "arrange it for me" tier, the cheap,
 * instant, no-API one. Given the blocks dropped on the app-canvas, it produces a
 * handful of **archetype proposals** (master-detail / form-centric / calendar-primary
 * / dashboard / stacked) you can flip between — every one **viability-guaranteed**.
 *
 * Reuses the deterministic engine we already have (`@fyit/crouton-layout`):
 *   - `composeDefault` (#709) is run over the dropped blocks to pick the *strong*
 *     default pattern (and to prove the engine drives the choice);
 *   - `checkViability` (#710) gates every archetype — a horizontal split that would
 *     squish a block below its `minWidth` falls back to a vertical stack (which keeps
 *     each child's full width, so it's always viable).
 *
 * POC-local glue (pocs are test-exempt): the archetype expansion lives here while the
 * shape settles; the genuine logic graduates into `packages/*` test-first later (#774).
 */
import type { LayoutLeaf, LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'

/** A block the user dropped on the canvas (collection-derived: artists-list/form/stats). */
export interface MagicBlockInput {
  blockId: string
  label?: string
}

export type MagicPattern = 'master-detail' | 'form-centric' | 'calendar-primary' | 'dashboard' | 'stacked'

export interface MagicProposal {
  id: MagicPattern
  label: string
  icon: string
  note: string
  tree: LayoutTree
  /** Passes the #710 viability gate at every target width (always true — the builders fall back to a stack). */
  viable: boolean
}

/** The role a dropped block plays in an arrangement, inferred from its registry def. */
type BlockRole = 'list' | 'form' | 'calendar' | 'stats'

// Desktop + tablet, same gate the deterministic composer uses.
const TARGET_WIDTHS = [1280, 768]

const PATTERN_META: Record<MagicPattern, { label: string, icon: string, note: string }> = {
  'calendar-primary': { label: 'Calendar', icon: 'i-lucide-calendar', note: 'Calendar dominant, list as a side rail' },
  'master-detail': { label: 'Master–detail', icon: 'i-lucide-columns-2', note: 'List beside the form, stats below' },
  'form-centric': { label: 'Form-first', icon: 'i-lucide-square-pen', note: 'Form dominant, the rest as a rail' },
  'dashboard': { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', note: 'Stats across the top, list + form below' },
  'stacked': { label: 'Stacked', icon: 'i-lucide-rows-3', note: 'Everything in one column — always fits' },
}

export function useSpikeMagic() {
  const { getBlock, composeDefault, checkViability } = useCroutonLayoutBlocks()

  /** Infer a block's arrangement role from its registry category / id. */
  function roleOf(blockId: string): BlockRole {
    const def = getBlock(blockId)
    const id = blockId.toLowerCase()
    const comp = (def?.component ?? '').toLowerCase()
    if (id.includes('calendar') || comp.includes('calendar')) return 'calendar'
    if (def?.category === 'form' || id.includes('form') || id.includes('new') || id.includes('create')) return 'form'
    if (id.includes('stats') || id.includes('kpi') || id.includes('chart')) return 'stats'
    return 'list'
  }

  function leaf(b: MagicBlockInput, size?: number): LayoutLeaf {
    return {
      type: 'leaf',
      blockId: b.blockId,
      config: { collection: 'artists', ...(b.label ? { heading: b.label } : {}) },
      ...(size != null ? { defaultSize: size } : {}),
    }
  }

  const withSize = (node: LayoutNode, size: number): LayoutNode => ({ ...node, defaultSize: size })

  /** A vertical stack (one child collapses to itself). Width isn't divided → stays viable. */
  function col(children: LayoutNode[]): LayoutNode {
    return children.length === 1 ? children[0]! : { type: 'split', direction: 'vertical', children }
  }

  /** Side by side when that's viable at every target width; otherwise stacked. */
  function rowOrStack(children: LayoutNode[]): LayoutNode {
    if (children.length === 1) return children[0]!
    const horizontal: LayoutNode = { type: 'split', direction: 'horizontal', children }
    if (checkViability({ renderer: 'panes', root: horizontal }, TARGET_WIDTHS).viable) return horizontal
    return { type: 'split', direction: 'vertical', children }
  }

  /** Group dropped blocks by inferred role, preserving drop order within a role. */
  function group(blocks: MagicBlockInput[]): Record<BlockRole, MagicBlockInput[]> {
    const g: Record<BlockRole, MagicBlockInput[]> = { list: [], form: [], calendar: [], stats: [] }
    for (const b of blocks) g[roleOf(b.blockId)].push(b)
    return g
  }

  // --- archetype builders: each returns a root node, or null when not applicable ---

  function buildMasterDetail(g: Record<BlockRole, MagicBlockInput[]>): LayoutNode | null {
    if (!g.list.length || !g.form.length) return null
    const core = rowOrStack([
      withSize(col(g.list.map(b => leaf(b))), 40),
      withSize(col(g.form.map(b => leaf(b))), 60),
    ])
    if (!g.stats.length) return core
    return col([withSize(core, 70), withSize(rowOrStack(g.stats.map(b => leaf(b))), 30)])
  }

  function buildFormCentric(g: Record<BlockRole, MagicBlockInput[]>): LayoutNode | null {
    if (!g.form.length) return null
    const form = withSize(col(g.form.map(b => leaf(b))), 65)
    const rail = [...g.list, ...g.stats]
    if (!rail.length) return col(g.form.map(b => leaf(b)))
    return rowOrStack([form, withSize(col(rail.map(b => leaf(b))), 35)])
  }

  function buildCalendarPrimary(g: Record<BlockRole, MagicBlockInput[]>): LayoutNode | null {
    if (!g.calendar.length) return null
    const cal = withSize(col(g.calendar.map(b => leaf(b))), 70)
    const rail = [...g.list, ...g.stats]
    if (!rail.length) return cal
    // List rail left, calendar right — mirrors the composer's buildCalendarPrimary.
    return rowOrStack([withSize(col(rail.map(b => leaf(b))), 30), cal])
  }

  function buildDashboard(g: Record<BlockRole, MagicBlockInput[]>): LayoutNode | null {
    if (!g.stats.length || (!g.list.length && !g.form.length)) return null
    const top = withSize(rowOrStack(g.stats.map(b => leaf(b))), 30)
    const below = withSize(rowOrStack([...g.list.map(b => leaf(b)), ...g.form.map(b => leaf(b))]), 70)
    return col([top, below])
  }

  function buildStacked(blocks: MagicBlockInput[]): LayoutNode {
    return col(blocks.map(b => leaf(b)))
  }

  /**
   * Arrange the dropped blocks into 1–3 viability-guaranteed archetype proposals.
   * The pattern `composeDefault` (#709) selects is surfaced first (the *strong* default);
   * the others are the "propose another layout" alternatives the owner asked for.
   */
  function magicArrange(blocks: MagicBlockInput[]): { proposals: MagicProposal[], defaultId: MagicPattern | null } {
    if (!blocks.length) return { proposals: [], defaultId: null }

    const g = group(blocks)

    // Run the deterministic composer to learn the strong default pattern (and to gate
    // it). composeDefault is collection-oriented, so feed the dropped blocks as one
    // "artists" collection, remapping its block ids to the ones actually dropped.
    const base = composeDefault(
      [{ key: 'artists', label: 'Artists', calendar: g.calendar.length > 0 }],
      {
        targetWidths: TARGET_WIDTHS,
        blockIds: {
          list: g.list[0]?.blockId,
          form: g.form[0]?.blockId,
          calendar: g.calendar[0]?.blockId,
        },
      },
    )
    // base.pattern is the engine's pick; 'empty' shouldn't happen with ≥1 block, but guard.
    const KNOWN: readonly string[] = ['calendar-primary', 'master-detail', 'form-centric', 'stacked']
    const defaultPattern: MagicPattern = KNOWN.includes(base.pattern)
      ? base.pattern as MagicPattern
      : 'stacked'

    // Candidate archetypes in a stable priority; null ones (not applicable) drop out.
    const candidates: Array<{ id: MagicPattern, root: LayoutNode | null }> = [
      { id: 'calendar-primary', root: buildCalendarPrimary(g) },
      { id: 'master-detail', root: buildMasterDetail(g) },
      { id: 'form-centric', root: buildFormCentric(g) },
      { id: 'dashboard', root: buildDashboard(g) },
      { id: 'stacked', root: buildStacked(blocks) },
    ]

    const seen = new Set<string>()
    const built = candidates
      .filter((c): c is { id: MagicPattern, root: LayoutNode } => c.root !== null)
      .map((c) => {
        const tree: LayoutTree = { renderer: 'panes', root: c.root }
        return { id: c.id, tree, viable: checkViability(tree, TARGET_WIDTHS).viable }
      })
      // Drop structurally-identical archetypes (e.g. one block → every builder yields the same).
      .filter((p) => {
        const sig = JSON.stringify(p.tree.root)
        if (seen.has(sig)) return false
        seen.add(sig)
        return true
      })

    // Default pattern first, then the rest; cap at 3 (one strong + up to two alternatives).
    built.sort((a, b) => Number(b.id === defaultPattern) - Number(a.id === defaultPattern))
    const proposals: MagicProposal[] = built.slice(0, 3).map(p => ({
      id: p.id,
      ...PATTERN_META[p.id],
      tree: p.tree,
      viable: p.viable,
    }))

    return { proposals, defaultId: proposals[0]?.id ?? null }
  }

  return { magicArrange }
}
