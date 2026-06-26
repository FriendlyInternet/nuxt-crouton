<script setup lang="ts">
/**
 * CroutonLayoutZoomShell — the semantic-zoom shell for the Crouton Builder
 * (WS1, #870; epic #868). One zoomable surface where the single gesture
 * zoom-in / zoom-out walks Site → Page → App → Breakpoints, content changing
 * *meaning* at each depth.
 *
 * The navigation state lives in `useCroutonSemanticZoom`; this component renders
 * the focused frame:
 *  - site   → a grid of pages you zoom into (a static list for now; the live
 *             Vue Flow canvas is WS3 #872 — the only floating level).
 *  - layout → the page/app layout via `CroutonLayoutRenderer`, with a toolbar to
 *             zoom into each `nested` app (WS2 recursion) or into breakpoints.
 *  - breakpoints → author responsiveness by demonstration via
 *             `CroutonLayoutBreakpointAuthor` (ruler · device frame · per-checkpoint
 *             collapse & widget variant; WS5 #874). Edits emit up as `layoutChange`.
 *
 * Zoom out: the breadcrumb, the ⤡ button, Esc, or scroll-up.
 */
import { computed, ref, watch } from 'vue'
import { onKeyStroke, useEventListener, useWindowSize } from '@vueuse/core'
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { findNestedNodes } from '../utils/layout-edit'
import { treeToPieces, piecesToTree, piecePath } from '../utils/layout-compose-bridge'
import type { ComposePiece } from '../composables/useCroutonComposeGestures'
import { useCroutonSemanticZoom } from '../composables/useCroutonSemanticZoom'
import { useCroutonLayoutBlocks } from '../composables/useCroutonLayoutBlocks'

interface ZoomPage {
  id: string
  label: string
  icon?: string
  tree: LayoutTree
}

const props = withDefaults(defineProps<{
  /** The site's pages (the L0 targets). Until WS3, the host supplies these. */
  pages?: ZoomPage[]
  siteLabel?: string
}>(), {
  pages: () => [],
  siteLabel: 'Site',
})

const emit = defineEmits<{
  /**
   * The focused layout's authored breakpoints changed at the Breakpoints level
   * (WS5 #874). The host owns persistence (e.g. saving the page's `layout_configs`
   * tree); the shell stays storage-agnostic.
   */
  layoutChange: [tree: LayoutTree]
}>()

const zoom = useCroutonSemanticZoom({ siteLabel: props.siteLabel })
const { current, depth, canZoomOut, breadcrumb } = zoom

/**
 * A live, editable copy of the focused layout while authoring breakpoints (L3).
 * Seeded from the frame's tree on entry; edits emit up via `layoutChange`. Deep
 * round-tripping back into the page's own content is a documented follow-up.
 */
const bpTree = ref<LayoutTree | null>(null)
watch(current, (frame) => {
  if (frame.level === 'breakpoints' && frame.tree) bpTree.value = frame.tree
  else bpTree.value = null
}, { immediate: true })

function onBreakpointsChange(tree: LayoutTree): void {
  bpTree.value = tree
  // Share the edit down to the layout it authors, then bubble the page for the host.
  zoom.setCurrentTree(tree)
  persistFocusedPage()
}

/** The `nested` apps in the current layout = the zoom-in targets. */
const apps = computed(() =>
  current.value.level === 'layout' && current.value.tree
    ? findNestedNodes(current.value.tree.root)
    : [],
)

// --- L2 App level — the editable compose canvas, bridged to the shared tree ----
// At a layout frame we render the WS4 compose canvas (free cards you snap together)
// instead of the read-only renderer. The bridge keeps the focused frame's `tree` in
// lock-step with the canvas pieces, so a snap here is the SAME edit the breakpoint
// author sees when you zoom in — one shared tree, no per-surface copy (#899).
const { getBlock } = useCroutonLayoutBlocks()
const labelOf = (node: LayoutNode): string | undefined =>
  node.type === 'leaf' ? getBlock(node.blockId)?.name ?? node.blockId
    : node.type === 'nested' ? node.label || 'App'
      : undefined

const pieces = ref<ComposePiece[]>([])

