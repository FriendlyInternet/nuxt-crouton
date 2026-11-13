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
 * (BoardRow: widths, minimums, handles) but takes content height and top-aligns its
 * panes; a split with one visible child draws that child in its place (the page does,
 * `partitionCollapsed`).
 *
 * Deliberately in the POC (consume-vs-grow): once it holds up on a phone, the
 * splitter + drop layer is the candidate for extraction into crouton-layout.
 */
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import type { NodePath } from '@fyit/crouton-layout/app/utils/layout-edit'
import { isSubtreeCollapsed, isLeafCollapsed } from '@fyit/crouton-layout/app/utils/layout-responsive'
import { pageRowTracks } from '@fyit/crouton-layout/app/utils/layout-viability'
import { boardFloorStyle, boardStackThreshold, visibleSubtree } from '../../utils/board-visible'
import { useElementSize } from '@vueuse/core'
import BoardRow from './BoardRow.vue'

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

// A COLUMN — the vertical grid or the stacked side-by-side row — is one branch in the
// template; these hold the two shapes' differences (#3865).
const column = computed(() => {
  if (isVertical.value) return { handoff: 'board-grid', class: undefined, style: gridStyle.value }
  if (stacked.value) return { handoff: 'board-stack', class: 'flex w-full flex-col gap-px', style: undefined }
  return null
})
// A grid cell sizes like the page's cell; a stacked pane is floored at its block's minimum
// height — the same number the page's `viewChildStyle` uses.
const cellAttrs = (child: LayoutNode) => isVertical.value
  ? { 'class': 'min-h-0 min-w-0 overflow-hidden', 'data-handoff': 'board-cell' }
  : { class: 'w-full shrink-0', style: boardFloorStyle(child, props.hidden, blocks.value) }
</script>

<template>
  <!-- Split: one measured wrapper (the stack threshold reads its width) around the lone
       visible child, the vertical grid, the stacked column or the reka row. Content-height
       like the page (#3865); `h-full` only inside a grid cell, where the cell is stretched by
       its row and a percentage min-height below needs a sized parent. -->
  <div v-if="node.type === 'split'" ref="splitEl" class="w-full" :class="{ 'h-full': inGridCell }" data-handoff="board-split">
    <!-- ONE visible child (#3865): drawn in the split's place, like the page. -->
    <BoardTree
      v-if="onlyChild"
      :node="onlyChild.child"
      :path="childPath(onlyChild.i)"
      :selected="selected"
      :hidden="hidden"
      :in-grid-cell="inGridCell"
      @resize="onChildResize"
      @select="onChildSelect"
    />

    <!-- COLUMN: a VERTICAL split is the page's content-flow grid — same row tracks, no row
         handle (#3865); a STACKED side-by-side row (#2523, narrower than its soft floor) goes
         one under the other like the page, each pane floored at its block's minimum. Grips +
         drops stay; no resize handles; the frame scrolls. -->
    <div v-else-if="column" :class="column.class" :style="column.style" :data-handoff="column.handoff">
      <div v-for="({ child, i }) in visibleChildren" :key="i" v-bind="cellAttrs(child)">
        <BoardTree
          :node="child"
          :path="childPath(i)"
          :selected="selected"
          :hidden="hidden"
          :in-grid-cell="isVertical"
          @resize="onChildResize"
          @select="onChildSelect"
        />
      </div>
    </div>

    <!-- Side by side: the reka row (widths, minimums, handles), content height, top-aligned. -->
    <BoardRow
      v-else
      :node="node"
      :path="path"
      :selected="selected"
      :hidden="hidden"
      :items="visibleChildren"
      :width="splitWidth"
      @resize="onChildResize"
      @select="onChildSelect"
    />
  </div>

  <!-- Leaf or nested app: a pane. Hidden at this width → nothing (its trigger lives elsewhere). -->
  <BoardPane v-else-if="!isHidden" :node="node" :path="path" :selected="selected" :in-grid-cell="inGridCell" @select="onChildSelect" />
</template>
