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
</script>

<template>
  <!-- Split: one reka group; the group remounts when the visible set changes. -->
  <SplitterGroup
    v-if="node.type === 'split'"
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

  <!-- Leaf or nested app: a pane. Hidden at this width → nothing (its trigger lives elsewhere). -->
  <BoardPane v-else-if="!isHidden" :node="node" :path="path" :selected="selected" @select="at => emit('select', at)" />
</template>
