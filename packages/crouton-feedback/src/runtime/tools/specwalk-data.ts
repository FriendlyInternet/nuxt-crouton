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
export function exportText(walk: WalkEntry[], verdicts: VerdictMap, env = ''): string {
  const ok = walk.filter(e => verdicts[e.id]?.verdict === 'works').map(e => `lgtm ${e.id}`)
  const issues = walk
    .filter(e => verdicts[e.id]?.verdict === 'issue')
    .map(e => `⚠️ ${e.id}${verdicts[e.id]?.note ? ` — ${verdicts[e.id]!.note}` : ''}`)
  const body = [...ok, ...(issues.length ? ['', ...issues] : [])].join('\n') || '(nothing marked yet)'
  // The environment stamp (#1181) rides along so a sign-off says WHERE it was checked.
  return env ? `${env}\n\n${body}` : body
}

/** An ad-hoc walk carried in the link (`?walk=<base64url JSON>`) instead of the build-time plan. */
export interface AdhocWalk {
  title: string
  app: string
  ref: string
  entries: WalkEntry[]
}

/** Max encoded size of the `walk` param — the link rides in a URL, keep it small. */
export const MAX_WALK_PARAM = 2048
const MAX_STEPS = 30

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/**
 * Parse + validate the `walk` URL param: base64url JSON `{ title, app, ref,
 * steps: [{ text, expect? }] }`. Returns null for anything missing, oversized,
 * malformed or empty — the link is untrusted input, a bad one is just ignored.
 * Each step becomes one WalkEntry (id is scoped by a hash of the payload so
 * verdicts from one link never leak into another). No secrets belong here.
 */
export function parseWalkParam(raw: unknown): AdhocWalk | null {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_WALK_PARAM) return null
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) return null
  let data: any
  try {
    const b64 = raw.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))))
  } catch { return null }
  if (!data || typeof data !== 'object' || !Array.isArray(data.steps)) return null
  const scope = djb2(raw)
  const entries: WalkEntry[] = []
  for (const s of data.steps.slice(0, MAX_STEPS)) {
    const text = clip(s?.text, 300)
    if (!text) continue
    entries.push({
      id: `walk-${scope}-${entries.length + 1}`,
      behaviour: text,
      expect: clip(s?.expect, 300),
      hook: '',
      howToTest: '',
      status: '',
      bucket: ''
    })
  }
  if (!entries.length) return null
  return { title: clip(data.title, 80) || 'Walk', app: clip(data.app, 60), ref: clip(data.ref, 60), entries }
}

/**
 * Handle a route query that may carry `walk` — used for both the first page load
 * and every later client-side navigation (e.g. the post-sign-in redirect lands
 * on `/?walk=…` without a page load). Opens the walk if valid, then always calls
 * `drop` so a reload doesn't restart it. Returns true when a `walk` param was present.
 */
export function consumeWalkQuery(
  query: Record<string, unknown> | null | undefined,
  deps: { start: (raw: string) => boolean, drop: () => void }
): boolean {
  const v = query?.walk
  const raw = Array.isArray(v) ? v[0] : v
  if (raw === undefined || raw === null) return false
  if (typeof raw === 'string') deps.start(raw)
  deps.drop()
  return true
}
