// diagram-edit-link.mjs — the one place that knows where the diagram editor lives and which branch
// a design-hold diagram is saved to (#3690). The decomposer's sign-off hold posts an ✏️ Edit link
// built here; `null` means "post no link" — this never produces a link that would save to `main`.

// Editor origin — the ticket-editor worker's custom domain (workers/ticket-editor/wrangler.jsonc:17).
export const DIAGRAM_EDITOR_ORIGIN = 'https://diagram.pmcp.dev'

// Fixed, unprotected save branch (owner decision 2026-11-10, #3690); nothing is merged from it.
// Must stay outside every ruleset pattern (`epic/*--v1-*`, `trial/*`) or the editor refuses saves.
export const DIAGRAM_BRANCH = 'diagrams'

// Same check the editor applies to `slug` (workers/ticket-editor/src/index.ts, save handler).
export const DIAGRAM_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i

const DEFAULT_BRANCHES = new Set(['main', 'master'])

/** True when `branch` is empty or a default branch — never a save target. */
export function isRefusedBranch(branch) {
  const b = String(branch ?? '').trim()
  return !b || DEFAULT_BRANCHES.has(b)
}

/**
 * Build the editor URL for one diagram, or `null` when no link should be posted (no/`main` branch,
 * a slug the editor would reject, or a missing issue number).
 */
export function diagramEditUrl({ slug, branch, issue } = {}) {
  if (isRefusedBranch(branch)) return null
  if (typeof slug !== 'string' || !DIAGRAM_SLUG_RE.test(slug)) return null
  const n = typeof issue === 'number' ? issue : (/^\d+$/.test(String(issue ?? '')) ? Number(issue) : NaN)
  if (!Number.isInteger(n) || n <= 0) return null
  const q = `slug=${encodeURIComponent(slug)}&branch=${encodeURIComponent(String(branch).trim())}&issue=${n}`
  return `${DIAGRAM_EDITOR_ORIGIN}/?${q}`
}
