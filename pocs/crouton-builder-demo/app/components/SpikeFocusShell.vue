<script setup lang="ts">
/**
 * SpikeFocusShell (#907 focus-view v2) — the "zoom into the layout" edit experience.
 *
 * Instead of a separate full-screen edit SCREEN, tapping a node makes that layout ZOOM UP in place:
 * the card animates from the node's real on-screen rect to centre (a shared-element transition — NOT
 * the Vue Flow camera, so no re-measure/framing fight), the rest of the board falls away behind a
 * blurred backdrop, and a minimal control SHELL hugs the layout — the breakpoint key-points pop up,
 * the device + width controls ride a floating pill. Apple-ish: soft translucency, spring motion, the
 * layout is the hero; the dense stuff hides behind a "⋯" reveal.
 *
 * COLLAPSE = HIDE-RECIPES (#852). Each pane picks HOW it tucks when collapsed — an EDGE
 * (left/top/right/bottom) + an AFFORDANCE (tab/button/dot). That choice is a real, persisted field
 * on the leaf (`leaf.collapse`, set via `setCollapseRecipe`); the package renderer
 * (`CroutonLayoutResponsiveRenderer`) tucks each collapsed pane to its edge as its affordance and
 * reflows the survivors — so this shell just drives the dials, the layout layer renders the result.
 *
 * Composed in the POC from the layout engine's pure utils (same logic the package's BreakpointAuthor
 * uses) so the v-model + resize→keypoint contract is identical — only the presentation is bespoke.
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useElementSize } from '@vueuse/core'
import type { LayoutTree, LayoutNode, LayoutCollapseEdge, LayoutCollapseAffordance } from '@fyit/crouton-core/app/types/layout'
import { applySizes, setCollapseRecipe, type NodePath } from '@fyit/crouton-layout/app/utils/layout-edit'
// resolveLayoutAtWidth / listBlocks / patchBreakpoint / removeBreakpoint are auto-imported from the
// crouton-layout layer (its `app/utils/layout-responsive` isn't in the package `exports` map).

const props = defineProps<{
  modelValue: LayoutTree
  label?: string
  originRect?: { x: number, y: number, width: number, height: number } | null
}>()
const emit = defineEmits<{ 'update:modelValue': [tree: LayoutTree], close: [] }>()

const tree = computed(() => props.modelValue)
function update(next: LayoutTree) { emit('update:modelValue', next) }

// --- width / devices / breakpoints (same model as the package author) -----------------
const MIN = 320
const MAX = 1600
const simWidth = ref(390)
const DEVICES = [
  { label: 'Phone', width: 390, icon: 'i-lucide-smartphone' },
  { label: 'Tablet', width: 768, icon: 'i-lucide-tablet' },
  { label: 'Laptop', width: 1024, icon: 'i-lucide-laptop' },
  { label: 'Desktop', width: 1440, icon: 'i-lucide-monitor' },
] as const

const breakpoints = computed(() => (tree.value.breakpoints ?? []).slice().sort((a, b) => a.minWidth - b.minWidth))
const resolved = computed(() => resolveLayoutAtWidth(tree.value, simWidth.value))
const activeMin = computed(() => resolved.value.activeBreakpoint)
const blocks = computed(() => listBlocks(resolved.value.root))

// --- hide-recipes: per-pane collapse recipe (edge + affordance) — a PERSISTED leaf field -------
interface RecipePreset { id: string, label: string, icon: string, edge: LayoutCollapseEdge, affordance: LayoutCollapseAffordance }
const RECIPES: RecipePreset[] = [
  { id: 'tab-left', label: 'Tab · left', icon: 'i-lucide-panel-left', edge: 'left', affordance: 'tab' },
  { id: 'tab-top', label: 'Tab · top', icon: 'i-lucide-panel-top', edge: 'top', affordance: 'tab' },
  { id: 'button-top', label: 'Button · top', icon: 'i-lucide-rectangle-horizontal', edge: 'top', affordance: 'button' },
  { id: 'dot-right', label: 'Dot · right', icon: 'i-lucide-circle-dot', edge: 'right', affordance: 'dot' },
  { id: 'tab-bottom', label: 'Tab · bottom', icon: 'i-lucide-panel-bottom', edge: 'bottom', affordance: 'tab' },
]
// The current recipe of a block (read from listBlocks, which normalizes the leaf's `collapse`).
function recipeOf(blockId: string) { return blocks.value.find(b => b.blockId === blockId)?.recipe ?? { edge: 'right', affordance: 'tab' } }
function presetOf(blockId: string): RecipePreset {
  const r = recipeOf(blockId)
  return RECIPES.find(p => p.edge === r.edge && p.affordance === r.affordance)
    ?? { id: 'custom', label: `${r.affordance} · ${r.edge}`, icon: 'i-lucide-layout-panel-left', edge: r.edge, affordance: r.affordance }
}
function setRecipe(blockId: string, p: RecipePreset) {
  update({ ...tree.value, root: setCollapseRecipe(tree.value.root, blockId, { edge: p.edge, affordance: p.affordance }) })
}

function isCollapsed(blockId: string) { return resolved.value.collapsed.includes(blockId) }
// Author BY DEMONSTRATION — a collapse at the current width snapshots a checkpoint there.
function authorHere(patch: { collapsed?: string[] }) {
  update(patchBreakpoint(tree.value, simWidth.value, {
    collapsed: patch.collapsed ?? [...resolved.value.collapsed],
    variants: { ...resolved.value.variants },
    ...(resolved.value.collapseStyle !== undefined ? { collapseStyle: resolved.value.collapseStyle } : {}),
  }))
}
function onToggleCollapse(blockId: string) {
  const cur = resolved.value.collapsed
  authorHere({ collapsed: cur.includes(blockId) ? cur.filter(id => id !== blockId) : [...cur, blockId] })
}
function onExpand(blockId: string) { if (isCollapsed(blockId)) onToggleCollapse(blockId) }

// Scrubbing the width makes the layout reflow (panes hit their min-width as it narrows), and the
// renderer fires `layoutChange` for that reflow too — which would author a key-point at EVERY width
// you slide through (the spam bug). Suppress onResize for a beat after any width change.
const suppressResize = ref(true)
let suppressTimer: ReturnType<typeof setTimeout> | null = null
watch(simWidth, () => {
  suppressResize.value = true
  if (suppressTimer) clearTimeout(suppressTimer)
  suppressTimer = setTimeout(() => { suppressResize.value = false }, 350)
})
function onResize(path: NodePath, sizes: number[]) {
  if (suppressResize.value) return // reflow from a width change, not a user splitter drag
  update(patchBreakpoint(tree.value, simWidth.value, {
    root: applySizes(resolved.value.root, path, sizes),
    collapsed: [...resolved.value.collapsed],
    variants: { ...resolved.value.variants },
    ...(resolved.value.collapseStyle !== undefined ? { collapseStyle: resolved.value.collapseStyle } : {}),
  }))
}
function jumpTo(minWidth: number) { simWidth.value = minWidth }
function dropCheckpoint(minWidth: number) { update(removeBreakpoint(tree.value, minWidth)) }
const pct = (w: number) => ((w - MIN) / (MAX - MIN)) * 100

// --- the scaled layout frame (fit to the available stage, never clipped) --------------
const stageRef = ref<HTMLElement | null>(null)
const { width: stageW, height: stageH } = useElementSize(stageRef)
const availW = computed(() => Math.max(240, stageW.value - 24))
const availH = computed(() => Math.max(320, stageH.value - 16))
const displayW = computed(() => Math.min(simWidth.value, availW.value))
const scale = computed(() => displayW.value / simWidth.value)
const wrapperStyle = computed(() => ({ width: `${Math.round(displayW.value)}px`, height: `${Math.round(availH.value)}px` }))
const innerStyle = computed(() => ({
  width: `${simWidth.value}px`,
  height: `${Math.round(availH.value / scale.value)}px`,
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left',
}))

// --- shared-element zoom (wrapper morphs from the node's rect → centre) ----------------
const flipRef = ref<HTMLElement | null>(null)
const ready = ref(false)
function flipFrom(rect: { x: number, y: number, width: number, height: number }) {
  const el = flipRef.value
  if (!el) return
  const f = el.getBoundingClientRect()
  if (!f.width || !f.height) return
  el.style.transformOrigin = 'top left'
  el.style.transition = 'none'
  el.style.transform = `translate(${rect.x - f.x}px, ${rect.y - f.y}px) scale(${rect.width / f.width}, ${rect.height / f.height})`
  el.style.opacity = '0.85'
  void el.offsetWidth
  requestAnimationFrame(() => {
    if (!flipRef.value) return
    flipRef.value.style.transition = 'transform 0.46s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease'
    flipRef.value.style.transform = 'none'
    flipRef.value.style.opacity = '1'
  })
}
onMounted(async () => {
  await nextTick()
  if (props.originRect) flipFrom(props.originRect)
  window.setTimeout(() => { ready.value = true }, props.originRect ? 240 : 0)
  window.setTimeout(() => { suppressResize.value = false }, 600)
})

const closing = ref(false)
function requestClose() {
  if (closing.value) return
  const el = flipRef.value
  const o = props.originRect
  ready.value = false
  if (el && o) {
    const f = el.getBoundingClientRect()
    el.style.transformOrigin = 'top left'
    el.style.transition = 'transform 0.34s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease'
    el.style.transform = `translate(${o.x - f.x}px, ${o.y - f.y}px) scale(${o.width / f.width}, ${o.height / f.height})`
    el.style.opacity = '0.6'
    closing.value = true
    let done = false
    const finish = () => { if (!done) { done = true; emit('close') } }
    el.addEventListener('transitionend', finish, { once: true })
    window.setTimeout(finish, 420)
  }
  else emit('close')
}

const optionsOpen = ref(false)

// --- per-panel selection (#907) — tap a panel IN the layout → its settings appear -----
const selectedBlockId = ref<string | null>(null)
interface Region { blockId: string, label?: string, left: number, top: number, width: number, height: number }
function leafRegions(node: LayoutNode, left: number, top: number, width: number, height: number): Region[] {
  if (node.type === 'leaf') {
    const b = blocks.value.find(x => x.blockId === node.blockId)
    return [{ blockId: node.blockId, label: b?.label, left, top, width, height }]
  }
  if (node.type === 'nested') return leafRegions(node.layout.root, left, top, width, height)
  const horizontal = node.direction === 'horizontal'
  const sizes = node.children.map(c => (typeof (c as { defaultSize?: number }).defaultSize === 'number' ? (c as { defaultSize?: number }).defaultSize! : 100 / node.children.length))
  const total = sizes.reduce((a, b) => a + b, 0) || 1
  let off = 0
  const out: Region[] = []
  node.children.forEach((c, i) => {
    const frac = sizes[i]! / total
    if (horizontal) out.push(...leafRegions(c, left + off * width, top, frac * width, height))
    else out.push(...leafRegions(c, left, top + off * height, width, frac * height))
    off += frac
  })
  return out
}
const regions = computed(() => leafRegions(resolved.value.root, 0, 0, 100, 100))
const selectedBlock = computed(() => blocks.value.find(b => b.blockId === selectedBlockId.value) ?? null)
const multiBlock = computed(() => regions.value.length > 1)

const innerRef = ref<HTMLElement | null>(null)
function onLayoutClick(e: MouseEvent) {
  const el = innerRef.value
  if (!el || !multiBlock.value) return
  const r = el.getBoundingClientRect()
  const px = ((e.clientX - r.left) / r.width) * 100
  const py = ((e.clientY - r.top) / r.height) * 100
  const hit = regions.value.find(rg => px >= rg.left && px <= rg.left + rg.width && py >= rg.top && py <= rg.top + rg.height)
  if (hit) { selectedBlockId.value = hit.blockId; optionsOpen.value = true }
}
watch([() => regions.value.length, () => regions.value.map(r => r.blockId).join('|')], () => {
  if (regions.value.length === 1) selectedBlockId.value = regions.value[0]!.blockId
  else if (selectedBlockId.value && !regions.value.some(r => r.blockId === selectedBlockId.value)) selectedBlockId.value = null
}, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <div class="spike-focus fixed inset-0 z-50 flex flex-col">
      <div
        class="spike-focus__scrim absolute inset-0 bg-default/55 backdrop-blur-xl"
        @click="requestClose"
      />

      <div class="relative z-10 flex items-center justify-between px-4 pt-4">
        <span class="flex items-center gap-1.5 rounded-full bg-elevated/70 px-3 py-1.5 text-xs font-medium text-muted shadow-sm backdrop-blur">
          <UIcon name="i-lucide-layout-template" class="size-3.5 text-primary" />
          {{ label || 'Layout' }}
        </span>
        <button
          type="button"
          class="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-inverted shadow-sm transition-transform active:scale-95"
          @click="requestClose"
        >Done</button>
      </div>

      <div ref="stageRef" class="relative z-10 grid min-h-0 flex-1 place-items-center overflow-hidden px-3 pt-3">
        <div
          ref="flipRef"
          class="spike-focus__card overflow-hidden rounded-[1.75rem] bg-default shadow-lg ring-1 ring-default/15"
          :style="wrapperStyle"
        >
          <div ref="innerRef" class="relative" :style="innerStyle" @click="onLayoutClick">
            <CroutonLayoutResponsiveRenderer
              :tree="tree"
              :width="simWidth"
              class="h-full w-full"
              @expand="onExpand"
              @layout-change="onResize"
            />
            <!-- selection focus: dim the OTHER panels so the tapped one stands out -->
            <template v-if="multiBlock && selectedBlockId">
              <div
                v-for="(rg, i) in regions"
                v-show="rg.blockId !== selectedBlockId"
                :key="i"
                class="pointer-events-none absolute bg-default/55 transition-opacity duration-200"
                :style="{ left: `${rg.left}%`, top: `${rg.top}%`, width: `${rg.width}%`, height: `${rg.height}%` }"
              />
            </template>
          </div>
        </div>
      </div>

      <Transition name="shell-rise">
        <div v-if="ready" class="relative z-10 mx-auto mb-[max(1rem,env(safe-area-inset-bottom))] w-full max-w-md px-3">
          <div class="flex flex-col gap-2 rounded-[1.75rem] border border-default/60 bg-elevated/85 p-2.5 shadow-xl backdrop-blur-xl">
            <div class="flex items-center gap-1">
              <UButton
                v-for="d in DEVICES"
                :key="d.label"
                :icon="d.icon"
                size="xs"
                :aria-label="d.label"
                :title="`${d.label} · ${d.width}px`"
                :color="simWidth === d.width ? 'primary' : 'neutral'"
                :variant="simWidth === d.width ? 'solid' : 'ghost'"
                @click="simWidth = d.width"
              />
              <span class="ml-auto rounded-full bg-default/70 px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted">{{ simWidth }}px</span>
              <UButton
                :icon="optionsOpen ? 'i-lucide-chevron-up' : 'i-lucide-sliders-horizontal'"
                size="xs"
                color="neutral"
                :variant="optionsOpen ? 'soft' : 'ghost'"
                aria-label="Options"
                @click="optionsOpen = !optionsOpen"
              />
            </div>
            <div class="px-1 pb-0.5">
              <USlider v-model="simWidth" :min="MIN" :max="MAX" :step="1" size="xs" aria-label="Width" />
              <div v-if="breakpoints.length" class="relative mt-1.5 h-3">
                <UPopover v-for="bp in breakpoints" :key="bp.minWidth">
                  <button
                    type="button"
                    class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-1.5"
                    :style="{ left: `${pct(bp.minWidth)}%` }"
                    :aria-label="`Breakpoint ${bp.minWidth}px`"
                    @click="jumpTo(bp.minWidth)"
                  >
                    <span
                      class="block size-2.5 rounded-full ring-2 ring-elevated transition-colors"
                      :class="bp.minWidth === activeMin ? 'bg-primary' : 'bg-muted'"
                    />
                  </button>
                  <template #content>
                    <div class="flex items-center gap-1.5 px-2 py-1.5">
                      <span
                        class="size-1.5 rounded-full"
                        :class="bp.minWidth === activeMin ? 'bg-primary' : 'bg-muted'"
                      />
                      <span class="font-mono text-xs tabular-nums">{{ bp.minWidth }}px</span>
                      <UButton
                        icon="i-lucide-trash-2"
                        size="xs"
                        color="error"
                        variant="ghost"
                        aria-label="Remove breakpoint"
                        @click="dropCheckpoint(bp.minWidth)"
                      />
                    </div>
                  </template>
                </UPopover>
              </div>
            </div>

            <!-- "⋯" reveal — the selected panel: collapse it + pick HOW it tucks (the hide-recipe). -->
            <Transition name="opts">
              <div v-if="optionsOpen" class="border-t border-default/50 pt-2">
                <div v-if="selectedBlock" class="flex items-center gap-2">
                  <UIcon name="i-lucide-square-mouse-pointer" class="size-3.5 shrink-0 text-primary" />
                  <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ selectedBlock.label || selectedBlock.blockId }}</span>
                  <UPopover :content="{ side: 'top', align: 'end' }">
                    <UButton
                      :icon="presetOf(selectedBlock.blockId).icon"
                      :label="presetOf(selectedBlock.blockId).label"
                      size="xs"
                      color="neutral"
                      variant="soft"
                      trailing-icon="i-lucide-chevron-down"
                    />
                    <template #content>
                      <div class="flex w-48 flex-col p-1">
                        <p class="px-2 py-1 text-[10px] uppercase tracking-widest text-muted">Tuck as…</p>
                        <button
                          v-for="r in RECIPES"
                          :key="r.id"
                          type="button"
                          class="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-elevated/60"
                          :class="presetOf(selectedBlock.blockId).id === r.id ? 'text-primary' : ''"
                          @click="setRecipe(selectedBlock!.blockId, r)"
                        >
                          <UIcon :name="r.icon" class="size-4 shrink-0" />
                          {{ r.label }}
                          <UIcon v-if="presetOf(selectedBlock.blockId).id === r.id" name="i-lucide-check" class="ml-auto size-3.5" />
                        </button>
                      </div>
                    </template>
                  </UPopover>
                  <UButton
                    :icon="isCollapsed(selectedBlock.blockId) ? 'i-lucide-eye' : 'i-lucide-eye-off'"
                    :label="isCollapsed(selectedBlock.blockId) ? 'Show' : 'Tuck'"
                    size="xs"
                    :color="isCollapsed(selectedBlock.blockId) ? 'primary' : 'neutral'"
                    :variant="isCollapsed(selectedBlock.blockId) ? 'soft' : 'ghost'"
                    @click="onToggleCollapse(selectedBlock!.blockId)"
                  />
                </div>
                <p v-else class="py-0.5 text-center text-[11px] text-muted">Tap a panel in the layout to edit it</p>
              </div>
            </Transition>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.spike-focus__scrim { animation: scrim-in 0.32s ease both; }
@keyframes scrim-in { from { opacity: 0; } to { opacity: 1; } }

.shell-rise-enter-active { transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease; }
.shell-rise-leave-active { transition: transform 0.25s ease, opacity 0.2s ease; }
.shell-rise-enter-from,
.shell-rise-leave-to { opacity: 0; transform: translateY(28px); }

.opts-enter-active,
.opts-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.opts-enter-from,
.opts-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
