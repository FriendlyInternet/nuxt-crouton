<script setup lang="ts">
/**
 * BoardTree (#2375) — the page board as a plain DOM splitter tree.
 *
 * Recurses the LayoutTree the way the package renderer does and gives every pane its
 * `NodePath`, so a pane (BoardPane) can be a drop target. A split lays out only the
 * children that still show something at this width — a hidden pane gives its
 * space back; its trigger lives on an edge or in the nav (#2418) — its stack check,
 * floors and sizes read the visible children only (#3828).
 *
 * Rows flow like the served page (#3865): a vertical split is the page's content-flow
 * grid (`pageRowTracks`, no row handle); a side-by-side split stays a reka group
 * (widths, minimums, handles) but takes content height and top-aligns its
 * panes; a split with one visible child draws that child in its place (the page does,
 * `partitionCollapsed`).
 *
 * Deliberately in the POC (consume-vs-grow): once it holds up on a phone, the
 * splitter + drop layer is the candidate for extraction into crouton-layout.
 */
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import type { NodePath } from '@fyit/crouton-layout/app/utils/layout-edit'
import { isSubtreeCollapsed, isLeafCollapsed } from '@fyit/crouton-layout/app/utils/layout-responsive'
import { pageRowTracks } from '@fyit/crouton-layout/app/utils/layout-viability'
import { boardPaneMinPct } from '../../utils/board-pane-min'
import { boardFloorStyle, boardStackThreshold, toChildSizes, visibleDefaultSizes, visibleSubtree } from '../../utils/board-visible'
import { useElementSize } from '@vueuse/core'

defineOptions({ name: 'BoardTree' })

const props = withDefaults(defineProps<{
  node: LayoutNode
  path?: NodePath
  selected?: NodePath | null
  /** pane ids / block ids hidden at the current width: those panes aren't laid out. */
  hidden?: Set<string>
  /**
   * This tree sits in a vertical grid's cell (#3865). The cell is stretched by its row, so
   * here (only here) wrappers keep `h-full`, a nested grid takes `min-height: 100%` and a
   * pane fills the cell — like the page's renderer inside a grid cell. At the top level the
   * board is content-height, like the served page.
   */
  inGridCell?: boolean
}>(), { path: () => [], selected: null, hidden: () => new Set<string>(), inGridCell: false })

const emit = defineEmits<{
  resize: [at: NodePath, sizes: (number | undefined)[]]
  select: [at: NodePath]
}>()

const isHidden = computed(() => props.node.type === 'leaf' && isLeafCollapsed(props.node, props.hidden))
// Original indices are kept so paths (drops, selection) stay valid.
const visibleChildren = computed(() =>
  props.node.type === 'split'
    ? props.node.children.map((child, i) => ({ child, i })).filter(({ child }) => !isSubtreeCollapsed(child, props.hidden))
    : [],
)
const { blocks } = useCroutonLayoutBlocks()

// The page replaces a split with one visible child by that child (#3865).
const onlyChild = computed(() => (visibleChildren.value.length === 1 ? visibleChildren.value[0]! : null))
const isVertical = computed(() => props.node.type === 'split' && props.node.direction === 'vertical')
// A vertical split's rows: the page's own tracks, computed from the visible tree (#3865).
const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateRows: pageRowTracks(visibleChildren.value.map(v => visibleSubtree(v.child, props.hidden) ?? v.child), blocks.value),
  gap: '1px',
  width: '100%',
  ...(props.inGridCell ? { minHeight: '100%' } : {}),
}))

// Re-emit a child tree's events (one named handler instead of an inline arrow per branch).
const onChildResize = (at: NodePath, sizes: (number | undefined)[]) => emit('resize', at, sizes)
const onChildSelect = (at: NodePath) => emit('select', at)
const childPath = (i: number): NodePath => [...props.path, i]

const splitEl = ref<HTMLElement | null>(null)
const { width: splitWidth } = useElementSize(splitEl)

// Stack like the page does (#2523): the served page stacks a horizontal split once its
// container is narrower than the split's derived soft floor (a container query in the
// renderer). The board measures the same width against the same threshold, so what you
// see on a phone is what the page shows — one under the other, no resize handles.
// Hidden panes don't count (#3828) — the page renders from the visible tree too.
const stackThreshold = computed(() => boardStackThreshold(props.node, props.hidden, blocks.value))
const stacked = computed(() => stackThreshold.value > 0 && splitWidth.value > 0 && splitWidth.value <= stackThreshold.value)

