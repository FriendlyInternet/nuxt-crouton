<script setup lang="ts">
/**
 * CroutonLayoutRenderer — renders a layout *data tree* into resizable, nestable
 * panes using Nuxt UI's `USplitter` (Sprint 0 #713 → Sprint 1 #704 →
 * runtime min-width enforcement Sprint 3 #706 → USplitter #3708).
 *
 * - `split` node → a `USplitter` whose items come from `rendererSplitterItems`
 *   (one pane per child, recursing), with a resize handle between panes. Nesting =
 *   a splitter inside a pane. Handles are hidden + disabled when `!interactive`;
 *   in-place collapse runs through each pane slot's `collapse` / `expand` props
 *   (decided by `collapseAction`). In VIEW mode (`interactive=false`: a served page /
 *   Preview) without in-place collapse there's nothing to drag, so it renders plain
 *   flex at the stored proportions instead of the splitter — avoiding the splitter's
 *   internal ResizeObserver churn (the benign "loop completed" flood, #983) that a
 *   read-only view has no reason to pay for. Same proportions, no handles.
 * - `leaf` node  → one block, resolved id → component NAME through the
 *   ALLOWLISTED `croutonLayoutBlocks` registry (#704). An unknown id renders a
 *   safe fallback — NEVER an arbitrary component. Per-block config is sanitized
 *   against the block's declared schema before it reaches props.
 *
 * Min-width enforcement (#710): a horizontal pane refuses to shrink a block
 * below its declared `minWidth` — we measure the live group width and convert
 * each block's px floor to the splitter item's `minSize` (%) via
 * `panelMinSizePct`. Splitter primitives are SSR-safe (no <ClientOnly> needed);
 * the floor falls back to the authored `minSize` until the group has measured.
 */
import {
  computed,
  defineComponent,
  inject,
  nextTick,
  onMounted,
  provide,
  ref,
  watch,
  type ComponentPublicInstance,
  type CSSProperties,
  type PropType,
  type Ref,
} from 'vue'
import { useElementSize, unrefElement } from '@vueuse/core'
import { rendererSplitterItems, rendererHandleClass, collapseAction } from '../utils/layout-splitter-items'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import { isInPlaceCollapse } from '@fyit/crouton-core/app/types/layout'
import { minWidthResolver, panelMinSizePct, deriveSizing, pageRowTracks } from '../utils/layout-viability'
import { siblingKeys } from '../utils/layout-flip'
import { useLayoutFlip } from '../composables/useLayoutFlip'
import { isSubtreeCollapsed } from '../utils/layout-responsive'
import { LAYOUT_VARIANTS_KEY, LAYOUT_COLLAPSE_KEY, LAYOUT_CONTAINER_WIDTH_KEY } from '../composables/useCroutonLayoutResponsive'
import { LAYOUT_RENDER_CONTEXT_KEY, type LayoutRenderContext } from '../composables/useCroutonLayoutRenderContext'

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

// Render context (#983): a read-only render (`interactive=false` — a served page
// or the builder board's live preview) is a PAGE; the authoring render is ADMIN.
// A data-bound leaf (a collection list) injects this to pick a content-sized page
// render vs the fill-and-scroll admin render. Threaded consistently through the
// recursion, so providing it per-instance off THIS node's `interactive` is exact.
provide<Ref<LayoutRenderContext>>(
  LAYOUT_RENDER_CONTEXT_KEY,
  computed(() => (props.interactive ? 'admin' : 'page')),
)

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
// Measured on ONE wrapper `<div>` (`measureRef`) around the stacked / hug / USplitter branches,
// so switching between them never changes the measured element. (VueUse resets the width to 0
// when its target changes, which made a phone stack ↔ splitter loop forever, #3753/#3771.)
// `groupRef` is a plain ref on the ACTIVE branch (stacked / hug `<div>` or the USplitter
// instance — `unrefElement` resolves a component to its root), used only by FLIP.
const measureRef = ref<HTMLElement | null>(null)
const groupRef = ref<HTMLElement | ComponentPublicInstance | null>(null)
// A plain ref on the VIEW-mode grid wrapper so FLIP can find its `[data-crouton-pane]` children
// (#1178 view path). Deliberately NOT `groupRef` — it must never reach `useElementSize` (no RO).
const viewGridRef = ref<HTMLElement | null>(null)
const { width: groupWidth, height: groupHeight } = useElementSize(measureRef)
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
// USplitter below byte-for-byte unchanged. Off for the in-place-collapse path
// (which owns its own splitter reflow). NB: direct `fill` siblings of a hug pane share
// space without a draggable seam here — compose them as a sub-split to keep an inner
// splitter (that sub-split recurses through the USplitter path).
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

