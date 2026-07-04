<script setup lang="ts">
/**
 * CroutonLayoutRenderer — renders a layout *data tree* into resizable, nestable
 * panes using reka-ui's Splitter primitives (Sprint 0 #713 → Sprint 1 #704 →
 * runtime min-width enforcement Sprint 3 #706).
 *
 * - `split` node → a SplitterGroup with one SplitterPanel per child (recursing),
 *   interleaved with resize handles. Nesting = a group inside a panel. In VIEW mode
 *   (`interactive=false`: a served page / Preview) there's nothing to drag, so it
 *   renders plain flex at the stored proportions instead of reka's SplitterGroup —
 *   avoiding reka's internal ResizeObserver churn (the benign "loop completed" flood,
 *   #983) that a read-only view has no reason to pay for. Same proportions, no handles.
 * - `leaf` node  → one block, resolved id → component NAME through the
 *   ALLOWLISTED `croutonLayoutBlocks` registry (#704). An unknown id renders a
 *   safe fallback — NEVER an arbitrary component. Per-block config is sanitized
 *   against the block's declared schema before it reaches props.
 *
 * Min-width enforcement (#710): a horizontal pane refuses to shrink a block
 * below its declared `minWidth` — we measure the live group width and convert
 * each block's px floor to the SplitterPanel's `min-size` (%) via
 * `panelMinSizePct`. Splitter primitives are SSR-safe (no <ClientOnly> needed);
 * the floor falls back to the authored `minSize` until the group has measured.
 */
import { computed, inject, nextTick, ref, watch } from 'vue'
import { useElementSize, unrefElement } from '@vueuse/core'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import { isInPlaceCollapse } from '@fyit/crouton-core/app/types/layout'
import { minWidthResolver, panelMinSizePct, deriveSizing } from '../utils/layout-viability'
import { siblingKeys } from '../utils/layout-flip'
import { useLayoutFlip } from '../composables/useLayoutFlip'
import { isSubtreeCollapsed } from '../utils/layout-responsive'
import { LAYOUT_VARIANTS_KEY, LAYOUT_COLLAPSE_KEY, LAYOUT_CONTAINER_WIDTH_KEY } from '../composables/useCroutonLayoutResponsive'

const props = withDefaults(
  defineProps<{
    node: LayoutNode
    /**
     * Whether the splitter is draggable. `true` (default) is the authoring
     * affordance — the editor / breakpoint-author / compose paths keep their
     * resize handles. `false` is VIEW mode: a served layout renders at its
     * breakpoint-resolved sizes with no draggable dividers (the end user doesn't
     * redefine the layout). Stacking/min-width logic is unaffected either way —
     * this gates only the handles. Threaded through the recursion. (#937)
     */
    interactive?: boolean
  }>(),
  { interactive: true },
)

// Per-block widget variant overrides for the authored breakpoint in view (WS5
// #874), provided by CroutonLayoutResponsiveRenderer. Absent (plain renderer) →
// no overrides. A leaf's variant is merged into its config so the block can read
// `variant` like any other prop.
const variants = inject(LAYOUT_VARIANTS_KEY, ref({} as Record<string, string>))

// In-place collapse context (WS6 #875), provided only when an in-place collapse
// style is active. Absent (the default — plain renderer, editor, gutter-tabs path)
// → every branch below behaves exactly as before.
const collapseCtx = inject(LAYOUT_COLLAPSE_KEY, computed(() => null))
const inPlace = computed(() => {
  const c = collapseCtx.value
  return !!c && isInPlaceCollapse(c.style)
})
// A leaf renders as a collapse handle (instead of its block) when it's collapsed
// in place at the current breakpoint.
const leafCollapsed = computed(() =>
  props.node.type === 'leaf' && inPlace.value && !!collapseCtx.value?.collapsedSet.has(props.node.blockId),
)

const emit = defineEmits<{
  /** Bubbled up on resize so the owner can persist sizes into its tree. */
  layoutChange: [node: LayoutSplit, sizes: number[]]
}>()

const { blocks, resolveComponentName, sanitizeConfig } = useCroutonLayoutBlocks()

// Allowlisted: only ids registered in croutonLayoutBlocks resolve to a component.
const componentName = computed<string | null>(() =>
  props.node.type === 'leaf' ? resolveComponentName(props.node.blockId) : null,
)
const safeConfig = computed<Record<string, unknown>>(() => {
  if (props.node.type !== 'leaf') return {}
  const config = sanitizeConfig(props.node.blockId, props.node.config)
  const variant = variants.value[props.node.blockId]
  // The authored breakpoint's widget variant wins over the stored config.
  return variant ? { ...config, variant } : config
})

