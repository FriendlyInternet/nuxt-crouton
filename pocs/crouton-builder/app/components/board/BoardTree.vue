<script setup lang="ts">
/**
 * BoardTree (#2375) — the page board as a plain DOM splitter tree.
 *
 * Recurses the LayoutTree the way the package renderer does (split → reka
 * SplitterGroup / Panel / ResizeHandle) and gives every pane its `NodePath`,
 * so a pane (BoardPane) can be a drop target. A split lays out only the
 * children that still show something at this width — a hidden pane gives its
 * space back; its trigger lives on an edge or in the nav (#2418).
 *
 * Deliberately in the POC (consume-vs-grow): once it holds up on a phone, the
 * splitter + drop layer is the candidate for extraction into crouton-layout.
 */
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import type { NodePath } from '@fyit/crouton-layout/app/utils/layout-edit'
import { isSubtreeCollapsed, isLeafCollapsed } from '@fyit/crouton-layout/app/utils/layout-responsive'
import { deriveSizing } from '@fyit/crouton-layout/app/utils/layout-viability'
import { useElementSize } from '@vueuse/core'

defineOptions({ name: 'BoardTree' })

const props = withDefaults(defineProps<{
  node: LayoutNode
  path?: NodePath
  selected?: NodePath | null
  /** pane ids / block ids hidden at the current width: those panes aren't laid out. */
  hidden?: Set<string>
}>(), { path: () => [], selected: null, hidden: () => new Set<string>() })

const emit = defineEmits<{
  resize: [at: NodePath, sizes: number[]]
  select: [at: NodePath]
}>()

const isHidden = computed(() => props.node.type === 'leaf' && isLeafCollapsed(props.node, props.hidden))
// Original indices are kept so paths (drops, selection) stay valid.
const visibleChildren = computed(() =>
  props.node.type === 'split'
    ? props.node.children.map((child, i) => ({ child, i })).filter(({ child }) => !isSubtreeCollapsed(child, props.hidden))
    : [],
)
const panelMin = (child: LayoutNode) => child.minSize ?? 10
const panelDefault = (child: LayoutNode, n: number) => child.defaultSize ?? 100 / n

// Stack like the page does (#2523): the served page stacks a horizontal split once its
// container is narrower than the split's derived soft floor (a container query in the
// renderer). The board measures the same width against the same threshold, so what you
// see on a phone is what the page shows — one under the other, no resize handles.
const { blocks } = useCroutonLayoutBlocks()
const splitEl = ref<HTMLElement | null>(null)
const { width: splitWidth } = useElementSize(splitEl)
const stackThreshold = computed(() => (
  props.node.type === 'split' && props.node.direction === 'horizontal'
    ? Math.round(deriveSizing(props.node, blocks.value).softMinWidth)
    : 0
))
const stacked = computed(() => stackThreshold.value > 0 && splitWidth.value > 0 && splitWidth.value <= stackThreshold.value)
</script>

<template>
  <!-- Split: one measured wrapper (the stack threshold reads its width) around either
       the stacked column or the reka group. -->
  <div v-if="node.type === 'split'" ref="splitEl" class="h-full w-full">
    <!-- STACKED (#2523): narrower than its soft floor, so the panes go one under the
         other — the page does the same at this width. Grips + drops stay; no resize handles. -->
    <div v-if="stacked" class="flex h-full w-full flex-col gap-px overflow-y-auto" data-handoff="board-stack">
      <div v-for="({ child, i }) in visibleChildren" :key="i" class="min-h-72 w-full shrink-0">
        <BoardTree
          :node="child"
          :path="[...path, i]"
          :selected="selected"
          :hidden="hidden"
          @resize="(at, sizes) => emit('resize', at, sizes)"
          @select="at => emit('select', at)"
        />
      </div>
    </div>

    <!-- Side by side: one reka group; the group remounts when the visible set changes. -->
    <SplitterGroup
      v-else
      :key="visibleChildren.map(v => v.i).join('-')"
      :direction="node.direction"
      class="h-full w-full"
      @layout="sizes => emit('resize', path, sizes)"
    >
      <template v-for="({ child, i }, vi) in visibleChildren" :key="i">
        <SplitterResizeHandle
          v-if="vi > 0"
          class="relative shrink-0 bg-border hover:bg-primary data-[state=drag]:bg-primary transition-colors data-[orientation=horizontal]:w-1.5 data-[orientation=vertical]:h-1.5"
          data-handoff="pane-resize-handle"
        />
        <SplitterPanel :default-size="panelDefault(child, visibleChildren.length)" :min-size="panelMin(child)" class="overflow-hidden">
          <BoardTree
            :node="child"
            :path="[...path, i]"
            :selected="selected"
            :hidden="hidden"
            @resize="(at, sizes) => emit('resize', at, sizes)"
            @select="at => emit('select', at)"
          />
        </SplitterPanel>
      </template>
    </SplitterGroup>
  </div>

  <!-- Leaf or nested app: a pane. Hidden at this width → nothing (its trigger lives elsewhere). -->
  <BoardPane v-else-if="!isHidden" :node="node" :path="path" :selected="selected" @select="at => emit('select', at)" />
</template>