// --- VIEW-mode layout (#1178, #2567) ----------------------------------------------
// A read-only (`!interactive`) split is laid out from the declared sizing contract
// alone — proportions, floors, hug — with no ResizeObserver and no generated CSS.
//
// HORIZONTAL: a wrapping flex row that switches to a stack at the split's own soft
// floor (the sum of its children's floors). Each fill child's basis is
// `(var(--stack-at) - 100%) * 999`: hugely negative above the threshold (→ 0, so the
// children share the row by flex-grow = their proportions) and hugely positive below
// it (each child takes a full row → all stack at once). The threshold is an inline
// CSS variable, so the server and the browser render the same thing. (It replaced a
// per-split `<style>` container query whose text the server HTML-escaped: a phone saw
// the wrong arrangement until hydration, plus a mismatch on every load — #2567.)
// `100%` is the split's own width, so a split inside a narrow pane stacks too.
//
// VERTICAL: a grid whose rows FLOW to content (`auto`, floored at min-height): a page
// render scrolls as one document instead of carving the frame into `fr` slabs (#983).
const childSizings = computed(() =>
  props.node.type === 'split' ? props.node.children.map(c => deriveSizing(c, blocks.value)) : [],
)
const viewHorizontal = computed(() => props.node.type === 'split' && props.node.direction === 'horizontal')
const viewStackThreshold = computed(() =>
  viewHorizontal.value ? Math.round(deriveSizing(props.node, blocks.value).softMinWidth) : 0,
)
const viewGridStyle = computed<CSSProperties>(() => {
  // `minHeight:100%` (not a fixed `height`) so a short page still fills its frame
  // but a tall one grows past it and the frame scrolls as one — no nested scrollbars. (#983)
  const base: CSSProperties = { gap: '1px', minHeight: '100%', width: '100%' }
  if (props.node.type !== 'split') return { ...base, display: 'grid' }
  if (viewHorizontal.value) {
    // Top-aligned (#3865, owner rule): the row is as tall as its tallest pane; a shorter pane
    // keeps its own height at the top instead of stretching. `alignContent` keeps wrapped
    // (stacked) lines packed at the top inside a fixed-height box (crouton-pages PaneBlock).
    return { ...base, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', alignContent: 'flex-start', '--stack-at': `${viewStackThreshold.value}px` }
  }
  return { ...base, display: 'grid', gridTemplateRows: pageRowTracks(props.node.children, blocks.value) }
})
function viewChildStyle(i: number): CSSProperties {
  if (props.node.type !== 'split' || !viewHorizontal.value) return {}
  // No longer stretched (#3865), so floor each pane at its block's minimum height — the
  // same floor the vertical grid uses.
  const minHeight = `${Math.round(childSizings.value[i]!.minHeight)}px`
  // A hug pane keeps its content width (no block declares width-hug today).
  if (hugAlongAxis.value[i]) return { flex: '0 0 auto', minHeight }
  const child = props.node.children[i]!
  const size = child.defaultSize ?? (100 / props.node.children.length)
  const floor = Math.round(childSizings.value[i]!.hardMinWidth)
  return {
    flexGrow: String(size),
    flexShrink: '1',
    flexBasis: 'calc((var(--stack-at) - 100%) * 999)',
    minWidth: `min(${floor}px, 100%)`,
    minHeight,
  }
}

// --- FLIP reflow on structural change (#943) ------------------------------------
// When this split's children change (a pane detached, a block inserted), the splitter rebuilds
// the panes at their final sizes — so the survivors would JUMP into place. useLayoutFlip
// measures each direct pane before the change and tweens it back from its old box, with
// zero change to keys/sizing (purely a one-shot transform). Off for the collapse path,
// which owns its own flex-grow motion. `childKeys` is structure-derived so a survivor is
// matched to its old box across the rebuild.
const childKeys = computed(() => (props.node.type === 'split' ? siblingKeys(props.node.children) : []))
const flipEnabled = computed(() => props.node.type === 'split' && !inPlace.value)
const flipPanels = (): HTMLElement[] => {
  // The USplitter path attaches `groupRef`; the observer-free VIEW-mode grid path (#1178) does NOT
  // (binding `groupRef` there would re-arm the ResizeObserver #1178 removed) — so fall back to
  // `viewGridRef`, a plain element ref NOT fed to `useElementSize`, so FLIP also eases the view
  // panes apart on a structural change. useLayoutFlip measures via getBoundingClientRect (no RO),
  // so covering the view path adds no observer.
  const g = (unrefElement(groupRef) ?? unrefElement(viewGridRef)) as HTMLElement | null
  if (!g) return []
  // USplitter panes (reka SplitterPanels underneath) carry `data-panel`; stacked panes (own render path) carry `data-crouton-pane`.
  return Array.from(g.querySelectorAll<HTMLElement>(':scope > [data-panel], :scope > [data-crouton-pane]'))
}
useLayoutFlip({ enabled: flipEnabled, keys: childKeys, panels: flipPanels })

// --- In-place collapse: hand a collapsed child's space back to its siblings ---
// A child panel collapses when ITS WHOLE SUBTREE is collapsed (a half-collapsed
// split keeps its slot). We drive the splitter's collapsible panels through each pane
// slot's `collapse` / `expand` (see `PaneCollapseSync`) so the non-collapsed siblings
// reflow into the freed space without remounting the tree.
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
// USplitter's panels are sized by inline `flex-grow`; the per-style transition class on
// the panel (set via the item's `class` whenever an in-place style is active) tweens the
// shrink in BOTH directions, and siblings reflow into the freed space as their grow
// rebalances. A renderless `PaneCollapseSync` inside each pane slot drives that panel's
// `collapse()` / `expand()` so a fully-collapsed subtree hands its slot back to its siblings.
const PaneCollapseSync = defineComponent({
  name: 'PaneCollapseSync',
  props: {
    want: { type: Boolean, default: undefined },
    collapsed: { type: Boolean, required: true },
    collapse: { type: Function as PropType<() => void>, required: true },
    expand: { type: Function as PropType<() => void>, required: true },
  },
  setup(p) {
    const sync = () => {
      const a = collapseAction(p.want, p.collapsed)
      if (a === 'collapse') p.collapse()
      else if (a === 'expand') p.expand()
    }
    // The panel registers with its group in ITS onMounted, which runs after this child's → defer.
    onMounted(() => nextTick(sync))
    // Only a change in the WANTED state syncs. `collapsed` is read inside `sync`, never watched —
    // so a pane the user drags shut in interactive mode is left alone.
    watch(() => p.want, sync, { flush: 'post' })
    return () => null
  },
})
</script>

<template>
  <!-- Leaf — its wrapper is a CSS container (intrinsic responsiveness, WS5 #874):
       the block reflows to ITS OWN pane width via `@container`, independent of the
       viewport. Every pane is its own container, so this composes recursively. -->
  <div
    v-if="node.type === 'leaf'"
    class="croutonpane w-full"
    :class="interactive ? 'h-full' : ''"
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
    <!-- Admin (`interactive`): fill the pane + scroll internally. Page
         (`!interactive`, #983): content-height, no internal scrollbar — the block
         sizes to its content so the page flows and the frame scrolls as one. -->
    <component
      :is="componentName"
      v-else-if="componentName"
      v-bind="safeConfig"
      :class="interactive ? 'h-full w-full overflow-auto' : 'w-full'"
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
    class="croutonpane w-full"
    :class="interactive ? 'h-full' : ''"
  >
    <CroutonLayoutRenderer
      :node="node.layout.root"
      :interactive="interactive"
    />
  </div>

  <!-- Ordered FIRST among the split branches: a page render must never fall into the
       admin STACKED / HUG flex layouts below — those fill a frame (`h-full`, `flex:1 1 0`),
       and on a frameless page WebKit sizes a `flex:1 1 0` column item to its basis, ZERO
       (a form vanished on iOS, #2490), where Chromium sizes it to content. -->
  <!-- Split, VIEW mode (#1178, #2567) — a read-only render (`interactive=false`: a served
       page / Preview) has nothing to drag, so it is laid out from the declared sizing contract
       with ZERO ResizeObserver and NO generated CSS (see `viewGridStyle` / `viewChildStyle`):
       a horizontal split is a wrapping flex row that stacks at its soft floor via the inline
       `--stack-at` variable; a vertical split is a content-flow grid. No USplitter
       (its observer flooded the console). Excludes in-place-collapse (still USplitter). -->
  <div
    v-else-if="node.type === 'split' && !interactive && !inPlace"
    ref="viewGridRef"
    class="croutonviewgrid"
    :style="viewGridStyle"
  >
    <div
      v-for="(child, i) in node.children"
      :key="i"
      data-crouton-pane
      class="croutonpane min-h-0 min-w-0 overflow-hidden"
      :style="viewChildStyle(i)"
    >
      <CroutonLayoutRenderer
        :node="child"
        :interactive="false"
        @layout-change="(n: LayoutSplit, s: number[]) => emit('layoutChange', n, s)"
      />
    </div>
  </div>

  <!-- Split, MEASURED wrapper (#3771) — the stacked / hug / USplitter branches all sit inside
       this one `<div>`, which is what `useElementSize` measures (`measureRef`). Switching
       between the branches never changes the measured element, so the width never resets to
       0 mid-switch (that reset made a phone stack ↔ splitter loop forever, #3753). -->
  <div
    v-else-if="node.type === 'split'"
    ref="measureRef"
    class="h-full w-full"
  >
    <!-- Split, STACKED — too narrow to fit side-by-side, so the columns reflow to a
         full-width vertical stack (responsive reflow, #852 follow-up). The wrapper keeps
         measuring: widen past the fit threshold and it flips back to the USplitter below.
         No resize handles (you don't drag stacked panes). -->
    <div
      v-if="shouldStack"
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
         the rest. A plain flex layout (no splitter — you don't drag against a content
         -sized bar). The wrapper keeps measuring the width. -->
    <div
      v-else-if="hasHug"
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

    <!-- Split — USplitter (interactive, and view-only in-place collapse). Handles are
         hidden + disabled when `!interactive`. -->
    <USplitter
      v-else
      ref="groupRef"
      :orientation="node.direction"
      :items="rendererSplitterItems(node, panelMin, inPlace && collapseCtx ? { collapsed: childCollapsed, pct: collapsedPct, style: collapseCtx.style } : null)"
      :disabled="!interactive"
      class="h-full w-full"
      :ui="{ handle: rendererHandleClass(node.direction, interactive) }"
      @layout="onLayout"
    >
      <template #pane="{ index, collapsed, collapse, expand }">
        <PaneCollapseSync
          v-if="inPlace"
          :want="childCollapsed[index]"
          :collapsed="collapsed"
          :collapse="collapse"
          :expand="expand"
        />
        <CroutonLayoutRenderer
          :node="node.children[index]!"
          :interactive="interactive"
          @layout-change="(n: LayoutSplit, s: number[]) => emit('layoutChange', n, s)"
        />
      </template>
    </USplitter>
  </div>
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
   (armed only while `animating`, so interactive divider drags stay snappy). USplitter
   sizes the panel via inline `flex-grow`; transitioning it tweens the shrink and the
   siblings reflowing into the freed space. The collapse *handle* adds its signature
   in-pane motion on top — together the four styles read distinctly.
   `:deep()` because the panels render inside USplitter's template, so they don't carry
   this component's scope attribute (USplitter's root does). */
:deep(.mq-co-spring-drawer)  { transition: flex-grow .52s cubic-bezier(.34, 1.56, .64, 1); }   /* overshoot — springs shut */
:deep(.mq-co-crt-power-down) { transition: flex-grow .30s cubic-bezier(.85, 0, .97, .27); }     /* snappy — powers off */
:deep(.mq-co-iris-portal)    { transition: flex-grow .46s cubic-bezier(.65, 0, .35, 1); }       /* smooth iris */
@media (prefers-reduced-motion: reduce) {
  :deep(.mq-co-spring-drawer), :deep(.mq-co-crt-power-down), :deep(.mq-co-iris-portal) { transition: none; }
}
</style>
