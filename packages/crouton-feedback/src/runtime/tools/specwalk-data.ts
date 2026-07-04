/**
 * Pure Spec-walk helpers — no Vue, no Nuxt. Shared by the runtime composable
 * (derives the walk from `runtimeConfig.public.croutonPlan`) and unit-tested in
 * isolation.
 *
 * The **Spec walk** tool is the "does it still work?" facet of the launcher: it
 * reuses the SAME composed plan the Plan tool ships (plan overlay ⋈ spec ledger,
 * `ComposedPlan`), pulls out the behaviour entries that are actually LIVE
 * (`done`/`active` phases + increments — what's shipped to check, not deferred
 * work), and walks them one at a time. No new build-time data: any app that
 * configures `croutonFeedback.plan` gets a walk for free.
 */
import type { ComposedPlan, ComposedSpec } from './plan-data'

/** One behaviour to walk — flattened from the composed plan's spec entries. */
export interface WalkEntry {
  id: string
  behaviour: string
  expect: string
  hook: string
  howToTest: string
  status: string
  bucket: string
}

export type Verdict = 'works' | 'issue'
export type VerdictMap = Record<string, { verdict?: Verdict, note?: string }>

/** Plan phase/increment statuses that count as "shipped, walk it". */
const LIVE = new Set(['done', 'active'])

function toEntry(s: ComposedSpec): WalkEntry {
  return {
    id: String(s.id ?? ''),
    behaviour: s.behaviour || String(s.id ?? ''),
    expect: s.expect || '',
    hook: s.hook || '',
    howToTest: s.howToTest || '',
    status: s.status || '',
    bucket: s.bucket || ''
  }
}

/**
 * Flatten a composed plan into the ordered list of behaviours to walk: every
 * spec under a LIVE phase or LIVE increment, first occurrence wins (a spec id
 * listed under both a phase and its increment appears once). Entries with no id
 * are skipped (nothing to sign off against).
 */
export function walkEntries(plan: Partial<ComposedPlan> | null | undefined): WalkEntry[] {
  const out: WalkEntry[] = []
  const seen = new Set<string>()
  const add = (specs: ComposedSpec[] | undefined) => {
    for (const s of specs || []) {
      const id = String(s?.id ?? '')
      if (id && !seen.has(id)) { seen.add(id); out.push(toEntry(s)) }
    }
  }
  for (const ph of plan?.phases || []) {
    if (LIVE.has(ph?.status)) add(ph.specs)
    for (const inc of ph?.increments || []) if (LIVE.has(inc?.status)) add(inc.specs)
  }
  return out
}

/**
 * Split a `howToTest` string into numbered steps. The ledger stores steps as one
 * string like `"1. open a board  2. drag the block  3. release near the edge"`
 * (an optional `GRADUATED:` prefix marks a POC step rebuilt for the app). Split
 * on the boundary before each `N.` marker and strip the marker.
 */
export function stepsOf(e: Pick<WalkEntry, 'howToTest'>): string[] {
  return (e.howToTest || '')
    .replace(/^GRADUATED:\s*/i, '')
    .split(/\s(?=\d\.\s)/)
    .map(s => s.replace(/^\d\.\s*/, '').trim())
    .filter(Boolean)
}

/** A ledger `hook` (e.g. `ghost-pane[data-edge]`) → its `data-handoff` selector. */
export function selectorFor(hook: string): string {
  return hook ? `[data-handoff="${hook.split('[')[0]}"]` : ''
}

/**
 * The sign-off you paste back to the agent: a `lgtm <id>` line for every ✅
 * (the C1 sign-off tokens the done-rule derives from), then the ⚠️ issues with
 * their notes. Empty state is explicit so the export never reads as "all good".
 */
export function exportText(walk: WalkEntry[], verdicts: VerdictMap): string {
  const ok = walk.filter(e => verdicts[e.id]?.verdict === 'works').map(e => `lgtm ${e.id}`)
  const issues = walk
    .filter(e => verdicts[e.id]?.verdict === 'issue')
    .map(e => `⚠️ ${e.id}${verdicts[e.id]?.note ? ` — ${verdicts[e.id]!.note}` : ''}`)
  return [...ok, ...(issues.length ? ['', ...issues] : [])].join('\n') || '(nothing marked yet)'
}
