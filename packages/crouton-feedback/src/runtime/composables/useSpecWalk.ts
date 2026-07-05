import { computed, ref } from 'vue'
import { useRuntimeConfig } from 'nuxt/app'
import type { ComposedPlan } from '../tools/plan-data'
import {
  walkEntries,
  stepsOf,
  selectorFor,
  exportText as buildExport,
  type WalkEntry,
  type Verdict,
  type VerdictMap
} from '../tools/specwalk-data'

/**
 * The client-side view of the Spec-walk tool. It reads the SAME composed plan
 * the Plan tool renders (`runtimeConfig.public.croutonPlan`), flattens its LIVE
 * behaviours into a walk, and holds the per-behaviour verdicts.
 *
 * Data-first (like usePlan/useChangelog): no bespoke build-time data — any app
 * that configures `croutonFeedback.plan` gets the walk. State is a
 * module-singleton so the tool factory (opens it, badges it) and the overlay
 * (renders it) share one reactive source; verdicts persist to localStorage,
 * scoped per app so two apps' walks don't collide.
 */
export type { WalkEntry, Verdict } from '../tools/specwalk-data'

// Module-singletons — one shared reactive source across plugin + overlay chunks.
const open = ref(false)
const idx = ref(0)
const verdicts = ref<VerdictMap>({})

let _walk: WalkEntry[] | null = null
let _store = ''
let hydrated = false

function slug(s: string): string {
  return (s || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app'
}

export function useSpecWalk() {
  const cfg = (useRuntimeConfig().public.croutonPlan ?? {}) as Partial<ComposedPlan>

  // Memoize the flattened walk + storage key (croutonPlan is build-time constant).
  if (!_walk) {
    _walk = walkEntries(cfg)
    _store = `specwalk:${slug(cfg.title || '')}`
  }
  const walk = _walk

  if (import.meta.client && !hydrated) {
    hydrated = true
    try {
      const s = JSON.parse(localStorage.getItem(_store) || '{}')
      if (s && typeof s === 'object') verdicts.value = s
    } catch { /* fresh */ }
  }
  const persist = () => {
    if (!import.meta.client) return
    try { localStorage.setItem(_store, JSON.stringify(verdicts.value)) } catch { /* ignore */ }
  }

  // --- Scope (#1180 follow-up) -------------------------------------------------
  // The full walk (`allWalk`) is the growing regression check — "does everything
  // still work". But you often just want to check WHAT YOU JUST ADDED: a scope is
  // a subset of behaviour ids (one behaviour, or one increment's set) the Plan
  // tool sets when you tap its Walk buttons. `active` is the list you're walking:
  // the scope when set, else the whole thing. Verdicts stay global (keyed by id),
  // so a scoped pass still counts toward the overall marked/total.
  const allWalk = walk
  const scopeIds = ref<string[] | null>(null)
  const active = computed<WalkEntry[]>(() => {
    const s = scopeIds.value
    return s && s.length ? allWalk.filter(e => s.includes(e.id)) : allWalk
  })
  const scoped = computed(() => !!(scopeIds.value && scopeIds.value.length))

  const marked = computed(() => active.value.filter(e => verdicts.value[e.id]?.verdict).length)
  const markedTotal = computed(() => allWalk.filter(e => verdicts.value[e.id]?.verdict).length)
  const total = computed(() => allWalk.length)
  const current = computed(() => active.value[idx.value])
  // The launcher badge tracks OVERALL progress (not the current scope).
  const badge = computed<string | null>(() => (allWalk.length ? `${markedTotal.value}/${allWalk.length}` : null))

  function setVerdict(v: Verdict) {
    const e = current.value
    if (!e) return
    verdicts.value = { ...verdicts.value, [e.id]: { ...(verdicts.value[e.id] || {}), verdict: v } }
    persist()
    // Advance on a pass so a clean walk is one-tap-per-behaviour.
    if (v === 'works' && idx.value < active.value.length - 1) setTimeout(() => { idx.value++ }, 160)
  }
  function setNote(val: string) {
    const e = current.value
    if (!e) return
    verdicts.value = { ...verdicts.value, [e.id]: { ...(verdicts.value[e.id] || {}), note: val } }
    persist()
  }
  const go = (d: number) => { idx.value = Math.min(active.value.length - 1, Math.max(0, idx.value + d)) }

  // Open the walk focused on a single behaviour id (Plan → a behaviour's "Walk &
  // sign off"): scope to JUST that one. Returns false if it isn't a live entry.
  function jumpTo(id: string): boolean {
    if (!allWalk.some(e => e.id === id)) return false
    scopeIds.value = [id]
    idx.value = 0
    open.value = true
    return true
  }
  // Walk a SECTION (Plan → an increment's / phase's "Walk & sign off"): scope to
  // its live behaviours. Empty ⇒ falls back to the full walk.
  function walkScoped(ids: string[]) {
    const valid = ids.filter(id => allWalk.some(e => e.id === id))
    scopeIds.value = valid.length ? valid : null
    idx.value = 0
    open.value = true
  }
  // Walk EVERYTHING (Plan → the top "Check & sign off" bar): the full regression.
  function walkAll() {
    scopeIds.value = null
    idx.value = 0
    open.value = true
  }
  const isWalkable = (id: string) => allWalk.some(e => e.id === id)
  const verdictOf = (id: string) => verdicts.value[id]?.verdict

  // Sign-off export: the current scope when scoped (sign off just what you
  // checked), else the whole accumulated set.
  const text = computed(() => buildExport(scoped.value ? active.value : allWalk, verdicts.value))

  return {
    open, idx, walk: active, verdicts, marked, markedTotal, total, current, badge, scoped,
    setVerdict, setNote, go, jumpTo, walkScoped, walkAll, isWalkable, verdictOf,
    exportText: text, stepsOf, selectorFor
  }
}