// Live width of THIS split's group → converts each child's px min-width floor
// to a percentage min-size for its panel (horizontal splits only).
const groupRef = ref<HTMLElement | null>(null)
const { width: groupWidth, height: groupHeight } = useElementSize(groupRef)
const minWidthFor = computed(() => minWidthResolver(blocks.value))

// The width to reason about min-sizes / stacking with: our own measured group width, or — when
// that reads 0 (a transform-scaled device frame breaks the ResizeObserver) — the known container
// width the responsive renderer resolved at. Without this the px→% min-size math divides by 0 and
// every floor collapses to 0, so panes squish into equal clipped columns instead of stacking.
const injectedWidth = inject(LAYOUT_CONTAINER_WIDTH_KEY, ref(0))
const basisWidth = computed(() => groupWidth.value || injectedWidth.value)

function panelMin(child: LayoutNode): number {
  if (props.node.type !== 'split') return 0
  return panelMinSizePct(props.node.direction, child, basisWidth.value, minWidthFor.value)
}

// Auto-stack to a full-width column (#852 follow-up): a horizontal split whose children
// can't fit side-by-side at their min-widths — the summed min-size exceeds the group —
// stops being columns and stacks vertically (each pane full width). This is the responsive
// reflow the /hide-recipes spike proved (row→column by available width), brought into the
// real renderer so a desktop-composed layout adapts on mobile with NO authored breakpoint.
// The same `panelMinSizePct` machinery decides it, so it triggers exactly when the columns
// would otherwise overflow — layouts that DO fit are byte-for-byte unchanged. Kept off the
// in-place-collapse path (that owns its own splitter reflow).
const stackMinSum = computed(() => {
  if (props.node.type !== 'split' || props.node.direction !== 'horizontal') return 0
  return props.node.children.reduce((sum, child) => sum + panelMin(child), 0)
})
const shouldStack = computed(() =>
  props.node.type === 'split'
  && props.node.direction === 'horizontal'
  && !inPlace.value
  && basisWidth.value > 0
  && stackMinSum.value > 100,
)

function onLayout(sizes: number[]) {
  if (props.node.type === 'split') emit('layoutChange', props.node, sizes)
}

// --- Hug a pane INSIDE a split (#986 UI half) ------------------------------------
// A block declares its own sizing (`sizing: { width, height: 'fill' | 'hug' }`); the
// typed contract derives it (`deriveSizing` — a composite always fills, a leaf uses its
// descriptor). The Preview already hugs at the REGION level; this honours it one level
// deeper — a pane whose resolved sizing ALONG the split axis is `hug` sizes to its content
// (`flex: 0 0 auto`) while the `fill` siblings share the rest. Engages ONLY when a split
// actually contains a hug pane along its axis, so an all-`fill` layout renders through the
// reka SplitterGroup below byte-for-byte unchanged. Off for the in-place-collapse path
// (which owns its own splitter reflow). NB: direct `fill` siblings of a hug pane share
// space without a draggable seam here — compose them as a sub-split to keep an inner
// splitter (that sub-split recurses through the SplitterGroup path).
const hugAlongAxis = computed<boolean[]>(() => {
  if (props.node.type !== 'split') return []
  const horizontal = props.node.direction === 'horizontal'
  return props.node.children.map((child) => {
    const d = deriveSizing(child, blocks.value)
    return (horizontal ? d.width : d.height) === 'hug'
  })
})
const hasHug = computed(() =>
  props.node.type === 'split' && !inPlace.value && !shouldStack.value && hugAlongAxis.value.some(Boolean),
)

// --- FLIP reflow on structural change (#943) ------------------------------------
// When this split's children change (a pane detached, a block inserted), reka-ui rebuilds
// the panes at their final sizes — so the survivors would JUMP into place. useLayoutFlip
// measures each direct pane before the change and tweens it back from its old box, with
// zero change to keys/sizing (purely a one-shot transform). Off for the collapse path,
// which owns its own flex-grow motion. `childKeys` is structure-derived so a survivor is
// matched to its old box across the rebuild.
const childKeys = computed(() => (props.node.type === 'split' ? siblingKeys(props.node.children) : []))
const flipEnabled = computed(() => props.node.type === 'split' && !inPlace.value)
const flipPanels = (): HTMLElement[] => {
  const g = unrefElement(groupRef) as HTMLElement | null
  if (!g) return []
  // reka-ui panes carry `data-panel`; stacked panes (own render path) carry `data-crouton-pane`.
  return Array.from(g.querySelectorAll<HTMLElement>(':scope > [data-panel], :scope > [data-crouton-pane]'))
}
useLayoutFlip({ enabled: flipEnabled, keys: childKeys, panels: flipPanels })

