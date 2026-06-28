import { ref, shallowRef } from 'vue'
import { buildAnnotation } from '../overlay/capture'

/** Viewport-relative box for the highlight outline. */
export interface AnnotateBox {
  x: number
  y: number
  width: number
  height: number
}

interface PanelState {
  el: Element
  file: string
  left: number
  top: number
}

// Overlay roots whose own clicks must NOT be treated as page selections.
const OVERLAY_IDS = ['__crouton_devtools_root', '__crouton_annotate_root']

// Client-only singleton state, driven by the registered Annotate tool (#810)
// and read by the CroutonAnnotate overlay component.
const selecting = ref(false)
const hover = ref<AnnotateBox | null>(null)
const panel = shallowRef<PanelState | null>(null)
const sending = ref(false)
const toast = ref<string | null>(null)

let toastTimer: ReturnType<typeof setTimeout> | undefined

function isOurs(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false
  // `[data-crouton-ui]` covers our own UI that Nuxt UI TELEPORTS to <body> (popovers / menus like
  // the launcher's tool switch) — those render OUTSIDE the overlay roots, so an id-only `closest`
  // misses them and the switch becomes an annotation target. The marker catches them too.
  return t.closest('[data-crouton-ui]') !== null || OVERLAY_IDS.some(id => t.closest(`#${id}`) !== null)
}

function boxOf(el: Element): AnnotateBox {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

function onMove(e: MouseEvent): void {
  if (!selecting.value || panel.value || isOurs(e.target)) return
  if (e.target instanceof Element) hover.value = boxOf(e.target)
}

function onClick(e: MouseEvent): void {
  if (!selecting.value || isOurs(e.target) || !(e.target instanceof Element)) return
  e.preventDefault()
  e.stopPropagation()
  const el = e.target
  hover.value = boxOf(el)
  const file = (el.closest('[data-crouton-src]') as HTMLElement | null)
    ?.getAttribute('data-crouton-src') ?? 'unknown'
  const r = el.getBoundingClientRect()
  panel.value = {
    el,
    file,
    left: Math.max(8, Math.min(r.left, window.innerWidth - 312)),
    top: Math.max(8, Math.min(r.bottom + 8, window.innerHeight - 220))
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') stop()
}

function start(): void {
  if (typeof document === 'undefined') return
  selecting.value = true
  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
}

function stop(): void {
  selecting.value = false
  hover.value = null
  panel.value = null
  if (typeof document === 'undefined') return
  document.removeEventListener('mousemove', onMove, true)
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('keydown', onKey, true)
}

function closePanel(): void {
  panel.value = null
  hover.value = null
}

function showToast(msg: string): void {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 2600)
}

async function send(text: string): Promise<void> {
  const p = panel.value
  const trimmed = text.trim()
  if (!p || !trimmed) return
  sending.value = true
  try {
    const res = await $fetch<{ data?: { ok?: boolean } | null, error?: string | null }>(
      '/api/_review',
      { method: 'POST', body: buildAnnotation(p.el, trimmed, window.location.pathname) }
    )
    showToast(res?.data?.ok ? 'Sent ✓' : (res?.error ? `Not sent: ${res.error.slice(0, 50)}` : 'Not sent'))
  }
  catch {
    showToast('Request failed')
  }
  finally {
    sending.value = false
    closePanel()
  }
}

/**
 * Annotate state + controls (#810). The tool's activate/deactivate map to
 * start/stop; the overlay component renders `hover`/`panel`/`toast`.
 */
export function useCroutonAnnotate() {
  return { selecting, hover, panel, sending, toast, start, stop, closePanel, send }
}
