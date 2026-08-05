/**
 * Layout serialisation (#987, graduation WS4) — the **canonical, diffable
 * interchange format** for the agent⇄human layout loop.
 *
 * A `LayoutTree` is the in-memory model; `sanitizeLayoutTree` (in crouton-core)
 * is the trusted-on-the-way-IN gate. This module adds the trusted-on-the-way-OUT
 * half: a **stable string form** that an agent and a human can both read, write,
 * and *diff* — on a GitHub ticket (#974), in a store, or in a review.
 *
 * Two layers:
 *  - `serializeLayoutTree` / `parseLayoutTree` — one composed page's layout.
 *  - `serializeLayoutDocument` / `parseLayoutDocument` — the **page-flow document**:
 *    the Site level (pages wired by `parentId`, one `★home`, each carrying its tree
 *    + assembled pinned regions). This is what #988 routes over and #974 round-trips.
 *
 * Canonical means: deterministic key order, sorted map/array keys, defaults and
 * empties omitted, and arrangement sizes rounded to 1 dp — so the *same logical
 * layout always serialises to the same bytes*, and a one-block edit is a one-line
 * diff. `parse*` re-validates through `sanitizeLayoutTree`, so untrusted input
 * (an agent-authored or hand-edited tree) is always cleaned, never half-trusted.
 *
 * Pure (no Nuxt runtime) so it's unit-testable.
 */
import type { LayoutBreakpoint, LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { sanitizeLayoutTree } from '@fyit/crouton-core/app/utils/layout-tree'

// ─── Tree: canonical form ────────────────────────────────────────────────────

/** Round an arrangement size to 1 dp so splitter drags don't churn the diff. */
function roundSize(n: number | undefined): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : undefined
}

/** Drop `undefined`/empty entries and emit object keys in a fixed order, recursively,
 *  so the JSON is deterministic. Only assigns a key when its value is meaningful. */
function put<T extends Record<string, unknown>>(target: T, key: string, value: unknown): void {
  if (value === undefined) return
  if (Array.isArray(value) && value.length === 0) return
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return
  ;(target as Record<string, unknown>)[key] = value
}

/** A plain record with keys emitted in sorted order (stable map serialisation). */
function sortedRecord(rec: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!rec) return undefined
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(rec).sort()) out[k] = rec[k]
  return out
}

/** Canonicalise one node into a key-ordered plain object (type → payload → size). */
function canonicalNode(node: LayoutNode): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (node.type === 'leaf') {
    out.type = 'leaf'
    out.blockId = node.blockId
    put(out, 'config', sortedRecord(node.config))
    if (node.collapse) put(out, 'collapse', { edge: node.collapse.edge, affordance: node.collapse.affordance })
  } else if (node.type === 'split') {
    out.type = 'split'
    out.direction = node.direction
    out.children = node.children.map(canonicalNode)
  } else {
    out.type = 'nested'
    put(out, 'label', node.label)
    out.layout = canonicalTree(node.layout)
  }
  put(out, 'defaultSize', roundSize(node.defaultSize))
  put(out, 'minSize', roundSize(node.minSize))
  return out
}

/** Canonicalise one authored breakpoint (min-width → label → root → dials). */
function canonicalBreakpoint(bp: LayoutBreakpoint): Record<string, unknown> {
  const out: Record<string, unknown> = { minWidth: bp.minWidth }
  put(out, 'label', bp.label)
  if (bp.root) out.root = canonicalNode(bp.root)
  put(out, 'collapsed', bp.collapsed ? [...bp.collapsed].sort() : undefined)
  put(out, 'variants', sortedRecord(bp.variants))
  put(out, 'collapseStyle', bp.collapseStyle)
  return out
}

/** Canonicalise a whole tree (renderer → root → breakpoints). */
function canonicalTree(tree: LayoutTree): Record<string, unknown> {
  const out: Record<string, unknown> = { renderer: 'panes', root: canonicalNode(tree.root) }
  put(out, 'breakpoints', tree.breakpoints?.map(canonicalBreakpoint))
  return out
}

/** Serialise a layout tree to its canonical, diffable JSON string. */
export function serializeLayoutTree(tree: LayoutTree): string {
  return JSON.stringify(canonicalTree(tree), null, 2)
}

/**
 * Parse + validate a serialised tree (a JSON string OR an already-parsed object)
 * back into a clean `LayoutTree`, or `null` if it isn't a plausible tree. Untrusted
 * input is sanitised through the shared `sanitizeLayoutTree` gate (stray keys
 * dropped, depth capped, out-of-range sizes cleared) — there is one allowlist.
 */
export function parseLayoutTree(input: string | unknown): LayoutTree | null {
  return sanitizeLayoutTree(toValue(input))
}

/** JSON string → value (null on malformed); pass a non-string value through. */
function toValue(input: string | unknown): unknown {
  if (typeof input !== 'string') return input
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}

// ─── Page-flow document ──────────────────────────────────────────────────────