// Responsive seeding: on a narrow (phone) viewport, lay the cards out as a single
// full-width vertical column instead of a horizontal tile that overflows the canvas
// and piles up once clamped. Sized to the viewport so each card is readable + grabbable.
const { width: winW } = useWindowSize()
function seedOptions() {
  if (winW.value && winW.value < 560) {
    const w = Math.max(180, winW.value - 48)
    return { column: true, width: w, height: 168, gap: 14, originX: 16, originY: 16, labelOf }
  }
  return { labelOf }
}

// Re-seed the cards from the focused tree only on NAVIGATION — keyed on a STABLE
// primitive (`depth:level:label`), NOT a fresh array, so an in-place edit (which calls
// setCurrentTree → same depth/level) does NOT refire and re-explode the cards the user
// just snapped. Zooming in/out (depth changes) re-seeds from the now-focused tree.
watch(
  () => `${depth.value}:${current.value.level}:${current.value.label}`,
  () => {
    pieces.value = current.value.level === 'layout' && current.value.tree
      ? treeToPieces(current.value.tree, seedOptions())
      : []
  },
  { immediate: true },
)

/** A compose edit (snap / detach / move) → recompose the authoritative tree. */
function onComposeChange(next: ComposePiece[]): void {
  pieces.value = next
  const tree = piecesToTree(next, current.value.tree)
  zoom.setCurrentTree(tree)
  persistFocusedPage()
}

/** Pane-click-to-zoom: a nested-app card was opened → descend into its sub-layout. */
function onComposeZoom(piece: ComposePiece): void {
  // Make sure the frame tree matches the current cards, then address the clicked one.
  zoom.setCurrentTree(piecesToTree(pieces.value, current.value.tree))
  const path = piecePath(pieces.value, piece.id)
  if (path) zoom.zoomIntoNested(path)
}

// Theme tokens (semantic), not raw palette steps, so the dots track the active theme.
const levelDot: Record<string, string> = {
  site: 'bg-secondary',
  layout: 'bg-primary',
  breakpoints: 'bg-info',
}

/**
 * Per-page edited trees, keyed by page id. So zooming out to Site and back into the
 * same page returns to your edits instead of the pristine seed — "return without
 * losing edits" across the whole stack, not just within one descent (#899). The host
 * still owns durable persistence (it gets every edit via `layoutChange`).
 */
const editedPages = new Map<string, LayoutTree>()
const currentPageId = ref<string | null>(null)

/**
 * Descend from the Site level into a page's layout. Exposed to the `#site` slot
 * so a host (e.g. `CroutonFlowSiteFlow`, WS3 #872) can render the live Vue Flow
 * canvas there and zoom in by page — the shell stays free of any crouton-flow
 * coupling (one-way dep: crouton-layout → crouton-core only).
 */
function zoomIntoPageFromSlot(page: ZoomPage): void {
  currentPageId.value = page.id
  zoom.zoomIntoPage(page.label, editedPages.get(page.id) ?? page.tree)
}

/** Cache + bubble the focused page's tree after an edit at any level below it. */
function persistFocusedPage(): void {
  // After downward propagation, the page-level frame (depth 1) holds the whole tree.
  const pageTree = zoom.stack.value[1]?.tree
  if (!pageTree) return
  if (currentPageId.value) editedPages.set(currentPageId.value, pageTree)
  emit('layoutChange', pageTree)
}

// Scroll-up zooms out, throttled so one flick = one level (matches the mock).
const lastWheel = ref(0)
useEventListener('wheel', (e: WheelEvent) => {
  if (e.deltaY < -30 && Date.now() - lastWheel.value > 600) {
    lastWheel.value = Date.now()
    zoom.zoomOut()
  }
}, { passive: true })
onKeyStroke('Escape', () => zoom.zoomOut())
</script>

