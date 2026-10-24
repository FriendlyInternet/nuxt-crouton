<script setup lang="ts">
/**
 * BuilderNodePreview — a STATIC render of a layout tree, for the board thumbnail.
 *
 * The board shows a card per node. We deliberately do NOT render the live
 * `CroutonLayoutRenderer` here: it drives reka-ui Splitters, each with its own
 * ResizeObserver. A Vue Flow node is transform-scaled (zoom), so an observer inside
 * it reads an oscillating size → the splitter recomputes pane percentages → mutates
 * style → the observer refires: a runaway loop that leaks ~150MB/6s and OOM-crashes
 * mobile Safari (verified: 3.4k idle DOM mutations). See BuilderBlockNode's note.
 *
 * A thumbnail doesn't need a live layout engine — just WYSIWYG *arrangement*. So we
 * walk the tree into plain nested flexboxes (no observer, no splitter) and render the
 * real block component inside each leaf, `pointer-events: none`. Splits divide space by
 * their persisted `defaultSize` percentage; editing panes happens in the focus-edit
 * view, not on the board. Recursive: a `nested` node renders its sub-layout the same way.
 */
import { computed } from 'vue'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'

const props = defineProps<{ node: LayoutNode }>()

const { resolveComponentName, sanitizeConfig } = useCroutonLayoutBlocks()

const isSplit = computed(() => props.node.type === 'split')
const isLeaf = computed(() => props.node.type === 'leaf')

// A leaf renders its block; unknown ids fall back to a labelled placeholder tile.
const leafComponent = computed(() =>
  props.node.type === 'leaf' ? resolveComponentName(props.node.blockId) : null)
const leafProps = computed(() =>
  props.node.type === 'leaf' ? sanitizeConfig(props.node.blockId, props.node.config) : {})

/** A child's share of its parent split — its persisted percentage, else an equal share. */
function flexFor(child: LayoutNode): string {
  const size = child.defaultSize ?? 0
  return size > 0 ? `${size} ${size} 0%` : '1 1 0%'
}
</script>

<template>
  <!-- split → a flexbox in the split's direction; children divide space by defaultSize -->
  <div
    v-if="isSplit && node.type === 'split'"
    class="flex h-full w-full min-h-0 min-w-0"
    :class="node.direction === 'horizontal' ? 'flex-row' : 'flex-col'"
  >
    <div
      v-for="(child, i) in node.children"
      :key="i"
      class="min-h-0 min-w-0 overflow-hidden"
      :style="{ flex: flexFor(child) }"
    >
      <BuilderNodePreview :node="child" />
    </div>
  </div>

  <!-- nested → render the embedded sub-layout the same static way -->
  <BuilderNodePreview
    v-else-if="node.type === 'nested'"
    :node="node.layout.root"
  />

  <!-- leaf → the real block, non-interactive (a thumbnail, not a live surface) -->
  <div v-else-if="isLeaf" class="h-full w-full overflow-hidden pointer-events-none">
    <component
      :is="leafComponent"
      v-if="leafComponent"
      v-bind="leafProps"
      class="h-full w-full"
    />
    <div
      v-else
      class="flex h-full w-full items-center justify-center bg-elevated text-xs text-muted"
    >
      {{ node.type === 'leaf' ? node.blockId : '' }}
    </div>
  </div>
</template>
