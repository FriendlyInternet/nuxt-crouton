<script setup lang="ts">
/**
 * Spike (#907) — the two layers of "responsive layout", kept honest by NOT conflating them:
 *
 *   1. ARRANGEMENT / REFLOW  → pure CSS. The visible panes sit in a flex row that a
 *      `@container` query flips to a column when the FRAME gets narrow. No JS measuring,
 *      no layout pass — `flex-wrap`/`flex-direction` is exactly what CSS already does, so
 *      we don't reimplement grid. Drag the width / pick a device and watch row↔column.
 *
 *   2. COLLAPSE / HIDE  → ours. "This pane shouldn't stack-and-push, it should tuck behind
 *      a tab you tap" is something CSS has no rule for — so this is the only part worth
 *      owning. Each pane declares an EDGE (left/top/right/bottom) + an AFFORDANCE
 *      (tab / button / dot); a small opinionated set that graduates into a
 *      `croutonCollapseStyles` registry in @fyit/crouton-layout (extensible).
 *
 * The two are orthogonal: reflow rearranges what's visible, collapse decides what's visible.
 */
import { ref, computed } from 'vue'
import { createReusableTemplate, useElementSize } from '@vueuse/core'

useHead({ title: 'Spike · hide recipes' })

type Edge = 'left' | 'top' | 'right' | 'bottom'
type Affordance = 'tab' | 'button' | 'dot'
interface Recipe { id: string, label: string, icon: string, edge: Edge, affordance: Affordance }

// The opinionated collapse set (what a layout package would ship + let you extend).
const RECIPES: Recipe[] = [
  { id: 'tab-left', label: 'Tab · left', icon: 'i-lucide-panel-left', edge: 'left', affordance: 'tab' },
  { id: 'tab-top', label: 'Tab · top', icon: 'i-lucide-panel-top', edge: 'top', affordance: 'tab' },
  { id: 'button-top', label: 'Button · top', icon: 'i-lucide-rectangle-horizontal', edge: 'top', affordance: 'button' },
  { id: 'dot-right', label: 'Dot · right', icon: 'i-lucide-circle-dot', edge: 'right', affordance: 'dot' },
  { id: 'tab-bottom', label: 'Tab · bottom', icon: 'i-lucide-panel-bottom', edge: 'bottom', affordance: 'tab' },
]
const recipeOf = (id: string) => RECIPES.find(r => r.id === id) ?? RECIPES[0]!

interface Pane { id: string, label: string, icon: string, accent: string, recipe: string, hidden: boolean }
const panes = ref<Pane[]>([
  { id: 'list', label: 'Artists', icon: 'i-lucide-list', accent: 'text-primary', recipe: 'tab-left', hidden: false },
  { id: 'detail', label: 'New artist', icon: 'i-lucide-square-pen', accent: 'text-info', recipe: 'button-top', hidden: false },
  { id: 'stats', label: 'Stats', icon: 'i-lucide-bar-chart-3', accent: 'text-success', recipe: 'dot-right', hidden: false },
])

// --- Reflow layer (CSS) -----------------------------------------------------
// The frame is laid out at `simWidth` px and scaled to fit the stage, so the @container
// query inside sees the *simulated* width even on a phone (same trick as the focus shell).
const MIN = 320
const MAX = 960
const simWidth = ref(390)
const DEVICES = [
  { id: 'phone', label: 'Phone', icon: 'i-lucide-smartphone', w: 390 },
  { id: 'tablet', label: 'Tablet', icon: 'i-lucide-tablet-smartphone', w: 700 },
  { id: 'desktop', label: 'Desktop', icon: 'i-lucide-monitor', w: 940 },
]
// Must match the `@min-[36rem]` container-query threshold in the template (36rem = 576px).
const ROW_THRESHOLD = 576
const isRow = computed(() => simWidth.value >= ROW_THRESHOLD)

const stage = ref<HTMLElement | null>(null)
const { width: stageW, height: stageH } = useElementSize(stage)
const displayW = computed(() => Math.min(simWidth.value, Math.max(stageW.value || simWidth.value, 280)))
const scale = computed(() => (simWidth.value ? displayW.value / simWidth.value : 1))
const frameH = computed(() => (stageH.value && scale.value ? stageH.value / scale.value : 640))
const wrapperStyle = computed(() => ({ width: `${displayW.value}px`, height: stageH.value ? `${stageH.value}px` : '640px' }))
const innerStyle = computed(() => ({
  width: `${simWidth.value}px`,
  height: `${frameH.value}px`,
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left',
}))