<template>
  <div class="croutonzoom relative h-full w-full overflow-hidden bg-default">
    <!-- Breadcrumb + zoom-out -->
    <div class="absolute top-3 left-1/2 z-20 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-full border border-default bg-elevated/90 px-3 py-1.5 text-sm backdrop-blur [scrollbar-width:none]">
      <span
        class="inline-block size-1.5 rounded-full"
        :class="levelDot[current.level]"
      />
      <template
        v-for="crumb in breadcrumb"
        :key="crumb.index"
      >
        <span
          v-if="crumb.index > 0"
          class="text-muted/50"
        >›</span>
        <button
          type="button"
          class="whitespace-nowrap transition-colors"
          :class="crumb.index === depth ? 'font-semibold text-highlighted' : 'text-muted hover:text-default'"
          @click="zoom.jumpTo(crumb.index)"
        >
          {{ crumb.label }}
        </button>
      </template>
      <UButton
        v-if="canZoomOut"
        icon="i-lucide-minimize-2"
        size="xs"
        color="neutral"
        variant="ghost"
        aria-label="Zoom out"
        @click="zoom.zoomOut()"
      />
    </div>

    <Transition name="zoom" mode="out-in">
      <!-- L0 · Site — the only floating level (a flow of pages). The host fills
           the #site slot with the live Vue Flow canvas (CroutonFlowSiteFlow,
           WS3 #872); the default is a static page grid so the shell still works
           standalone (e.g. without crouton-flow). -->
      <div
        v-if="current.level === 'site'"
        :key="'site'"
        class="h-full w-full"
      >
        <slot
          name="site"
          :pages="props.pages"
          :zoom-into-page="zoomIntoPageFromSlot"
        >
          <div class="grid h-full w-full place-items-center p-10">
            <div class="w-full max-w-4xl">
              <p class="mb-4 text-xs uppercase tracking-widest text-muted">{{ current.label }} · wire your pages</p>
              <div
                v-if="props.pages.length"
                class="grid grid-cols-2 gap-3 sm:grid-cols-3"
              >
                <button
                  v-for="page in props.pages"
                  :key="page.id"
                  type="button"
                  class="group flex flex-col gap-2 rounded-xl border border-default bg-elevated p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg"
                  @click="zoom.zoomIntoPage(page.label, page.tree)"
                >
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="page.icon || 'i-lucide-layout-dashboard'"
                      class="size-4 text-primary"
                    />
                    <span class="font-medium">{{ page.label }}</span>
                    <UIcon
                      name="i-lucide-maximize-2"
                      class="ml-auto size-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </div>
                  <span class="text-xs text-muted">zoom in to arrange its apps</span>
                </button>
              </div>
              <p
                v-else
                class="rounded-xl border border-dashed border-default p-8 text-center text-sm text-muted"
              >
                No pages yet — provide the #site slot (CroutonFlowSiteFlow) to wire pages.
              </p>
            </div>
          </div>
        </slot>
      </div>

      <!-- L3 · Breakpoints — author responsiveness by demonstration (WS5 #874):
           ruler of min-width checkpoints · scaled device frame · per-checkpoint
           collapse + widget variant. -->
      <div
        v-else-if="current.level === 'breakpoints'"
        :key="'bp-' + depth"
        class="h-full w-full"
      >
        <CroutonLayoutBreakpointAuthor
          v-if="bpTree"
          :model-value="bpTree"
          @update:model-value="onBreakpointsChange"
        />
      </div>

      <!-- L1/L2 · a Layout of apps (a page, or a nested app — itself a layout).
           The editable surface IS the WS4 compose canvas: drag a card next to
           another → they snap into a bound split; hold one over another → it nests.
           Every edit recomposes the focused frame's tree (shared with breakpoints). -->
      <div
        v-else
        :key="'layout-' + depth"
        class="flex h-full w-full flex-col"
      >
        <!-- Zoom toolbar: into each nested app, or into breakpoints -->
        <div class="flex flex-wrap items-center gap-2 px-4 pb-2 pt-16">
          <span class="hidden text-xs text-muted sm:inline">Drag a card beside another → snap · hold over → nest · open an app to zoom in</span>
          <UButton
            v-for="app in apps"
            :key="app.path.join('.')"
            :label="app.label || 'App'"
            icon="i-lucide-maximize-2"
            size="xs"
            color="neutral"
            variant="soft"
            @click="zoom.zoomIntoNested(app.path)"
          />
          <UButton
            label="Breakpoints"
            icon="i-lucide-smartphone"
            size="xs"
            color="neutral"
            variant="ghost"
            class="ml-auto"
            @click="zoom.zoomIntoBreakpoints()"
          />
        </div>
        <div class="min-h-0 flex-1 p-4 pt-0">
          <CroutonLayoutComposeCanvas
            :model-value="pieces"
            @update:model-value="onComposeChange"
            @zoom="onComposeZoom"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.zoom-enter-active,
.zoom-leave-active {
  transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.5, 0, 0.3, 1);
}
.zoom-enter-from {
  opacity: 0;
  transform: scale(0.96);
}
.zoom-leave-to {
  opacity: 0;
  transform: scale(1.04);
}
</style>
