/**
 * Placement check for an agent-authored layout (#3982) — the gate the MCP
 * `add_layout` tool runs before a layout block lands in a live page.
 *
 * 1. `parseLayoutTree` must accept it (sanitised, never half-trusted).
 * 2. Every leaf must name a registered block.
 * 3. It must be viable (every block gets its `minWidth`) at the WIDEST target
 *    width — an error. Not fitting the narrower widths is only a warning, so the
 *    agent can add phone behaviour (breakpoints / collapse) per the layout recipe.
 *
 * Widths default to the editor's own viability badge (`CroutonLayout`). Pure.
 */
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { parseLayoutTree } from './layout-serialize'
import { checkTreeViability, minWidthResolver, type ViabilityViolation } from './layout-viability'

export interface LayoutPlacementResult {
  ok: boolean
  /** The sanitised tree, when it parsed. */
  tree?: LayoutTree
  errors: string[]
  warnings: string[]
}

export const DEFAULT_PLACEMENT_WIDTHS = [1280, 768, 375]

function collectBlockIds(node: LayoutNode, out: string[]): void {
  if (node.type === 'leaf') out.push(node.blockId)
  else if (node.type === 'nested') collectBlockIds(node.layout.root, out)
  else for (const child of node.children) collectBlockIds(child, out)
}

function describe(v: ViabilityViolation): string {
  return `${v.blockId} ${v.paneWidth}<${v.minWidth}`
}

export function checkLayoutForPlacement(
  input: unknown,
  registry: CroutonLayoutBlockRegistry,
  targetWidths: number[] = DEFAULT_PLACEMENT_WIDTHS
): LayoutPlacementResult {
  const tree = parseLayoutTree(input)
  if (!tree) return { ok: false, errors: ['not a valid layout'], warnings: [] }

  const errors: string[] = []
  const warnings: string[] = []

  const ids: string[] = []
  collectBlockIds(tree.root, ids)
  for (const bp of tree.breakpoints ?? []) if (bp.root) collectBlockIds(bp.root, ids)
  const unknown = [...new Set(ids)].filter(id => !registry[id])
  for (const id of unknown) errors.push(`unknown block "${id}" (use list_layout_blocks)`)

  const widths = [...targetWidths]
  const [widest, ...narrower] = widths
  if (widest !== undefined) {
    const minWidthFor = minWidthResolver(registry)
    const main = checkTreeViability(tree, minWidthFor, [widest])
    if (!main.viable) {
      errors.push(`not viable at ${widest}px: ${main.violations.map(describe).join(', ')}`)
    }
    for (const w of narrower) {
      const res = checkTreeViability(tree, minWidthFor, [w])
      if (!res.viable) warnings.push(`not viable at ${w}px: ${res.violations.map(describe).join(', ')} — add phone behaviour`)
    }
  }

  return { ok: errors.length === 0, tree, errors, warnings }
}
