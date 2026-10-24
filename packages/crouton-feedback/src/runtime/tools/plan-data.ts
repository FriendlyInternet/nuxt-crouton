/**
 * Pure plan helpers — no Vue, no Nuxt. Shared by the build-time module (reads
 * the plan + spec JSON and composes a render-ready structure) and the runtime
 * composable (reads the same shape from runtimeConfig), and unit-tested in
 * isolation.
 *
 * The **Plan** tool is DATA-first (like Changelog): the module joins a plan
 * overlay (phases/increments) with a spec ledger (the behaviour entries) into
 * one `ComposedPlan`, and the overlay renders it with plain Nuxt UI components —
 * no iframe, no bespoke renderer to drift.
 */

/** A behaviour entry from the spec ledger (only the fields the overlay shows). */
export interface SpecEntry {
  id?: string
  behaviour?: string
  expect?: string
  hook?: string
  howToTest?: string
  status?: string
  signedOff?: string
}

/** A phase/increment in the plan overlay's structured data. */
export interface PlanPhase {
  id?: string
  name?: string
  status?: string
  summary?: string
  worksNow?: string
  gate?: string
  note?: string
  flow?: string
  steps?: { name?: string, status?: string, test?: string }[]
  increments?: PlanPhase[]
  /** Spec ids this phase/increment covers (resolved against the ledger). */
  specs?: string[]
}

/** The plan overlay's structured data (the editable overlay JSON). */
export interface PlanData {
  title?: string
  specSource?: string
  epic?: number
  pr?: number
  intro?: string
  statusLegend?: Record<string, string>
  phases?: PlanPhase[]
}

/** A spec entry resolved from the ledger + tagged with its graduation bucket. */
export interface ComposedSpec extends SpecEntry {
  /** Preserve | Replace | Add | Proposed — the graduation bucket for the badge. */
  bucket: string
}

export interface ComposedIncrement {
  id: string
  name: string
  status: string
  flow: string
  note: string
  worksNow: string
  specs: ComposedSpec[]
}

export interface ComposedPhase {
  id: string
  name: string
  status: string
  summary: string
  worksNow: string
  gate: string
  steps: { name: string, status: string, test: string }[]
  increments: ComposedIncrement[]
  specs: ComposedSpec[]
}

export interface ComposedPlan {
  title: string
  badge: string
  intro: string
  epic: number | null
  pr: number | null
  statusLegend: Record<string, string>
  phases: ComposedPhase[]
}

/** Ledger status → the graduation bucket label the overlay badges a spec with. */
const BUCKET: Record<string, string> = {
  settled: 'Preserve',
  stopgap: 'Replace',
  new: 'Add',
  proposed: 'Proposed'
}

/**
 * The launcher-row badge: the id of the deepest **active** step, so a glance at
 * the row says where the plan is. When the active phase has increments, the
 * active increment's id wins (e.g. `B2`); otherwise the phase id (e.g. `B`).
 * Returns null when nothing is marked active (badge simply doesn't render).
 */
export function planBadge(raw: unknown): string | null {
  const data = (raw && typeof raw === 'object' ? raw : {}) as PlanData
  const phases = Array.isArray(data.phases) ? data.phases : []
  for (const phase of phases) {
    if (phase?.status !== 'active') continue
    const incs = Array.isArray(phase.increments) ? phase.increments : []
    const activeInc = incs.find(i => i?.status === 'active')
    const id = activeInc?.id ?? phase.id
    return id ? String(id) : null
  }
  return null
}

/** The overlay title: the plan's own `title`, else the supplied fallback. */
export function planTitle(raw: unknown, fallback = 'Plan'): string {
  const data = (raw && typeof raw === 'object' ? raw : {}) as PlanData
  return typeof data.title === 'string' && data.title ? data.title : fallback
}

function resolveSpec(id: string, specById: Map<string, SpecEntry>): ComposedSpec {
  const e = specById.get(id) ?? { id, behaviour: id }
  return { ...e, id, bucket: BUCKET[e.status ?? ''] ?? (e.status ?? '') }
}

function composeSpecs(ids: unknown, specById: Map<string, SpecEntry>): ComposedSpec[] {
  return (Array.isArray(ids) ? ids : []).map(id => resolveSpec(String(id), specById))
}

/**
 * Join the plan overlay with the spec ledger into one render-ready structure.
 * Each phase/increment's `specs` (a list of ids) is resolved to full spec
 * entries tagged with their bucket; missing fields default so the overlay can
 * map over a stable shape without guards. `specRaw` may be an array (the
 * ledger) or absent (ids then render as their own titles).
 */
export function composePlan(planRaw: unknown, specRaw: unknown): ComposedPlan {
  const data = (planRaw && typeof planRaw === 'object' ? planRaw : {}) as PlanData
  const ledger = Array.isArray(specRaw) ? (specRaw as SpecEntry[]) : []
  const specById = new Map<string, SpecEntry>(ledger.filter(e => e?.id).map(e => [String(e.id), e]))

  const phases: ComposedPhase[] = (Array.isArray(data.phases) ? data.phases : []).map(p => ({
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    status: String(p.status ?? ''),
    summary: String(p.summary ?? ''),
    worksNow: String(p.worksNow ?? ''),
    gate: String(p.gate ?? ''),
    steps: (Array.isArray(p.steps) ? p.steps : []).map(s => ({
      name: String(s.name ?? ''),
      status: String(s.status ?? ''),
      test: String(s.test ?? '')
    })),
    increments: (Array.isArray(p.increments) ? p.increments : []).map(inc => ({
      id: String(inc.id ?? ''),
      name: String(inc.name ?? ''),
      status: String(inc.status ?? ''),
      flow: String(inc.flow ?? ''),
      note: String(inc.note ?? ''),
      worksNow: String(inc.worksNow ?? ''),
      specs: composeSpecs(inc.specs, specById)
    })),
    specs: composeSpecs(p.specs, specById)
  }))

  return {
    title: planTitle(data, 'Plan'),
    badge: planBadge(data) || '',
    intro: String(data.intro ?? ''),
    epic: typeof data.epic === 'number' ? data.epic : null,
    pr: typeof data.pr === 'number' ? data.pr : null,
    statusLegend: (data.statusLegend && typeof data.statusLegend === 'object') ? data.statusLegend : {},
    phases
  }
}
