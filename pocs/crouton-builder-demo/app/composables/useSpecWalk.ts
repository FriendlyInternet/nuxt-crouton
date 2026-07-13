import { computed } from 'vue'
import { useState } from 'nuxt/app'
import specData from '~~/spec.json'

/**
 * useSpecWalk — shared state + logic for the in-app reconcile/verify walk (#1039).
 *
 * State lives in `useState` (NOT a module-level ref): the tool plugin and the panel
 * component are bundled in different chunks, and a module-level ref can duplicate
 * across that boundary — the plugin would flip its copy while the panel reads a
 * different one (open never renders, no error). `useState` is one shared instance
 * app-wide, so the launcher toggle and the panel see the same flag. Verdicts persist
 * to localStorage; the export shape matches scripts/spec-walklist.mjs.
 */

export type SpecStatus = 'settled' | 'stopgap' | 'new' | 'proposed'
export interface SpecEntry {
  id: string; behaviour: string; when: string; expect: string; hook: string
  howToTest: string; status: SpecStatus; consideredRejected?: string[]
}
export type Verdict = 'confirmed' | 'contradicted' | 'undocumented'
type VerdictMap = Record<string, { verdict?: Verdict; note?: string }>

const spec = (Array.isArray(specData) ? specData : []) as SpecEntry[]
const walk = spec.filter(e => e.status === 'proposed')
const refEntries = spec.filter(e => e.status !== 'proposed')
const STORE = 'specwalk:crouton-builder-demo'

const stepsOf = (e: SpecEntry) => (e.howToTest || '').split(/\s(?=\d\.\s)/).map(s => s.replace(/^\d\.\s*/, ''))
const selectorFor = (hook: string) => hook ? `[data-handoff="${hook.split('[')[0]}"]` : ''

let hydrated = false

export function useSpecWalk() {
  const open = useState<boolean>('spec-walk-open', () => false)
  const idx = useState<number>('spec-walk-idx', () => 0)
  const verdicts = useState<VerdictMap>('spec-walk-verdicts', () => ({}))

  if (import.meta.client && !hydrated) {
    hydrated = true
    try { const s = JSON.parse(localStorage.getItem(STORE) || '{}'); if (s && typeof s === 'object') verdicts.value = s } catch { /* fresh */ }
  }
  const persist = () => { if (import.meta.client) { try { localStorage.setItem(STORE, JSON.stringify(verdicts.value)) } catch { /* ignore */ } } }

  const marked = computed(() => walk.filter(e => verdicts.value[e.id]?.verdict).length)
  const current = computed(() => walk[idx.value])

  function setVerdict(v: Verdict) {
    const e = current.value; if (!e) return
    verdicts.value = { ...verdicts.value, [e.id]: { ...(verdicts.value[e.id] || {}), verdict: v } }; persist()
    if (idx.value < walk.length - 1) setTimeout(() => { idx.value++ }, 160)
  }
  function setNote(val: string) {
    const e = current.value; if (!e) return
    verdicts.value = { ...verdicts.value, [e.id]: { ...(verdicts.value[e.id] || {}), note: val } }; persist()
  }
  const go = (d: number) => { idx.value = Math.min(walk.length - 1, Math.max(0, idx.value + d)) }

  const exportPayload = computed(() => ({
    spec: 'crouton-builder-demo',
    verdicts: walk.map(e => ({ id: e.id, status: e.status, verdict: verdicts.value[e.id]?.verdict || 'skipped', note: verdicts.value[e.id]?.note || '' })),
    readonly: refEntries.map(e => ({ id: e.id, status: e.status }))
  }))
  const exportText = computed(() => JSON.stringify(exportPayload.value, null, 2))

  return { open, idx, walk, verdicts, marked, current, setVerdict, setNote, go, exportText, stepsOf, selectorFor }
}