// --- In-place collapse: hand a collapsed child's space back to its siblings ---
// A child panel collapses when ITS WHOLE SUBTREE is collapsed (a half-collapsed
// split keeps its slot). We drive reka-ui's collapsible panels imperatively so the
// non-collapsed siblings reflow into the freed space without remounting the tree.
const panelEls = ref<Array<{ collapse?: () => void, expand?: () => void, isCollapsed?: boolean } | null>>([])
const childCollapsed = computed<boolean[]>(() => {
  const c = collapseCtx.value
  if (props.node.type !== 'split' || !inPlace.value || !c) return []
  return props.node.children.map(child => isSubtreeCollapsed(child, c.collapsedSet))
})
// The thin resting size a collapsed panel shrinks to (handle ≈ 46px → % of the
// group along its split axis), clamped so it never eats the whole group.
const collapsedPct = computed(() => {
  if (props.node.type !== 'split') return 0
  const basis = props.node.direction === 'horizontal' ? groupWidth.value : groupHeight.value
  if (!basis) return 6
  return Math.min(40, Math.max(2, (46 / basis) * 100))
})

// WS6 #875 follow-up: the PANE's own collapse/expand animates, not just the handle.
// reka-ui sizes a panel via inline `flex-grow`; the per-style transition class on the
// panel (present whenever an in-place style is active — see the template) tweens the
// shrink in BOTH directions, and siblings reflow into the freed space as their grow
// rebalances. We still drive reka-ui's collapsible panels imperatively so a fully
// -collapsed subtree hands its slot back to its siblings.
watch(
  () => childCollapsed.value.join(','),
  () => {
    if (props.node.type !== 'split' || !inPlace.value) return
    nextTick(() => {
      childCollapsed.value.forEach((want, i) => {
        const p = panelEls.value[i]
        if (!p) return
        const is = Boolean(p.isCollapsed)
        if (want && !is) p.collapse?.()
        else if (!want && is) p.expand?.()
      })
    })
  },
  { flush: 'post', immediate: true },
)
</script>

