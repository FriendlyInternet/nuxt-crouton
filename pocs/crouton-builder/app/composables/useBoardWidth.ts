/**
 * Design at any width (#874 model, #942): the board renders at `effWidth` —
 * the screen's width ("Fit") or an explicit one. Wider than the screen, the
 * frame scales down to fit so a desktop layout is visible and editable on a
 * phone. The width chip drags sideways for any width and opens a menu of
 * presets + the authored breakpoints.
 */
import type { Ref } from 'vue'
import { useElementSize } from '@vueuse/core'

export const WIDTH_PRESETS = [
  { label: 'Phone', width: 390, icon: 'i-lucide-smartphone' },
  { label: 'Tablet', width: 768, icon: 'i-lucide-tablet' },
  { label: 'Laptop', width: 1024, icon: 'i-lucide-laptop' },
  { label: 'Desktop', width: 1280, icon: 'i-lucide-monitor' },
]

const MIN_WIDTH = 320
const MAX_WIDTH = 1600
const SNAP = 10

/** Snap a dragged width to the nearest preset when within reach. */
export function snapWidth(w: number): number {
  const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w))
  const preset = WIDTH_PRESETS.find(p => Math.abs(clamped - p.width) < SNAP)
  return Math.round(preset ? preset.width : clamped)
}

export function useBoardWidth(boardEl: Ref<HTMLElement | null>) {
  const { width: fitWidth, height: fitHeight } = useElementSize(boardEl)
  /** null = fit the screen. */
  const frameWidth = ref<number | null>(null)
  const effWidth = computed(() => Math.round(frameWidth.value ?? fitWidth.value))
  const scale = computed(() => (fitWidth.value && effWidth.value > fitWidth.value ? fitWidth.value / effWidth.value : 1))
  const frameStyle = computed(() => ({
    width: `${effWidth.value}px`,
    height: `${fitHeight.value / scale.value}px`,
    transform: `scale(${scale.value})`,
    transformOrigin: 'top left',
  }))
  const widthLabel = computed(() => (frameWidth.value === null ? `Fit · ${effWidth.value}px` : `${effWidth.value}px`))

  function widthMenu(bp: { list: Ref<number[]>, active: Ref<number | null>, remove: () => void }) {
    return computed(() => [
      [
        { label: 'Fit the screen', icon: 'i-lucide-maximize', onSelect: () => { frameWidth.value = null } },
        ...WIDTH_PRESETS.map(p => ({ label: `${p.label} · ${p.width}`, icon: p.icon, onSelect: () => { frameWidth.value = p.width } })),
      ],
      bp.list.value.length
        ? bp.list.value.map(w => ({ label: `≥ ${w}px · own layout`, icon: bp.active.value === w ? 'i-lucide-check' : 'i-lucide-ruler', onSelect: () => { frameWidth.value = w } }))
        : [{ label: 'No breakpoints yet — change something at a width to add one', disabled: true }],
      bp.active.value !== null
        ? [{ label: `Remove the ≥ ${bp.active.value}px layout`, icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: bp.remove }]
        : [],
    ])
  }

  /** Pointer-drag on the chip: 2px of width per px of travel; a short tap leaves Fit alone. */
  function onWidthDown(e: PointerEvent) {
    if (e.button !== 0) return
    const startX = e.clientX
    const startW = effWidth.value
    const el = e.currentTarget as HTMLElement
    try { el.setPointerCapture(e.pointerId) }
    catch {}
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (Math.abs(dx) < 6 && frameWidth.value === null) return
      ev.preventDefault()
      frameWidth.value = snapWidth(startW + dx * 2)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return { frameWidth, effWidth, scale, frameStyle, widthLabel, widthMenu, onWidthDown }
}
