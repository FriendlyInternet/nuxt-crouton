<script setup lang="ts">
/**
 * CroutonLayoutResponsiveRenderer — renders a `LayoutTree` *with its authored
 * breakpoints applied* (WS5, #874). The explicit layer on top of the plain
 * `CroutonLayoutRenderer`:
 *
 *  - resolves the tree at a container width (measured from this element, or a
 *    simulated `width` for the breakpoint-authoring frame),
 *  - renders the resolved arrangement minus collapsed panes,
 *  - shows the collapsed panes as a gutter rail of tabs (→ "collapse a pane to a
 *    gutter tab"), and
 *  - provides the active breakpoint's per-block widget variants to the renderer.
 *
 * The *intrinsic* layer (each pane reflowing to its own width via `@container`)
 * lives in `CroutonLayoutRenderer`'s CSS and needs nothing here — the two
 * compose: this picks the arrangement; the renderer reflows within each pane.
 */
import { computed, provide, ref, toRef, watch } from 'vue'
import { useElementSize, createReusableTemplate } from '@vueuse/core'
import type { CollapsedPane } from '../utils/layout-responsive'
import type { LayoutCollapseEdge, LayoutNode, LayoutSplit, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { isInPlaceCollapse } from '@fyit/crouton-core/app/types/layout'
import { normalizeCollapseStyle } from '../utils/layout-responsive'
import { findNodePath, type NodePath } from '../utils/layout-edit'
import { useCroutonLayoutResponsive, LAYOUT_VARIANTS_KEY, LAYOUT_COLLAPSE_KEY } from '../composables/useCroutonLayoutResponsive'

const props = defineProps<{
  tree: LayoutTree
  /** Simulate a container width (px) instead of measuring — for the device frame. */
  width?: number
}>()

const emit = defineEmits<{
  /** A collapsed pane (gutter tab or in-place handle) was clicked — host may expand it. */
  expand: [blockId: string]
  /**
   * A splitter was dragged (WS5 #874 follow-up — "resize → breakpoint"). We translate
   * the resized split *node* to its `NodePath` within the resolved root and bubble that
   * up, so the author (which resolves the same tree at the same width) can apply the new
   * sizes onto a structurally-identical root and snapshot them onto a breakpoint here.
   */
  layoutChange: [path: NodePath, sizes: number[]]
}>()

function onInnerLayout(node: LayoutSplit, sizes: number[]) {
  const path = findNodePath(resolved.value.root, node)
  if (path) emit('layoutChange', path, sizes)
}

const hostRef = ref<HTMLElement | null>(null)
const { width: measured } = useElementSize(hostRef)
const effectiveWidth = computed(() => (props.width !== undefined ? props.width : measured.value))

const { resolved, visibleRoot, collapsedPanes, variants, activeBreakpoint } = useCroutonLayoutResponsive(
  toRef(props, 'tree'),
  effectiveWidth,
)

provide(LAYOUT_VARIANTS_KEY, variants)

const collapseStyle = computed(() => normalizeCollapseStyle(resolved.value.collapseStyle))
const inPlace = computed(() => isInPlaceCollapse(collapseStyle.value))

// Expand = OVERLAY DRAWER (#873/#875 follow-up). Clicking a collapsed pane (gutter tab or
// in-place handle) peeks it as an overlay sliding over the content — the collapsed zone
// stays put, and a clear close affordance slides it back. Makes "what happened on click"
// obvious, instead of the old silent reflow.
const openOverlay = ref<string | null>(null)

// The drawer slides out from — and back to — the EDGE the pane tucks to (its collapse
// recipe, #852): a left-tucked pane → from the left, a top-tucked pane → from the top, so
// the motion reads as "this pane opened up". We LATCH the edge when the drawer opens
// (`overlayEdge`) and keep it through the close (deriving it from `openOverlay` would flip
// to the default the moment it's nulled, so the exit would go the wrong way).
function recipeEdgeOf(blockId: string): LayoutCollapseEdge {
  return collapsedPanes.value.find(p => p.blockId === blockId)?.recipe.edge ?? 'right'
}
const overlayEdge = ref<LayoutCollapseEdge>('right')
function peek(blockId: string) { overlayEdge.value = recipeEdgeOf(blockId); openOverlay.value = blockId; emit('expand', blockId) }

// Collapsed panes grouped by the edge their recipe tucks them to → the four edge rails.
// `gutter-tabs` is no longer a single right rail: each pane leaves to its own edge with its
// own affordance (tab / button / dot). The four rails reserve space, so the visible content
// reflows inside them (never overlapped).
function panesOnEdge(edge: LayoutCollapseEdge) { return collapsedPanes.value.filter(p => p.recipe.edge === edge) }
function edgeHasPanes(edge: LayoutCollapseEdge) { return collapsedPanes.value.some(p => p.recipe.edge === edge) }

// One tuck-affordance chip (tab / button / dot), reused in all four edge rails.
const [DefineTuck, ReuseTuck] = createReusableTemplate<{ pane: CollapsedPane }>()
const overlayPane = computed(() => collapsedPanes.value.find(p => p.blockId === openOverlay.value) ?? null)
const overlayNode = computed<LayoutNode | null>(() => (openOverlay.value ? { type: 'leaf', blockId: openOverlay.value } : null))

// Render the peeked block DIRECTLY (not via CroutonLayoutRenderer) so it shows its real
// content: the in-place collapse context provided above would otherwise leak in and draw
// the collapsed *handle* again inside the drawer.
const { resolveComponentName: resolveOverlayComponent, sanitizeConfig: sanitizeOverlayConfig } = useCroutonLayoutBlocks()
const overlayComponent = computed(() => (openOverlay.value ? resolveOverlayComponent(openOverlay.value) : null))
const overlayConfig = computed<Record<string, unknown>>(() => (openOverlay.value ? sanitizeOverlayConfig(openOverlay.value, undefined) : {}))
// If the width changes so the pane is no longer collapsed, close the overlay.
watch(collapsedPanes, panes => { if (openOverlay.value && !panes.some(p => p.blockId === openOverlay.value)) openOverlay.value = null })

// Provide the in-place collapse context to the recursive renderer — only when an
// in-place style is active, so the gutter-tabs path is untouched. `expand` opens the drawer.
provide(LAYOUT_COLLAPSE_KEY, computed(() =>
  inPlace.value
    ? { collapsedSet: new Set(resolved.value.collapsed), style: collapseStyle.value, expand: peek }
    : null,
))

// The peek drawer's resting position + slide direction, by the pane's tuck edge.
const overlayPlacement = computed(() => ({
  left: 'inset-y-0 left-0 w-[min(440px,88%)] border-r border-default',
  right: 'inset-y-0 right-0 w-[min(440px,88%)] border-l border-default',
  top: 'inset-x-0 top-0 h-[min(70%,32rem)] border-b border-default',
  bottom: 'inset-x-0 bottom-0 h-[min(70%,32rem)] border-t border-default',
}[overlayEdge.value]))
const overlayTransition = computed(() => `mq-drawer-${overlayEdge.value}`)

defineExpose({ activeBreakpoint, collapseStyle, openOverlay })
</script>

<template>
  <div
    ref="hostRef"
    class="relative flex h-full w-full"
  >
    <!-- In-place collapse (WS6 #875): render the FULL resolved tree — collapsed panes
         stay in their slots as motion handles (provided via LAYOUT_COLLAPSE_KEY) and the
         splitter hands their space back to siblings. No gutter rail. -->
    <template v-if="inPlace">
      <CroutonLayoutRenderer
        :node="resolved.root"
        class="min-w-0 flex-1"
        @layout-change="onInnerLayout"
      />
    </template>

    <!-- gutter-tabs (default), generalised to PER-EDGE rails (#852): each collapsed pane leaves
         to the edge its recipe names, as its chosen affordance (tab / button / dot). The rails
         reserve space so the visible content reflows inside them. -->
    <template v-else>
      <!-- one tuck affordance, reused in every rail -->
      <DefineTuck v-slot="{ pane }">
        <button
          type="button"
          :title="`Expand ${pane.label ? pane.label + ' · ' : ''}${pane.blockId}`"
          class="flex items-center gap-1.5 text-xs font-medium shadow-sm transition-transform hover:text-primary active:scale-95"
          :class="{
            'rounded-md border border-default bg-default px-2 py-1.5': pane.recipe.affordance === 'tab',
            'rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-primary': pane.recipe.affordance === 'button',
            'size-8 justify-center rounded-full border border-default bg-default p-0': pane.recipe.affordance === 'dot',
          }"
          @click="peek(pane.blockId)"
        >
          <UIcon name="i-lucide-layout-panel-left" class="size-3.5 shrink-0" />
          <span v-if="pane.recipe.affordance !== 'dot'" class="max-w-28 truncate">{{ pane.label || pane.blockId }}</span>
        </button>
      </DefineTuck>

      <div class="flex h-full w-full flex-col">
        <!-- top rail -->
        <div v-if="edgeHasPanes('top')" class="flex shrink-0 flex-wrap items-center justify-center gap-1.5 border-b border-default bg-elevated/50 p-1.5">
          <ReuseTuck v-for="pane in panesOnEdge('top')" :key="pane.blockId" :pane="pane" />
        </div>

        <div class="flex min-h-0 flex-1">
          <!-- left rail -->
          <div v-if="edgeHasPanes('left')" class="flex shrink-0 flex-col items-center justify-center gap-1.5 border-r border-default bg-elevated/50 p-1.5">
            <ReuseTuck v-for="pane in panesOnEdge('left')" :key="pane.blockId" :pane="pane" />
          </div>

          <!-- content: the survivors, reflowed -->
          <div class="min-w-0 flex-1">
            <CroutonLayoutRenderer
              v-if="visibleRoot"
              :node="visibleRoot"
              @layout-change="onInnerLayout"
            />
            <div
              v-else
              class="grid h-full w-full place-items-center p-6 text-center text-sm text-muted"
            >
              Every pane is tucked — tap one on an edge to bring it back.
            </div>
          </div>

          <!-- right rail -->
          <div v-if="edgeHasPanes('right')" class="flex shrink-0 flex-col items-center justify-center gap-1.5 border-l border-default bg-elevated/50 p-1.5">
            <ReuseTuck v-for="pane in panesOnEdge('right')" :key="pane.blockId" :pane="pane" />
          </div>
        </div>

        <!-- bottom rail -->
        <div v-if="edgeHasPanes('bottom')" class="flex shrink-0 flex-wrap items-center justify-center gap-1.5 border-t border-default bg-elevated/50 p-1.5">
          <ReuseTuck v-for="pane in panesOnEdge('bottom')" :key="pane.blockId" :pane="pane" />
        </div>
      </div>
    </template>

    <!-- Expand drawer: the peeked pane slides over the content; scrim/✕ slides it back. -->
    <Transition name="mq-scrim">
      <div
        v-if="openOverlay"
        class="absolute inset-0 z-40 bg-black/40"
        @click="openOverlay = null"
      />
    </Transition>
    <Transition :name="overlayTransition">
      <div
        v-if="openOverlay && overlayNode"
        class="absolute z-50 flex flex-col bg-default shadow-2xl"
        :class="overlayPlacement"
      >
        <div class="flex items-center gap-2 border-b border-default px-3 py-2">
          <UIcon
            name="i-lucide-panel-right-open"
            class="size-4 text-muted"
          />
          <span class="text-sm font-medium">{{ overlayPane?.label || openOverlay }}</span>
          <span class="rounded-full border border-default px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">overlay</span>
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            class="ml-auto"
            aria-label="Close"
            @click="openOverlay = null"
          />
        </div>
        <div class="min-h-0 flex-1 overflow-auto">
          <component
            :is="overlayComponent"
            v-if="overlayComponent"
            v-bind="overlayConfig"
            class="h-full w-full overflow-auto"
          />
          <div
            v-else
            class="grid h-full w-full place-items-center p-6 text-center text-sm text-error"
          >
            Unknown block:&nbsp;<code>{{ openOverlay }}</code>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.mq-scrim-enter-active, .mq-scrim-leave-active { transition: opacity .2s ease }
.mq-scrim-enter-from, .mq-scrim-leave-to { opacity: 0 }
.mq-drawer-left-enter-active, .mq-drawer-left-leave-active,
.mq-drawer-right-enter-active, .mq-drawer-right-leave-active,
.mq-drawer-top-enter-active, .mq-drawer-top-leave-active,
.mq-drawer-bottom-enter-active, .mq-drawer-bottom-leave-active { transition: transform .28s cubic-bezier(.32,.72,0,1) }
.mq-drawer-right-enter-from, .mq-drawer-right-leave-to { transform: translateX(100%) }
.mq-drawer-left-enter-from, .mq-drawer-left-leave-to { transform: translateX(-100%) }
.mq-drawer-top-enter-from, .mq-drawer-top-leave-to { transform: translateY(-100%) }
.mq-drawer-bottom-enter-from, .mq-drawer-bottom-leave-to { transform: translateY(100%) }
@media (prefers-reduced-motion: reduce) {
  .mq-scrim-enter-active, .mq-scrim-leave-active,
  .mq-drawer-left-enter-active, .mq-drawer-left-leave-active,
  .mq-drawer-right-enter-active, .mq-drawer-right-leave-active,
  .mq-drawer-top-enter-active, .mq-drawer-top-leave-active,
  .mq-drawer-bottom-enter-active, .mq-drawer-bottom-leave-active { transition: none }
}
</style>
