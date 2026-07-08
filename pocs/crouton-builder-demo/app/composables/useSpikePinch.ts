/**
 * Pinch-to-zoom over a layout (#948): SpikeBlockNode catches a 2-finger gesture and calls this so the
 * canvas zooms even when the fingers start on a node (Vue Flow's own pinch never fires there — the
 * node's drag eats it). We read the live viewport transform and re-`setCenter` with the math that
 * keeps the pinched point fixed under the fingers (Vue Flow exposes setCenter but not setViewport).
 */
import { provide } from 'vue'
import type { Ref } from 'vue'
import { SPIKE_PINCH_KEY } from '~/utils/spike-layout'
import type { SpikeFlowHandle } from '~/utils/spike-board'

export function useSpikePinch(flowRef: Ref<SpikeFlowHandle | null>, zoomNodeId: Ref<string | null>) {
  function pinchZoom(ratio: number, midX: number, midY: number) {
    // Pinch zooms the CANVAS — only the full-screen edit view (zoomNodeId) owns the screen and must
    // not be pinched.
    if (zoomNodeId.value) return
    const container = document.querySelector('.crouton-vue-flow') as HTMLElement | null
    // The zoom transform lives on `.vue-flow__transformationpane` — `.vue-flow__viewport` has NO
    // transform (it reads `none` → identity → z=1), which made the pinch math read the wrong zoom and
    // never actually zoom. Read the pane that actually carries `translate()…scale()`. (#948)
    const vp = container?.querySelector('.vue-flow__transformationpane') as HTMLElement | null
    if (!container || !vp || !flowRef.value?.setCenter) return
    const m = new DOMMatrix(getComputedStyle(vp).transform)
    const z = m.a
    if (!z || !isFinite(ratio) || ratio <= 0) return
    const rect = container.getBoundingClientRect()
    const px = midX - rect.left, py = midY - rect.top // pinch midpoint, container-relative
    const pfx = (px - m.e) / z, pfy = (py - m.f) / z   // flow point currently under the fingers
    const nz = Math.min(4, Math.max(0.1, z * ratio))
    // Centre to pass so that flow point (pfx,pfy) lands back at the fingers (px,py) at the new zoom.
    const cx = pfx + (rect.width / 2 - px) / nz
    const cy = pfy + (rect.height / 2 - py) / nz
    flowRef.value.setCenter(cx, cy, { zoom: nz, duration: 0 })
  }
  provide(SPIKE_PINCH_KEY, pinchZoom)
  return { pinchZoom }
}
