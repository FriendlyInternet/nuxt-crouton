<script setup lang="ts">
// fallow-ignore-file circular-dependency
// (BoardRow <-> BoardTree is the board's recursion: a row's panes are trees, a tree's
// side-by-side split is a row, like BoardTree -> BoardTree. Components are only used at
// render time, so the cycle has no module-init hazard.)
/**
 * BoardRow (#3865) — a side-by-side split on the board, not stacked: one reka group with
 * the tested widths, minimums and handles (#3746). Split out of BoardTree so each template
 * stays simple. Content height, panes top-aligned like the page: `!h-auto !items-start`
 * beat reka's inline `height: 100%`; the handle stretches to the row so it can still be
 * grabbed; each pane is floored at its block's minimum height. The group remounts when the
 * visible set changes.
 */
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import type { NodePath } from '@fyit/crouton-layout/app/utils/layout-edit'
import { boardPaneMinPct } from '../../utils/board-pane-min'
import { boardFloorStyle, toChildSizes, visibleDefaultSizes, visibleSubtree } from '../../utils/board-visible'

const props = defineProps<{
  node: LayoutSplit
  path: NodePath
  selected: NodePath | null
  hidden: Set<string>
  /** The split's visible children, with their original indices (paths stay valid). */
  items: { child: LayoutNode, i: number }[]
  /** The measured split width (px) — the pane floors are converted against it. */
  width: number
}>()

const emit = defineEmits<{
  resize: [at: NodePath, sizes: (number | undefined)[]]
  select: [at: NodePath]
}>()

const { blocks } = useCroutonLayoutBlocks()

// Floor each pane at the same floor the served page gives it (#3746).
const panelMin = (child: LayoutNode) =>
  boardPaneMinPct(props.node.direction, visibleSubtree(child, props.hidden) ?? child, props.width, props.items.length - 1, blocks.value)
// Visible panes' sizes re-normalised to 100 for reka (#3828); stored sizes are untouched.
const panelDefaults = computed(() => visibleDefaultSizes(props.items.map(v => v.child)))
const floorStyle = (child: LayoutNode) => boardFloorStyle(child, props.hidden, blocks.value)
const groupKey = computed(() => props.items.map(v => v.i).join('-'))
const childPath = (i: number): NodePath => [...props.path, i]

// Only a user resize edits the page (#3746): reka re-reports the min-width clamp on
// mount / width change, and that must not mark the board unsaved or overwrite the base.
const userResizing = ref(false)
function onHandleKey() {
  userResizing.value = true
  setTimeout(() => (userResizing.value = false), 0)
}
const onDragging = (d: boolean) => (userResizing.value = d)
function onLayout(sizes: number[]) {
  if (!userResizing.value) return
  // Back onto the original child indices; hidden children stay undefined (#3828).
  emit('resize', props.path, toChildSizes(props.node.children, props.items.map(v => v.i), sizes))
}
const onChildResize = (at: NodePath, sizes: (number | undefined)[]) => emit('resize', at, sizes)
const onChildSelect = (at: NodePath) => emit('select', at)
</script>

<template>
  <SplitterGroup
    :key="groupKey"
    :direction="node.direction"
    class="!h-auto !items-start w-full"
    @layout="onLayout"
    @keydown.capture="onHandleKey"
  >
    <template v-for="({ child, i }, vi) in items" :key="i">
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
</template>
