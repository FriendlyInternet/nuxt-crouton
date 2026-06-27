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
import type { LayoutBreakpoint, LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { isLayoutCollapseStyle, isLayoutCollapseEdge, isLayoutCollapseAffordance } from '@fyit/crouton-core/app/types/layout'

/** Hard recursion cap — a hostile/looping tree can't blow the stack. */
const MAX_DEPTH = 12

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clampSize(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : undefined
}

function sanitizeNode(input: unknown, depth: number): LayoutNode | null {
  if (depth > MAX_DEPTH || !isRecord(input)) return null

  const defaultSize = clampSize(input.defaultSize)
  const minSize = clampSize(input.minSize)
  const base = {
    ...(defaultSize !== undefined ? { defaultSize } : {}),
    ...(minSize !== undefined ? { minSize } : {}),
  }

  if (input.type === 'leaf') {
    if (typeof input.blockId !== 'string' || !input.blockId) return null
    const config = isRecord(input.config) ? input.config : undefined
    // Preserve a valid per-pane collapse recipe (#852); keep it only when BOTH fields
    // are known values, so a stray/partial object is dropped rather than half-trusted.
    const c = isRecord(input.collapse) ? input.collapse : undefined
    const collapse = c && isLayoutCollapseEdge(c.edge) && isLayoutCollapseAffordance(c.affordance)
      ? { edge: c.edge, affordance: c.affordance }
      : undefined
    return { type: 'leaf', blockId: input.blockId, ...(config ? { config } : {}), ...(collapse ? { collapse } : {}), ...base }
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

  if (input.type === 'nested') {
    // A nested node embeds a whole sub-layout (WS2 #871). Its depth ADDS to the
    // parent's so MAX_DEPTH bounds total nesting (split depth + nested depth) —
    // a malformed/looping sub-layout invalidates the node (no silent hole).
    const layout = sanitizeTreeAtDepth(input.layout, depth + 1)
    if (!layout) return null
    const label = typeof input.label === 'string' && input.label ? input.label : undefined
    return { type: 'nested', layout, ...(label ? { label } : {}), ...base }
  }

  return null
}

/** Keep only non-empty string entries from an untrusted array (drops the rest). */
function stringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  return input.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/** Keep only `string → string` entries from an untrusted record. */
function stringRecord(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/**
 * Sanitize the authored responsive breakpoints (WS5, #874) — drops any
 * breakpoint without a finite non-negative `minWidth`, copies only known fields
 * (so stray keys / prototype pollution are dropped), and validates an override
 * `root` through the same node sanitizer. Returns undefined when there are no
 * usable breakpoints, so the clean tree simply omits the field.
 */
function sanitizeBreakpoints(input: unknown, depth: number): LayoutBreakpoint[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out: LayoutBreakpoint[] = []
  for (const raw of input) {
    if (!isRecord(raw)) continue
    const minWidth = raw.minWidth
    if (typeof minWidth !== 'number' || !Number.isFinite(minWidth) || minWidth < 0) continue

    const bp: LayoutBreakpoint = { minWidth }
    if (typeof raw.label === 'string' && raw.label) bp.label = raw.label
    if (raw.root !== undefined) {
      const root = sanitizeNode(raw.root, depth)
      if (root) bp.root = root // an unusable override root is dropped, not fatal
    }
    const collapsed = stringArray(raw.collapsed)
    if (collapsed) bp.collapsed = collapsed
    const variants = stringRecord(raw.variants)
    if (variants) bp.variants = variants
    // WS6 #875: only a known LayoutCollapseStyle survives; an unknown value is
    // dropped so the breakpoint falls back to DEFAULT_COLLAPSE_STYLE.
    if (isLayoutCollapseStyle(raw.collapseStyle)) bp.collapseStyle = raw.collapseStyle
    out.push(bp)
  }
  return out.length ? out : undefined
}

/**
 * Validate + normalize an untrusted value into a `LayoutTree` at a given depth,
 * threading depth through nesting so the recursion cap holds across sub-layouts.
 * Accepts either a full `{ renderer: 'panes', root }` tree or a bare root node.
 */
function sanitizeTreeAtDepth(input: unknown, depth: number): LayoutTree | null {
  if (!isRecord(input)) return null

  // Full tree form.
  if ('root' in input) {
    if (input.renderer !== undefined && input.renderer !== 'panes') return null
    const root = sanitizeNode(input.root, depth)
    if (!root) return null
    const breakpoints = sanitizeBreakpoints(input.breakpoints, depth + 1)
    return { renderer: 'panes', root, ...(breakpoints ? { breakpoints } : {}) }
  }

  // Bare root-node form.
  const root = sanitizeNode(input, depth)
  return root ? { renderer: 'panes', root } : null
}

/**
 * Validate + normalize an untrusted value into a `LayoutTree`, or `null`.
 * Accepts either a full `{ renderer: 'panes', root }` tree or a bare root node
 * (defaulting `renderer` to `'panes'`), so callers can persist either form.
 */
export function sanitizeLayoutTree(input: unknown): LayoutTree | null {
  return sanitizeTreeAtDepth(input, 0)
}