// --- Collapse layer (ours) --------------------------------------------------
const visible = computed(() => panes.value.filter(p => !p.hidden))
const hiddenPanes = computed(() => panes.value.filter(p => p.hidden))
function edgePanes(edge: Edge) { return hiddenPanes.value.filter(p => recipeOf(p.recipe).edge === edge) }
function hasEdge(edge: Edge) { return edgePanes(edge).length > 0 }
function hide(p: Pane) { p.hidden = true }
function show(p: Pane) { p.hidden = false }
function setRecipe(p: Pane, id: string) { p.recipe = id }

// The visible area insets away from any edge that currently holds tucked panes.
const centerStyle = computed(() => ({
  paddingLeft: hasEdge('left') ? '3.5rem' : '0px',
  paddingRight: hasEdge('right') ? '3.5rem' : '0px',
  paddingTop: hasEdge('top') ? '3rem' : '0px',
  paddingBottom: hasEdge('bottom') ? '3rem' : '0px',
}))

// One chip definition, reused in all four edge gutters.
const [DefineChip, ReuseChip] = createReusableTemplate<{ pane: Pane }>()
</script>

<template>
  <div class="flex h-dvh flex-col bg-default text-default">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-default px-4 py-3">
      <UIcon name="i-lucide-layout-template" class="size-4 text-primary" />
      <h1 class="text-sm font-semibold">Hide recipes</h1>
      <p class="hidden text-xs text-muted md:block">Arrangement reflows in CSS; collapse is the recipe layer on top.</p>
      <NuxtLink to="/spike-app" class="ml-auto rounded-full border border-default px-2.5 py-1 text-xs text-muted transition-colors hover:text-default">← Spike</NuxtLink>
    </header>

    <!-- the two-layer legend: names what's CSS vs what's ours -->
    <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-default/60 bg-elevated/30 px-4 py-2 text-[11px]">
      <span class="flex items-center gap-1.5">
        <span class="inline-block size-2 rounded-full bg-primary" />
        <strong class="font-semibold">Arrangement</strong>
        <span class="text-muted">CSS <code class="rounded bg-elevated px-1">@container</code> · {{ isRow ? 'row' : 'column' }}</span>
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block size-2 rounded-full bg-info" />
        <strong class="font-semibold">Collapse</strong>
        <span class="text-muted">hide-recipe · {{ hiddenPanes.length }} tucked</span>
      </span>
    </div>

    <!-- controls: device + width slider drive the FRAME width → the @container reflow -->
    <div class="flex flex-wrap items-center justify-center gap-3 px-4 py-3">
      <div class="flex items-center gap-1 rounded-full border border-default bg-elevated/40 p-1">
        <UButton
          v-for="d in DEVICES"
          :key="d.id"
          size="xs"
          :color="simWidth === d.w ? 'primary' : 'neutral'"
          :variant="simWidth === d.w ? 'soft' : 'ghost'"
          :icon="d.icon"
          :label="d.label"
          class="rounded-full"
          @click="simWidth = d.w"
        />
      </div>
      <div class="flex min-w-48 flex-1 items-center gap-2">
        <UIcon name="i-lucide-move-horizontal" class="size-4 shrink-0 text-muted" />
        <USlider v-model="simWidth" :min="MIN" :max="MAX" :step="2" class="flex-1" />
        <span class="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-muted">{{ simWidth }}px</span>
      </div>
    </div>

    <!-- One chip (the tucked-away affordance): a tab / button / dot, click to restore. -->
    <DefineChip v-slot="{ pane }">
      <button
        type="button"
        class="spike-chip pointer-events-auto flex items-center gap-1.5 text-xs font-medium shadow-md backdrop-blur transition-transform active:scale-95"
        :class="{
          'rounded-lg border border-default bg-elevated/95 px-2.5 py-1.5': recipeOf(pane.recipe).affordance === 'tab',
          'rounded-full border border-primary/40 bg-primary/15 px-3 py-1.5 text-primary': recipeOf(pane.recipe).affordance === 'button',
          'size-9 justify-center rounded-full border border-default bg-elevated/95 p-0': recipeOf(pane.recipe).affordance === 'dot',
        }"
        :title="`Show ${pane.label}`"
        @click="show(pane)"
      >
        <UIcon :name="pane.icon" :class="['size-4 shrink-0', pane.accent]" />
        <span v-if="recipeOf(pane.recipe).affordance !== 'dot'" class="truncate">{{ pane.label }}</span>
      </button>
    </DefineChip>

    <div ref="stage" class="grid min-h-0 flex-1 place-items-center overflow-hidden p-4">
      <!-- wrapper sized to the on-screen footprint; inner is laid out at simWidth and scaled -->
      <div class="relative" :style="wrapperStyle">
        <div
          class="@container absolute left-0 top-0 overflow-hidden rounded-[2rem] border border-default bg-elevated/20 shadow-xl ring-1 ring-default/10"
          :style="innerStyle"
        >
          <!-- edge gutters — tucked panes live here (collapse layer) -->
          <div class="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center gap-2 p-2">
            <ReuseChip v-for="p in edgePanes('top')" :key="p.id" :pane="p" />
          </div>
          <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center gap-2 p-2">
            <ReuseChip v-for="p in edgePanes('bottom')" :key="p.id" :pane="p" />
          </div>
          <div class="pointer-events-none absolute inset-y-0 left-0 z-10 flex flex-col justify-center gap-2 p-2">
            <ReuseChip v-for="p in edgePanes('left')" :key="p.id" :pane="p" />
          </div>
          <div class="pointer-events-none absolute inset-y-0 right-0 z-10 flex flex-col justify-center gap-2 p-2">
            <ReuseChip v-for="p in edgePanes('right')" :key="p.id" :pane="p" />
          </div>

          <!-- center: the visible panes.
               REFLOW IS PURE CSS → `flex-col` by default, `@min-[36rem]:flex-row` once the
               FRAME (the @container above) is wide enough. No JS decides row-vs-column. -->
          <div class="absolute inset-0 transition-all duration-300 ease-out" :style="centerStyle">
            <TransitionGroup name="pane" tag="div" class="flex h-full w-full flex-col gap-2 p-2 @min-[36rem]:flex-row">
              <div
                v-for="p in visible"
                :key="p.id"
                class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-default bg-default p-3 shadow-sm"
              >
                <div class="flex items-center gap-2">
                  <UIcon :name="p.icon" :class="['size-4 shrink-0', p.accent]" />
                  <span class="truncate text-sm font-medium">{{ p.label }}</span>
                  <div class="ml-auto flex items-center gap-1">
                    <UPopover :content="{ side: 'bottom', align: 'end' }">
                      <UButton
                        size="xs"
                        color="neutral"
                        variant="soft"
                        :icon="recipeOf(p.recipe).icon"
                        :label="recipeOf(p.recipe).label"
                        trailing-icon="i-lucide-chevron-down"
                      />
                      <template #content>
                        <div class="flex w-48 flex-col p-1">
                          <p class="px-2 py-1 text-[10px] uppercase tracking-widest text-muted">Hide as…</p>
                          <button
                            v-for="r in RECIPES"
                            :key="r.id"
                            type="button"
                            class="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-elevated/60"
                            :class="p.recipe === r.id ? 'text-primary' : ''"
                            @click="setRecipe(p, r.id)"
                          >
                            <UIcon :name="r.icon" class="size-4 shrink-0" />
                            {{ r.label }}
                            <UIcon v-if="p.recipe === r.id" name="i-lucide-check" class="ml-auto size-3.5" />
                          </button>
                        </div>
                      </template>
                    </UPopover>
                    <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-eye-off" aria-label="Hide" @click="hide(p)" />
                  </div>
                </div>
                <!-- placeholder content so the pane feels real -->
                <div class="mt-2 grid flex-1 place-items-center rounded-xl bg-elevated/30">
                  <div class="flex flex-col items-center gap-1 text-muted">
                    <UIcon :name="p.icon" :class="['size-7', p.accent]" />
                    <span class="text-xs">{{ p.label }} content</span>
                  </div>
                </div>
              </div>
            </TransitionGroup>

            <!-- everything tucked away -->
            <div v-if="!visible.length" class="grid h-full place-items-center text-center text-xs text-muted">
              All panes hidden — tap a tab / button / dot on an edge to bring one back.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* panes reflow as one hides/returns; the chip pops in */
.pane-enter-active,
.pane-leave-active { transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1); }
.pane-enter-from,
.pane-leave-to { opacity: 0; transform: scale(0.96); }
.pane-leave-active { position: absolute; }

.spike-chip { animation: chip-in 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
@keyframes chip-in { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
</style>