// A COLUMN — the lone visible child, the vertical grid or the stacked side-by-side row —
// is one branch in the template; these hold the shapes' differences (#3865). The lone
// child keeps the split's grid-cell context, so `h-full` carries down to it.
const column = computed(() => {
  if (onlyChild.value) return { handoff: 'board-only', class: props.inGridCell ? 'h-full w-full' : 'w-full', style: undefined }
  if (isVertical.value) return { handoff: 'board-grid', class: undefined, style: gridStyle.value }
  if (stacked.value) return { handoff: 'board-stack', class: 'flex w-full flex-col gap-px', style: undefined }
  return null
})
// A grid cell sizes like the page's cell; a stacked pane is floored at its block's minimum
// height — the same number the page's `viewChildStyle` uses.
const floorStyle = (child: LayoutNode) => boardFloorStyle(child, props.hidden, blocks.value)
const cellAttrs = (child: LayoutNode) => {
  if (onlyChild.value) return { class: props.inGridCell ? 'h-full w-full' : 'w-full' }
  return isVertical.value
    ? { 'class': 'min-h-0 min-w-0 overflow-hidden', 'data-handoff': 'board-cell' }
    : { class: 'w-full shrink-0', style: floorStyle(child) }
}
const childInGridCell = computed(() => isVertical.value || (!!onlyChild.value && props.inGridCell))

// SIDE BY SIDE (not stacked): one reka group with the tested widths, minimums and handles
// (#3746). Content height, panes top-aligned like the page (#3865): `!h-auto !items-start`
// beat reka's inline `height: 100%`; the handle stretches to the row so it can still be
// grabbed; each pane is floored at its block's minimum height. The group remounts when
// the visible set changes.
const panelMin = (child: LayoutNode) => props.node.type === 'split'
  ? boardPaneMinPct(props.node.direction, visibleSubtree(child, props.hidden) ?? child, splitWidth.value, visibleChildren.value.length - 1, blocks.value)
  : 0
// Visible panes' sizes re-normalised to 100 for reka (#3828); stored sizes are untouched.
const panelDefaults = computed(() => visibleDefaultSizes(visibleChildren.value.map(v => v.child)))
const groupKey = computed(() => visibleChildren.value.map(v => v.i).join('-'))

// Only a user resize edits the page (#3746): reka re-reports the min-width clamp on
// mount / width change, and that must not mark the board unsaved or overwrite the base.
const userResizing = ref(false)
function onHandleKey() {
  userResizing.value = true
  setTimeout(() => (userResizing.value = false), 0)
}
const onDragging = (d: boolean) => (userResizing.value = d)
function onLayout(sizes: number[]) {
  if (!userResizing.value || props.node.type !== 'split') return
  // Back onto the original child indices; hidden children stay undefined (#3828).
  emit('resize', props.path, toChildSizes(props.node.children, visibleChildren.value.map(v => v.i), sizes))
}
</script>

<template>
  <!-- Split: one measured wrapper (the stack threshold reads its width) around the lone
       visible child, the vertical grid, the stacked column or the reka row. Content-height
       like the page (#3865); `h-full` only inside a grid cell, where the cell is stretched by
       its row and a percentage min-height below needs a sized parent. -->
  <div v-if="node.type === 'split'" ref="splitEl" class="w-full" :class="{ 'h-full': inGridCell }" data-handoff="board-split">
    <!-- COLUMN: ONE visible child is drawn in the split's place, like the page (#3865); a
         VERTICAL split is the page's content-flow grid — same row tracks, no row handle; a STACKED side-by-side row (#2523, narrower than its soft floor) goes
         one under the other like the page, each pane floored at its block's minimum. Grips +
         drops stay; no resize handles; the frame scrolls. -->
    <div v-if="column" :class="column.class" :style="column.style" :data-handoff="column.handoff">
      <div v-for="({ child, i }) in visibleChildren" :key="i" v-bind="cellAttrs(child)">
        <BoardTree
          :node="child"
          :path="childPath(i)"
          :selected="selected"
          :hidden="hidden"
          :in-grid-cell="childInGridCell"
          @resize="onChildResize"
          @select="onChildSelect"
        />
      </div>
    </div>

    <!-- Side by side: the reka row (widths, minimums, handles), content height, top-aligned. -->
    <SplitterGroup
      v-else
      :key="groupKey"
      :direction="node.direction"
      class="!h-auto !items-start w-full"
      @layout="onLayout"
      @keydown.capture="onHandleKey"
    >
      <template v-for="({ child, i }, vi) in visibleChildren" :key="i">
        <SplitterResizeHandle
          v-if="vi > 0"
          class="relative shrink-0 self-stretch bg-border hover:bg-primary data-[state=drag]:bg-primary transition-colors data-[orientation=horizontal]:w-1.5 data-[orientation=vertical]:h-1.5"
          data-handoff="pane-resize-handle"
          @dragging="onDragging"
        />
        <SplitterPanel :default-size="panelDefaults[vi]" :min-size="panelMin(child)" class="overflow-hidden">
          <BoardTree
            :style="floorStyle(child)"
            :node="child"
            :path="childPath(i)"
            :selected="selected"
            :hidden="hidden"
            @resize="onChildResize"
            @select="onChildSelect"
          />
        </SplitterPanel>
      </template>
    </SplitterGroup>
  </div>

  <!-- Leaf or nested app: a pane. Hidden at this width → nothing (its trigger lives elsewhere). -->
  <BoardPane v-else-if="!isHidden" :node="node" :path="path" :selected="selected" :in-grid-cell="inGridCell" @select="onChildSelect" />
</template>
