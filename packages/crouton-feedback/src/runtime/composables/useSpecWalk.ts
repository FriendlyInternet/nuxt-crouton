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

  const marked = computed(() => walk.filter(e => verdicts.value[e.id]?.verdict).length)
  const current = computed(() => walk[idx.value])
  const badge = computed<string | null>(() => (walk.length ? `${marked.value}/${walk.length}` : null))

  function setVerdict(v: Verdict) {
    const e = current.value
    if (!e) return
    verdicts.value = { ...verdicts.value, [e.id]: { ...(verdicts.value[e.id] || {}), verdict: v } }
    persist()
    // Advance on a pass so a clean walk is one-tap-per-behaviour.
    if (v === 'works' && idx.value < walk.length - 1) setTimeout(() => { idx.value++ }, 160)
  }
  function setNote(val: string) {
    const e = current.value
    if (!e) return
    verdicts.value = { ...verdicts.value, [e.id]: { ...(verdicts.value[e.id] || {}), note: val } }
    persist()
  }
  const go = (d: number) => { idx.value = Math.min(walk.length - 1, Math.max(0, idx.value + d)) }

  const text = computed(() => buildExport(walk, verdicts.value))

  return {
    open, idx, walk, verdicts, marked, current, badge,
    setVerdict, setNote, go, exportText: text, stepsOf, selectorFor
  }
}