<template>
  <!-- Leaf — its wrapper is a CSS container (intrinsic responsiveness, WS5 #874):
       the block reflows to ITS OWN pane width via `@container`, independent of the
       viewport. Every pane is its own container, so this composes recursively. -->
  <div
    v-if="node.type === 'leaf'"
    class="croutonpane h-full w-full"
  >
    <!-- Collapsed in place (WS6 #875): the block becomes its style's resting handle,
         in its own pane slot, click-to-expand. -->
    <CroutonLayoutCollapseHandle
      v-if="leafCollapsed && collapseCtx"
      :key="collapseCtx.style"
      :collapse-style="collapseCtx.style"
      :block-id="node.blockId"
      @expand="collapseCtx.expand(node.blockId)"
    />
    <component
      :is="componentName"
      v-else-if="componentName"
      v-bind="safeConfig"
      class="h-full w-full overflow-auto"
    />
    <div
      v-else
      class="h-full w-full flex items-center justify-center p-4 text-sm text-error text-center"
    >
      Unknown block:&nbsp;<code>{{ node.blockId }}</code>
    </div>
  </div>

  <!-- Nested sub-layout (an app that is itself a layout, WS2 #871) → recurse.
       Also a container so the sub-layout reflows to its own pane (intrinsic, WS5).
       Read-only here; persisting a nested resize is part of nested authoring (WS4). -->
  <div
    v-else-if="node.type === 'nested'"
    class="croutonpane h-full w-full"
  >
    <CroutonLayoutRenderer
      :node="node.layout.root"
      :interactive="interactive"
    />
  </div>

  <!-- Split, STACKED — too narrow to fit side-by-side, so the columns reflow to a
       full-width vertical stack (responsive reflow, #852 follow-up). `groupRef` stays on
       it so the live width keeps measuring: widen past the fit threshold and it flips
       back to the SplitterGroup below. No resize handles (you don't drag stacked panes). -->
  <div
    v-else-if="node.type === 'split' && shouldStack"
    ref="groupRef"
    class="flex h-full w-full flex-col gap-px overflow-y-auto"
  >
    <div
      v-for="(child, i) in node.children"
      :key="i"
      data-crouton-pane
      class="croutonpane min-h-72 w-full shrink-0"
    >
      <CroutonLayoutRenderer
        :node="child"
        :interactive="interactive"
        @layout-change="(n: LayoutSplit, s: number[]) => emit('layoutChange', n, s)"
      />
    </div>
  </div>

  <!-- Split with a HUG pane (#986 UI half) — a pane whose declared sizing along the
       split axis is `hug` sizes to its content (`flex:0 0 auto`); `fill` siblings share
       the rest. A plain flex layout (no reka splitter — you don't drag against a content
       -sized bar). `groupRef` stays on it so width keeps measuring. -->
  <div
    v-else-if="node.type === 'split' && hasHug"
    ref="groupRef"
    class="flex h-full w-full gap-px"
    :class="node.direction === 'horizontal' ? 'flex-row overflow-x-auto' : 'flex-col overflow-y-auto'"
  >
    <div
      v-for="(child, i) in node.children"
      :key="i"
      data-crouton-pane
      class="croutonpane min-h-0 min-w-0"
      :style="hugAlongAxis[i] ? 'flex:0 0 auto' : 'flex:1 1 0'"
    >
      <CroutonLayoutRenderer
        :node="child"
        :interactive="interactive"
        @layout-change="(n: LayoutSplit, s: number[]) => emit('layoutChange', n, s)"
      />
    </div>
  </div>

  <!-- Split, VIEW mode (#983) — a read-only render (`interactive=false`: a served page /
       Preview) has nothing to drag, so it doesn't need reka-ui's SplitterGroup at all — and
       reka's internal ResizeObserver is what floods the console with the benign "loop
       completed with undelivered notifications" as its panes settle. Render plain flex at the
       stored proportions instead: `flex-grow: <defaultSize>` over a 0 basis distributes each
       pane its authored share (sizes sum to 100), matching reka's proportional layout with
       zero observer churn. `groupRef` stays for the stack/min-width measuring (its useElementSize
       callback only sets refs — it never resizes synchronously, so it doesn't trip the warning).
       Excludes the in-place-collapse path, which still needs reka's collapsible panels. -->
  <div
    v-else-if="node.type === 'split' && !interactive && !inPlace"
    ref="groupRef"
    class="flex h-full w-full"
    :class="node.direction === 'horizontal' ? 'flex-row' : 'flex-col'"
  >
    <div
      v-for="(child, i) in node.children"
      :key="i"
      data-crouton-pane
      class="croutonpane min-h-0 min-w-0 overflow-hidden"
      :style="{ flex: `${child.defaultSize ?? (100 / node.children.length)} 1 0` }"
    >
      <CroutonLayoutRenderer
        :node="child"
        :interactive="false"
        @layout-change="(n: LayoutSplit, s: number[]) => emit('layoutChange', n, s)"
      />
    </div>
  </div>

  <!-- Split -->
  <SplitterGroup
    v-else-if="node.type === 'split'"
    ref="groupRef"
    :direction="node.direction"
    class="h-full w-full"
    @layout="onLayout"
  >
    <template
      v-for="(child, i) in node.children"
      :key="i"
    >
      <SplitterResizeHandle
        v-if="i > 0 && interactive"
        class="bg-border hover:bg-primary transition-colors data-[orientation=horizontal]:w-px data-[orientation=vertical]:h-px"
      />
      <SplitterPanel
        :ref="(el: any) => { panelEls[i] = el }"
        :default-size="inPlace && childCollapsed[i] ? collapsedPct : (child.defaultSize ?? (100 / node.children.length))"
        :min-size="inPlace && childCollapsed[i] ? collapsedPct : panelMin(child)"
        :collapsible="inPlace || undefined"
        :collapsed-size="inPlace ? collapsedPct : undefined"
        class="overflow-hidden"
        :class="inPlace && collapseCtx ? `mq-co-${collapseCtx.style}` : ''"
      >
        <CroutonLayoutRenderer
          :node="child"
          :interactive="interactive"
          @layout-change="(n: LayoutSplit, s: number[]) => emit('layoutChange', n, s)"
        />
      </SplitterPanel>
    </template>
  </SplitterGroup>
</template>

<style scoped>
/* Intrinsic responsiveness (WS5 #874): each pane is a query container, so a
   block sizes to its own pane width (`@container (min-width: …)`) rather than the
   viewport. `inline-size` constrains only the inline axis — height still flows,
   so `h-full` panes are unaffected. Recursive: every nested pane re-establishes
   its own container, so reflow holds at any depth. */
.croutonpane {
  container-type: inline-size;
  container-name: pane;
}

/* WS6 #875 follow-up — the pane's own collapse/expand motion, one curve per style
   (armed only while `animating`, so interactive divider drags stay snappy). reka-ui
   drives the panel via inline `flex-grow`; transitioning it tweens the shrink and the
   siblings reflowing into the freed space. The collapse *handle* adds its signature
   in-pane motion on top — together the four styles read distinctly. */
.mq-co-spring-drawer  { transition: flex-grow .52s cubic-bezier(.34, 1.56, .64, 1); }   /* overshoot — springs shut */
.mq-co-crt-power-down { transition: flex-grow .30s cubic-bezier(.85, 0, .97, .27); }     /* snappy — powers off */
.mq-co-iris-portal    { transition: flex-grow .46s cubic-bezier(.65, 0, .35, 1); }       /* smooth iris */
@media (prefers-reduced-motion: reduce) {
  .mq-co-spring-drawer, .mq-co-crt-power-down, .mq-co-iris-portal { transition: none; }
}
</style>
