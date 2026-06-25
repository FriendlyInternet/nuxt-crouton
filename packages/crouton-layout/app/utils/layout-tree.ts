/**
 * Layout-tree validation (#716) — guard an UNTRUSTED layout tree before it
 * reaches `CroutonLayoutRenderer`.
 *
 * A `paneBlock` embeds a `LayoutTree` in page content (TipTap doc JSON), which
 * is user-writable data. The renderer already allowlists each leaf's `blockId`
 * against the registry (so an unknown id never resolves to an arbitrary
 * component), but it assumes a *structurally valid* tree. This pure validator is
 * the shape gate in front of it: it returns a clean `LayoutTree` (copying only
 * known fields, so prototype pollution / stray keys are dropped) or `null` when
 * the input isn't a plausible tree — the caller then renders a safe fallback.
 *
 * It does NOT resolve components or sanitize per-block config — that stays with
 * the renderer + `useCroutonLayoutBlocks().sanitizeConfig` so there's one
 * allowlist. Pure (no Nuxt runtime) so it's unit-testable.
 */
import type { LayoutCollapseStyle, LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'

/** Hard recursion cap — a hostile/looping tree can't blow the stack. */
const MAX_DEPTH = 12

/** The fixed collapse-style enum (#852) — anything else is dropped on the way in. */
const COLLAPSE_STYLES: readonly LayoutCollapseStyle[] = ['gutter-tabs', 'header-toggle', 'icon-rail']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clampSize(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : undefined
}

function collapseStyle(v: unknown): LayoutCollapseStyle | undefined {
  return COLLAPSE_STYLES.includes(v as LayoutCollapseStyle) ? (v as LayoutCollapseStyle) : undefined
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function sanitizeNode(input: unknown, depth: number): LayoutNode | null {
  if (depth > MAX_DEPTH || !isRecord(input)) return null

  const defaultSize = clampSize(input.defaultSize)
  const minSize = clampSize(input.minSize)
  // Collapse contract (#852) — copied through so a pane's open-state and chosen
  // affordance survive the storage round-trip (the persisted tree is untrusted,
  // so only known fields / enum values pass).
  const collapsible = bool(input.collapsible)
  const collapse = collapseStyle(input.collapse)
  const open = bool(input.open)
  const base = {
    ...(defaultSize !== undefined ? { defaultSize } : {}),
    ...(minSize !== undefined ? { minSize } : {}),
    ...(collapsible !== undefined ? { collapsible } : {}),
    ...(collapse !== undefined ? { collapse } : {}),
    ...(open !== undefined ? { open } : {}),
  }

  if (input.type === 'leaf') {
    if (typeof input.blockId !== 'string' || !input.blockId) return null
    const config = isRecord(input.config) ? input.config : undefined
    return { type: 'leaf', blockId: input.blockId, ...(config ? { config } : {}), ...base }
  }

  if (input.type === 'split') {
    if (input.direction !== 'horizontal' && input.direction !== 'vertical') return null
    if (!Array.isArray(input.children) || input.children.length === 0) return null
    const children: LayoutNode[] = []
    for (const child of input.children) {
      const node = sanitizeNode(child, depth + 1)
      if (!node) return null // one bad child invalidates the split (no silent holes)
      children.push(node)
    }
    return { type: 'split', direction: input.direction, children, ...base }
  }

  return null
}

/**
 * Validate + normalize an untrusted value into a `LayoutTree`, or `null`.
 * Accepts either a full `{ renderer: 'panes', root }` tree or a bare root node
 * (defaulting `renderer` to `'panes'`), so callers can persist either form.
 */
export function sanitizeLayoutTree(input: unknown): LayoutTree | null {
  if (!isRecord(input)) return null

  // Full tree form.
  if ('root' in input) {
    if (input.renderer !== undefined && input.renderer !== 'panes') return null
    const root = sanitizeNode(input.root, 0)
    return root ? { renderer: 'panes', root } : null
  }

  // Bare root-node form.
  const root = sanitizeNode(input, 0)
  return root ? { renderer: 'panes', root } : null
}
