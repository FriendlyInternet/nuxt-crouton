// Pure rules for the red-CI note and the epic rollup's red state (#3006).
// Used by .github/workflows/status.yml; keep it free of GitHub calls so it is testable.

const ROLLUPS = new Set(['CI Gate', 'E2E Gate']) // aggregate gates (#2710)

/** 'leaf' = pipeline work-* PR, 'epic' = epic/N-* → main PR, null = a human branch (never touched). */
export function statusScope({ head, base }) {
  const h = String(head || '')
  if (h.startsWith('work-')) return 'leaf'
  if (/^epic\/\d+-/.test(h) && base === 'main') return 'epic'
  return null
}

/** Real causes: drop the aggregate gates when something else is red; keep them when alone. */
export function causesOf(failing = []) {
  return failing.length > 1 ? failing.filter(f => !ROLLUPS.has(f.name)) : failing
}

/** 'skip' | 'create' | 'update' for the red note. Epic PRs only get one when a gate is red. */
export function redNoteAction({ scope, failing = [], existingForSha = false }) {
  if (!scope || !failing.length) return 'skip'
  if (scope === 'epic' && !failing.some(f => ROLLUPS.has(f.name))) return 'skip'
  return existingForSha ? 'update' : 'create'
}

/** The rollup line for a child's PR. null = no PR (caller keeps "queued"). */
export function rollupChildNote({ pr, failing = [] }) {
  if (!pr) return null
  if (pr.merged_at) return { icon: '✅', note: `PR #${pr.number} merged` }
  if (pr.state !== 'open') return null
  const causes = causesOf(failing)
  if (!causes.length) return { icon: '🔨', note: `PR #${pr.number}` }
  const names = causes.slice(0, 3).map(f => `\`${f.name}\``).join(', ')
  const more = causes.length - 3
  return { icon: '🔴', note: `PR #${pr.number} — failing: ${names}${more > 0 ? ` +${more} more` : ''}` }
}