/** Page meta enums — mirror crouton-pages' page model so the Site flow reads
 *  identically (graduated from the POC's `spike-page-meta`). */
export const LAYOUT_PAGE_STATUSES = ['draft', 'published', 'archived'] as const
export type LayoutPageStatus = (typeof LAYOUT_PAGE_STATUSES)[number]
export const LAYOUT_PAGE_VISIBILITIES = ['public', 'members', 'admin', 'scoped', 'hidden'] as const
export type LayoutPageVisibility = (typeof LAYOUT_PAGE_VISIBILITIES)[number]
export const LAYOUT_PAGE_LAYOUTS = ['default', 'full-height', 'full-screen'] as const
export type LayoutPageLayout = (typeof LAYOUT_PAGE_LAYOUTS)[number]

/** One page in the builder: its identity + site-flow placement + composed layout.
 *  The page's own `tree` is the scrolling "main"; `pinnedTop`/`pinnedBottom` are the
 *  assembled sticky regions (the review-flow shape) — a bounded, agent-pickable model. */
export interface LayoutDocumentPage {
  id: string
  name: string
  /** Route path, e.g. `/dashboard` — the deep-link #988 routes to. */
  path: string
  /** Site-flow edge: the parent page this one hangs off (a wireable sitemap). */
  parentId?: string
  /** Exactly one page is the entry/★home. */
  isHome?: boolean
  status?: LayoutPageStatus
  visibility?: LayoutPageVisibility
  layout?: LayoutPageLayout
  inNav?: boolean
  tree: LayoutTree
  pinnedTop?: LayoutTree[]
  pinnedBottom?: LayoutTree[]
}

/** The whole builder artifact: every page + the flow between them. Versioned so a
 *  format change is detectable across a ticket round-trip. */
export interface LayoutDocument {
  version: 1
  pages: LayoutDocumentPage[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function oneOf<T extends string>(v: unknown, set: readonly T[]): T | undefined {
  return typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : undefined
}
/** Sanitise an array of (untrusted) trees, dropping any that don't validate. */
function trees(input: unknown): LayoutTree[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out = input.map(sanitizeLayoutTree).filter((t): t is LayoutTree => t !== null)
  return out.length ? out : undefined
}

/** Canonicalise one document page (identity → flow → meta → layout). */
function canonicalPage(p: LayoutDocumentPage): Record<string, unknown> {
  const out: Record<string, unknown> = { id: p.id, name: p.name, path: p.path }
  put(out, 'parentId', p.parentId)
  if (p.isHome) out.isHome = true
  put(out, 'status', p.status)
  put(out, 'visibility', p.visibility)
  put(out, 'layout', p.layout)
  if (p.inNav !== undefined) out.inNav = p.inNav
  out.tree = canonicalTree(p.tree)
  put(out, 'pinnedTop', p.pinnedTop?.map(canonicalTree))
  put(out, 'pinnedBottom', p.pinnedBottom?.map(canonicalTree))
  return out
}

/** Serialise a page-flow document to its canonical, diffable JSON string. */
export function serializeLayoutDocument(doc: LayoutDocument): string {
  return JSON.stringify({ version: 1, pages: doc.pages.map(canonicalPage) }, null, 2)
}

/**
 * Parse + validate a serialised document (JSON string or parsed object) into a
 * clean `LayoutDocument`, or `null` if it isn't a plausible document. Each page's
 * tree (and pinned trees) is re-sanitised; a page whose `tree` doesn't validate is
 * dropped (no silent broken page). Page order is preserved.
 */
export function parseLayoutDocument(input: string | unknown): LayoutDocument | null {
  const raw = toValue(input)
  if (!isRecord(raw) || !Array.isArray(raw.pages)) return null

  const pages: LayoutDocumentPage[] = []
  for (const rp of raw.pages) {
    if (!isRecord(rp)) continue
    const id = str(rp.id), name = str(rp.name), path = str(rp.path)
    const tree = sanitizeLayoutTree(rp.tree)
    if (!id || !name || !path || !tree) continue // a page needs identity + a valid layout

    const page: LayoutDocumentPage = { id, name, path, tree }
    const parentId = str(rp.parentId)
    if (parentId) page.parentId = parentId
    if (rp.isHome === true) page.isHome = true
    const status = oneOf(rp.status, LAYOUT_PAGE_STATUSES)
    if (status) page.status = status
    const visibility = oneOf(rp.visibility, LAYOUT_PAGE_VISIBILITIES)
    if (visibility) page.visibility = visibility
    const layout = oneOf(rp.layout, LAYOUT_PAGE_LAYOUTS)
    if (layout) page.layout = layout
    if (typeof rp.inNav === 'boolean') page.inNav = rp.inNav
    const pinnedTop = trees(rp.pinnedTop)
    if (pinnedTop) page.pinnedTop = pinnedTop
    const pinnedBottom = trees(rp.pinnedBottom)
    if (pinnedBottom) page.pinnedBottom = pinnedBottom
    pages.push(page)
  }
  return { version: 1, pages }
}
